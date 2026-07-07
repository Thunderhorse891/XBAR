import { randomUUID } from 'node:crypto';
import { readJsonBody, sendJson } from '../_lib/http.js';
import { requireWorkspaceAccess } from '../_lib/supabase-admin.js';
import { runOcr } from '../_lib/ocr.js';
import {
  extractDocument,
  groupExtractionsIntoCandidates,
  NEEDS_REVIEW_THRESHOLD,
} from '../_lib/document-extraction.js';
import { extractZipEntries, isZipBuffer, guessMimeType } from '../_lib/zip.js';
import { getWorkspaceEntitlements, checkDocumentCapacity } from '../_lib/entitlements.js';
import { recordAuditEvent } from '../_lib/audit.js';
import { enforceRateLimit } from '../_lib/rate-limit.js';

const DOCUMENT_BUCKET =
  process.env.SUPABASE_DOCUMENT_BUCKET || process.env.VITE_SUPABASE_DOCUMENT_BUCKET || 'horse-documents';
const MAX_FILES_PER_BATCH = 25;
const MAX_OCR_TEXT_CHARS = 20000;

const RATE_LIMIT = { bucket: 'documents-upload', limit: 10, windowSeconds: 60 };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, message: 'Method not allowed.' });
  }

  if (!(await enforceRateLimit(req, res, RATE_LIMIT))) {
    return;
  }

  const accessToken = req.headers.authorization?.replace(/^Bearer\s+/i, '').trim() || '';
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { ok: false, message: 'Request body must be valid JSON.' });
  }

  const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : '';
  const mode = ['auto', 'preview', 'commit'].includes(body.mode) ? body.mode : 'auto';
  if (!workspaceId) {
    return sendJson(res, 400, { ok: false, message: 'workspaceId is required.' });
  }

  const access = await requireWorkspaceAccess(accessToken, workspaceId);
  if (!access.ok) {
    return sendJson(res, access.status, { ok: false, message: access.message });
  }
  const { supabase, user } = access;

  try {
    if (mode === 'commit') {
      const result = await commitAssignments({ supabase, workspaceId, user, assignments: body.assignments });
      return sendJson(res, result.ok ? 200 : result.status || 400, result);
    }

    const result = await processBatch({ supabase, workspaceId, user, body, mode });
    return sendJson(res, result.ok ? 200 : result.status || 400, result);
  } catch (error) {
    return sendJson(res, 500, { ok: false, message: `Document ingestion failed: ${error.message}` });
  }
}

async function processBatch({ supabase, workspaceId, user, body, mode }) {
  const inputFiles = Array.isArray(body.files) ? body.files : [];
  if (!inputFiles.length) {
    return { ok: false, status: 400, message: 'files[] is required for preview/auto ingestion.' };
  }

  // Expand ZIP archives into individual files before processing.
  const expanded = [];
  const skipped = [];
  for (const file of inputFiles) {
    const fileName = typeof file.fileName === 'string' && file.fileName ? file.fileName : 'upload.bin';
    let content = null;
    if (typeof file.contentBase64 === 'string' && file.contentBase64) {
      content = Buffer.from(file.contentBase64, 'base64');
    } else if (typeof file.storagePath === 'string' && file.storagePath) {
      const { data, error } = await supabase.storage.from(DOCUMENT_BUCKET).download(file.storagePath);
      if (error || !data) {
        skipped.push({ fileName, reason: `storage download failed: ${error?.message || 'not found'}` });
        continue;
      }
      content = Buffer.from(await data.arrayBuffer());
    }

    if (content && (isZipBuffer(content) || /\.zip$/i.test(fileName))) {
      try {
        const archive = extractZipEntries(content);
        skipped.push(...archive.skipped.map((entry) => ({ fileName: entry.fileName, reason: entry.reason })));
        for (const entry of archive.entries) {
          expanded.push({
            fileName: entry.fileName,
            mimeType: entry.mimeType,
            content: entry.content,
            providedText: '',
            storagePath: '',
          });
        }
        continue;
      } catch (error) {
        skipped.push({ fileName, reason: error.message });
        continue;
      }
    }

    expanded.push({
      fileName,
      mimeType: typeof file.mimeType === 'string' && file.mimeType ? file.mimeType : guessMimeType(fileName),
      content,
      providedText: typeof file.providedText === 'string' ? file.providedText : '',
      providedConfidence: file.providedConfidence,
      storagePath: typeof file.storagePath === 'string' ? file.storagePath : '',
    });
  }

  if (!expanded.length) {
    return { ok: false, status: 400, message: 'No processable files in this batch.', skipped };
  }
  if (expanded.length > MAX_FILES_PER_BATCH) {
    return { ok: false, status: 400, message: `Batches are limited to ${MAX_FILES_PER_BATCH} files per request.` };
  }

  const entitlements = await getWorkspaceEntitlements(supabase, workspaceId);
  const capacity = await checkDocumentCapacity(supabase, workspaceId, expanded.length, entitlements.limits);
  if (!capacity.ok) {
    return { ok: false, status: 403, message: capacity.message };
  }

  const batchId = `batch-${randomUUID()}`;
  const batchLabel =
    typeof body.batchLabel === 'string' && body.batchLabel
      ? body.batchLabel
      : `OCR intake ${new Date().toISOString().slice(0, 10)}`;
  await supabase.from('intake_batches').upsert({
    workspace_id: workspaceId,
    intake_batch_id: batchId,
    label: batchLabel,
    source: 'bulk-upload-with-ocr',
    state: 'processing',
    received_at: new Date().toISOString(),
    payload: { fileCount: expanded.length, mode, uploadedBy: user.id },
  });

  const documents = [];
  const extractions = [];

  for (const file of expanded) {
    const documentId = `doc-${randomUUID()}`;
    let storagePath = file.storagePath;

    if (!storagePath && file.content) {
      const safeName = file.fileName.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-80) || 'upload.bin';
      storagePath = `${user.id}/${workspaceId}/${documentId}/${safeName}`;
      const { error: uploadError } = await supabase.storage
        .from(DOCUMENT_BUCKET)
        .upload(storagePath, file.content, { contentType: file.mimeType, upsert: true });
      if (uploadError) {
        skipped.push({ fileName: file.fileName, reason: `upload failed: ${uploadError.message}` });
        continue;
      }
    }

    const ocr = await runOcr({
      buffer: file.content,
      mimeType: file.mimeType,
      providedText: file.providedText,
      providedConfidence: file.providedConfidence,
    });

    const extraction = extractDocument({ text: ocr.text, ocrConfidence: ocr.confidence });
    const needsReview = extraction.needsReview || !ocr.ok;

    const documentRow = {
      workspace_id: workspaceId,
      document_id: documentId,
      horse_id: '',
      title: file.fileName,
      document_type: extraction.documentTypeLabel,
      source: 'Bulk Intake',
      state: needsReview ? 'Needs Review' : 'Queued',
      confidence: extraction.overallConfidence,
      duplicate_risk: '',
      original_filename: file.fileName,
      storage_path: storagePath || '',
      mime_type: file.mimeType,
      ocr_text: ocr.text.slice(0, MAX_OCR_TEXT_CHARS),
      ocr_confidence_map: extraction.confidenceMap,
      extracted_data: extraction.extractedData,
      needs_review: needsReview,
      review_notes: needsReview ? buildReviewNotes(extraction, ocr) : '',
      intake_batch_id: batchId,
      uploaded_by_user_id: user.id,
      payload: {
        ocrProvider: ocr.provider,
        pipelineType: extraction.documentType,
        lowConfidenceFields: extraction.lowConfidenceFields,
        multiHorse: extraction.multiHorse,
      },
    };

    const { error: insertError } = await supabase.from('documents').upsert(documentRow);
    if (insertError) {
      skipped.push({ fileName: file.fileName, reason: `database insert failed: ${insertError.message}` });
      continue;
    }

    await supabase.from('document_processing_jobs').upsert({
      workspace_id: workspaceId,
      job_id: `job-${randomUUID()}`,
      document_id: documentId,
      horse_id: '',
      provider: ocr.provider,
      status: needsReview ? 'needs_review' : 'completed',
      extracted_text: ocr.text.slice(0, MAX_OCR_TEXT_CHARS),
      entities: extraction.extractedData,
      processing_error: ocr.error || '',
      payload: { batchId, confidence: extraction.overallConfidence },
    });

    documents.push(summarizeDocument(documentRow));
    extractions.push({ ...extraction, ref: documentId });
  }

  // Group documents into horse candidates and match against existing horses
  // by registration number, microchip, then exact name.
  const candidates = groupExtractionsIntoCandidates(extractions);
  const proposals = [];

  for (const candidate of candidates) {
    const match = await findExistingHorse(supabase, workspaceId, candidate.fields);
    const proposal = {
      candidateKey: `cand-${proposals.length + 1}`,
      documentIds: candidate.documentRefs,
      documentTypes: candidate.documentTypes,
      fields: candidate.fields,
      confidenceMap: candidate.confidenceMap,
      confidence: candidate.confidence,
      ambiguous: candidate.ambiguous,
      matchedHorseId: match?.horse_id || '',
      matchedHorseName: match?.name || '',
      matchedBy: match?.matchedBy || '',
      action: 'review',
      horseId: '',
      needsReview: true,
    };

    const confident = candidate.confidence >= NEEDS_REVIEW_THRESHOLD && !candidate.ambiguous;
    if (mode === 'auto') {
      if (match) {
        // Identity matches (registration #/microchip) are safe to attach even
        // below the auto-create bar; the document keeps its review flag.
        await attachDocumentsToHorse({ supabase, workspaceId, user, horse: match, candidate, markReviewed: confident });
        proposal.action = 'attached';
        proposal.horseId = match.horse_id;
        proposal.needsReview = !confident;
      } else if (confident && (candidate.fields.name || candidate.fields.registrationNumber)) {
        const horseId = await createHorseFromCandidate({ supabase, workspaceId, user, candidate });
        proposal.action = 'created';
        proposal.horseId = horseId;
        proposal.needsReview = false;
      }
    }

    proposals.push(proposal);
  }

  const committed = proposals.filter((proposal) => proposal.action !== 'review').length;
  await supabase
    .from('intake_batches')
    .update({
      state: committed === proposals.length ? 'completed' : 'needs-review',
      payload: { fileCount: expanded.length, mode, uploadedBy: user.id, proposals: proposals.length, committed },
      updated_at: new Date().toISOString(),
    })
    .eq('workspace_id', workspaceId)
    .eq('intake_batch_id', batchId);

  await recordAuditEvent(supabase, {
    workspaceId,
    actorUserId: user.id,
    action: 'documents.bulk_upload_with_ocr',
    entityType: 'intake_batch',
    entityId: batchId,
    metadata: { mode, files: expanded.length, proposals: proposals.length, committed, skipped: skipped.length },
  });

  return {
    ok: true,
    mode,
    batchId,
    documents,
    proposals,
    skipped,
    summary: {
      processed: documents.length,
      autoCommitted: committed,
      awaitingReview: proposals.length - committed,
    },
  };
}

async function commitAssignments({ supabase, workspaceId, user, assignments }) {
  const list = Array.isArray(assignments) ? assignments : [];
  if (!list.length) {
    return { ok: false, status: 400, message: 'assignments[] is required for commit mode.' };
  }

  const results = [];
  for (const assignment of list) {
    const documentIds = Array.isArray(assignment.documentIds)
      ? assignment.documentIds.filter((id) => typeof id === 'string')
      : [];
    const action = assignment.action;
    if (!documentIds.length || !['create-horse', 'attach-horse', 'skip'].includes(action)) {
      results.push({
        ok: false,
        documentIds,
        message: 'Each assignment needs documentIds[] and an action of create-horse, attach-horse, or skip.',
      });
      continue;
    }

    if (action === 'skip') {
      results.push({ ok: true, documentIds, action });
      continue;
    }

    const { data: rows } = await supabase
      .from('documents')
      .select('document_id, extracted_data, ocr_confidence_map, confidence, payload')
      .eq('workspace_id', workspaceId)
      .in('document_id', documentIds);

    if (!rows?.length) {
      results.push({ ok: false, documentIds, message: 'Documents not found in this workspace.' });
      continue;
    }

    // Rebuild the merged candidate from stored extractions plus any user
    // corrections supplied in overrides.
    const candidate = { fields: {}, confidenceMap: {}, documentRefs: [], documentTypes: [], confidence: 0 };
    for (const row of rows) {
      candidate.documentRefs.push(row.document_id);
      candidate.documentTypes.push(row.payload?.pipelineType || 'unknown');
      candidate.confidence = Math.max(candidate.confidence, Number(row.confidence || 0));
      for (const [key, value] of Object.entries(row.extracted_data || {})) {
        const fieldConfidence = Number(row.ocr_confidence_map?.[key] || 0);
        if (!(key in candidate.fields) || fieldConfidence > (candidate.confidenceMap[key] ?? 0)) {
          candidate.fields[key] = value;
          candidate.confidenceMap[key] = fieldConfidence;
        }
      }
    }
    for (const [key, value] of Object.entries(assignment.overrides || {})) {
      if (typeof value === 'string') {
        candidate.fields[key] = value;
        candidate.confidenceMap[key] = 1;
      }
    }

    if (action === 'attach-horse') {
      const horseId = typeof assignment.horseId === 'string' ? assignment.horseId : '';
      const { data: horse } = await supabase
        .from('horses')
        .select('horse_id, name, registration_number, breed, color, birthdate, gender, microchip, registry')
        .eq('workspace_id', workspaceId)
        .eq('horse_id', horseId)
        .maybeSingle();
      if (!horse) {
        results.push({ ok: false, documentIds, message: `Horse ${horseId} not found.` });
        continue;
      }
      await attachDocumentsToHorse({ supabase, workspaceId, user, horse, candidate, markReviewed: true });
      results.push({ ok: true, documentIds, action, horseId });
    } else {
      const horseId = await createHorseFromCandidate({ supabase, workspaceId, user, candidate });
      results.push({ ok: true, documentIds, action, horseId });
    }
  }

  await recordAuditEvent(supabase, {
    workspaceId,
    actorUserId: user.id,
    action: 'documents.commit_assignments',
    entityType: 'documents',
    metadata: { assignments: results.length },
  });

  return { ok: true, mode: 'commit', results };
}

function buildReviewNotes(extraction, ocr) {
  const notes = [];
  if (!ocr.ok) notes.push(`OCR provider ${ocr.provider} returned no text${ocr.error ? ` (${ocr.error})` : ''}.`);
  if (extraction.multiHorse.multiple)
    notes.push(
      `Possible multiple horses detected: ${extraction.multiHorse.horseNames.join(', ') || extraction.multiHorse.registrationNumbers.join(', ')}.`,
    );
  if (extraction.lowConfidenceFields.length)
    notes.push(`Low-confidence fields: ${extraction.lowConfidenceFields.join(', ')}.`);
  if (extraction.overallConfidence < NEEDS_REVIEW_THRESHOLD)
    notes.push(
      `Overall confidence ${Math.round(extraction.overallConfidence * 100)}% is below the ${Math.round(NEEDS_REVIEW_THRESHOLD * 100)}% auto-accept threshold.`,
    );
  return notes.join(' ');
}

function summarizeDocument(row) {
  return {
    documentId: row.document_id,
    fileName: row.original_filename,
    documentType: row.document_type,
    pipelineType: row.payload.pipelineType,
    state: row.state,
    confidence: row.confidence,
    needsReview: row.needs_review,
    reviewNotes: row.review_notes,
    storagePath: row.storage_path,
    extractedData: row.extracted_data,
    confidenceMap: row.ocr_confidence_map,
    multiHorse: row.payload.multiHorse,
  };
}

async function findExistingHorse(supabase, workspaceId, fields) {
  const registration = String(fields.registrationNumber || '').trim();
  if (registration) {
    const { data } = await supabase
      .from('horses')
      .select('horse_id, name, registration_number, breed, color, birthdate, gender, microchip, registry')
      .eq('workspace_id', workspaceId)
      .eq('registration_number', registration)
      .maybeSingle();
    if (data) return { ...data, matchedBy: 'registration_number' };
  }

  const microchip = String(fields.microchip || '').trim();
  if (microchip) {
    const { data } = await supabase
      .from('horses')
      .select('horse_id, name, registration_number, breed, color, birthdate, gender, microchip, registry')
      .eq('workspace_id', workspaceId)
      .eq('microchip', microchip)
      .maybeSingle();
    if (data) return { ...data, matchedBy: 'microchip' };
  }

  const name = String(fields.name || '').trim();
  if (name) {
    const { data } = await supabase
      .from('horses')
      .select('horse_id, name, registration_number, breed, color, birthdate, gender, microchip, registry')
      .eq('workspace_id', workspaceId)
      .ilike('name', name)
      .limit(2);
    if (data?.length === 1) return { ...data[0], matchedBy: 'name' };
  }

  return null;
}

async function createHorseFromCandidate({ supabase, workspaceId, user, candidate }) {
  const horseId = `horse-${randomUUID()}`;
  const fields = candidate.fields;

  const { data: profile } = await supabase
    .from('workspace_profiles')
    .select('default_owner_name, default_barn')
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  await supabase.from('horses').upsert({
    workspace_id: workspaceId,
    horse_id: horseId,
    name: fields.name || `Unnamed (${fields.registrationNumber || 'OCR intake'})`,
    barn_name: profile?.default_barn || '',
    segment: '',
    status: 'Active',
    registration_number: fields.registrationNumber || '',
    owner_name: fields.newOwner || profile?.default_owner_name || '',
    breed: fields.breed || '',
    color: fields.color || '',
    birthdate: fields.birthdate || '',
    gender: fields.gender || '',
    microchip: fields.microchip || '',
    registry: fields.registry || '',
    created_from_document_id: candidate.documentRefs[0] || '',
    ocr_confidence: candidate.confidence,
    payload: {
      sire: fields.sire || '',
      dam: fields.dam || '',
      markings: fields.markings || '',
      dnaStatus: fields.dnaStatus || '',
      createdBy: 'ocr-pipeline',
      sourceDocuments: candidate.documentRefs,
    },
  });

  await linkDocumentsAndReminders({ supabase, workspaceId, user, horseId, candidate, markReviewed: true });
  await recordAuditEvent(supabase, {
    workspaceId,
    actorUserId: user.id,
    action: 'horse.created_from_ocr',
    entityType: 'horse',
    entityId: horseId,
    metadata: { documents: candidate.documentRefs, confidence: candidate.confidence },
  });
  return horseId;
}

async function attachDocumentsToHorse({ supabase, workspaceId, user, horse, candidate, markReviewed }) {
  // Fill in identity fields the existing profile is missing; never overwrite
  // values a person already entered.
  const updates = {};
  const fillable = ['breed', 'color', 'birthdate', 'gender', 'microchip', 'registry'];
  for (const key of fillable) {
    if (!String(horse[key] || '').trim() && String(candidate.fields[key] || '').trim()) {
      updates[key] = candidate.fields[key];
    }
  }
  if (!String(horse.registration_number || '').trim() && candidate.fields.registrationNumber) {
    updates.registration_number = candidate.fields.registrationNumber;
  }
  if (Object.keys(updates).length) {
    updates.updated_at = new Date().toISOString();
    await supabase.from('horses').update(updates).eq('workspace_id', workspaceId).eq('horse_id', horse.horse_id);
  }

  await linkDocumentsAndReminders({ supabase, workspaceId, user, horseId: horse.horse_id, candidate, markReviewed });
  await recordAuditEvent(supabase, {
    workspaceId,
    actorUserId: user.id,
    action: 'horse.documents_attached',
    entityType: 'horse',
    entityId: horse.horse_id,
    metadata: { documents: candidate.documentRefs, filledFields: Object.keys(updates) },
  });
}

async function linkDocumentsAndReminders({ supabase, workspaceId, user, horseId, candidate, markReviewed }) {
  const update = {
    horse_id: horseId,
    state: 'Matched',
    updated_at: new Date().toISOString(),
  };
  if (markReviewed) {
    update.needs_review = false;
  }
  await supabase
    .from('documents')
    .update(update)
    .eq('workspace_id', workspaceId)
    .in('document_id', candidate.documentRefs);

  await supabase
    .from('document_processing_jobs')
    .update({ horse_id: horseId, status: 'completed', updated_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId)
    .in('document_id', candidate.documentRefs);

  // Compliance reminders derived from extracted dates.
  const reminders = [];
  if (candidate.documentTypes.includes('coggins') && candidate.fields.nextDueDate) {
    reminders.push({ type: 'coggins', dueDate: candidate.fields.nextDueDate, source: candidate.documentRefs[0] });
  }
  if (candidate.documentTypes.includes('health_cert') && candidate.fields.expiryDate) {
    reminders.push({ type: 'health_cert', dueDate: candidate.fields.expiryDate, source: candidate.documentRefs[0] });
  }

  for (const reminder of reminders) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reminder.dueDate)) continue;
    const { data: existing } = await supabase
      .from('reminders')
      .select('reminder_id')
      .eq('workspace_id', workspaceId)
      .eq('horse_id', horseId)
      .eq('type', reminder.type)
      .eq('due_date', reminder.dueDate)
      .maybeSingle();
    if (existing) continue;

    await supabase.from('reminders').insert({
      workspace_id: workspaceId,
      reminder_id: `rem-${randomUUID()}`,
      horse_id: horseId,
      type: reminder.type,
      due_date: reminder.dueDate,
      notification_sent: false,
      source_document_id: reminder.source,
      payload: { createdBy: 'ocr-pipeline', createdByUser: user.id },
    });
  }
}

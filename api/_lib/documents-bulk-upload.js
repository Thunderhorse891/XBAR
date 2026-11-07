import { createHash, randomUUID } from 'node:crypto';
import { readJsonBody, sendJson } from './http.js';
import { requireWorkspaceAccess } from './supabase-admin.js';
import { requireRoleCapability } from './permissions.js';
import { runOcr } from './ocr.js';
import { extractDocument, groupExtractionsIntoCandidates, NEEDS_REVIEW_THRESHOLD } from './document-extraction.js';
import { extractZipEntries, isZipBuffer, guessMimeType } from './zip.js';
import { documentObjectPath, mayUseClientStoragePath } from './document-storage.js';
import {
  getWorkspaceEntitlements,
  checkDocumentCapacity,
  checkHorseCapacity,
  checkStorageCapacity,
} from './entitlements.js';
import { recordAuditEvent } from './audit.js';
import { enforceRateLimit } from './rate-limit.js';
import { applyCors } from './cors.js';

const DOCUMENT_BUCKET =
  process.env.SUPABASE_DOCUMENT_BUCKET || process.env.VITE_SUPABASE_DOCUMENT_BUCKET || 'horse-documents';
const MAX_FILES_PER_BATCH = 25;
const MAX_OCR_TEXT_CHARS = 20000;

const RATE_LIMIT = { bucket: 'documents-upload', limit: 10, windowSeconds: 60 };

class PersistenceError extends Error {
  constructor(phase, cause) {
    super('OCR changes could not be fully confirmed. Review saved records before retrying.');
    this.phase = phase;
    this.databaseCode = cause?.code;
  }
}

async function readRows(query, phase) {
  try {
    const result = await query;
    if (!result || result.error || !Object.hasOwn(result, 'data') || result.data === undefined)
      throw new PersistenceError(phase, result?.error);
    return result.data;
  } catch (error) {
    if (error instanceof PersistenceError) throw error;
    throw new PersistenceError(phase);
  }
}

// A successful transport is insufficient: require every intended identity and
// changed field in RETURNING. Do not retry writes whose acknowledgment was lost.
async function saveRows(query, { context, phase, key, ids, fields = {} }) {
  context.writeAttempted = true;
  const data = await readRows(query.select([...new Set([key, ...Object.keys(fields)])].join(',')), phase);
  if (
    !Array.isArray(data) ||
    data.length !== ids.length ||
    new Set(data.map((row) => row[key])).size !== ids.length ||
    !data.every(
      (row) =>
        ids.includes(row[key]) &&
        Object.entries(fields).every(
          ([k, v]) =>
            row[k] === v ||
            (k === 'updated_at' &&
              typeof row[k] === 'string' &&
              Number.isFinite(Date.parse(v)) &&
              Date.parse(row[k]) === Date.parse(v)),
        ),
    )
  )
    throw new PersistenceError(phase);
  context.confirmedSteps.push(phase);
  return data;
}

function failureResult(error, context, details = {}) {
  return {
    ...details,
    ok: false,
    retryable: false,
    phase: error instanceof PersistenceError ? error.phase : 'processing',
    needsRecovery: context.writeAttempted,
    confirmedSteps: [...context.confirmedSteps],
    message:
      error instanceof PersistenceError
        ? error.message
        : 'OCR processing could not be completed. Review the saved records before retrying.',
  };
}

function sourceKey(workspaceId, documentIds) {
  return createHash('sha256')
    .update(JSON.stringify([workspaceId, [...documentIds].sort()]))
    .digest('hex');
}

async function loadDocuments(supabase, workspaceId, documentIds) {
  const rows = await readRows(
    supabase.from('documents').select('*').eq('workspace_id', workspaceId).in('document_id', documentIds),
    'document-read',
  );
  if (
    !Array.isArray(rows) ||
    rows.length !== documentIds.length ||
    new Set(rows.map((row) => row.document_id)).size !== documentIds.length ||
    rows.some((row) => row.workspace_id !== workspaceId || !documentIds.includes(row.document_id))
  ) {
    throw new PersistenceError('document-read');
  }
  return rows.sort((a, b) => a.document_id.localeCompare(b.document_id));
}

// Byte size of a file's decoded content (Buffer / Uint8Array); 0 when absent so
// storage accounting degrades safely rather than throwing.
function fileByteSize(file) {
  const content = file?.content;
  return content && typeof content.byteLength === 'number' ? content.byteLength : 0;
}

export default async function handler(req, res) {
  if (!applyCors(req, res)) {
    return;
  }

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

  // Auto ingestion can create/edit horses and mark documents reviewed. Check
  // the whole requested operation before uploading bytes or processing rows.
  // Upload-only roles can use preview; explicit commits require their actions.
  const capabilities = new Set(['uploadDocuments']);
  if (mode === 'auto')
    for (const capability of ['createHorse', 'editHorse', 'reviewDocuments']) capabilities.add(capability);
  if (mode === 'commit')
    for (const assignment of Array.isArray(body.assignments) ? body.assignments : []) {
      if (assignment?.action === 'create-horse') {
        capabilities.add('createHorse');
        capabilities.add('reviewDocuments');
      }
      if (assignment?.action === 'attach-horse') {
        capabilities.add('editHorse');
        capabilities.add('reviewDocuments');
      }
    }
  for (const capability of capabilities) {
    const denied = requireRoleCapability(access.role, capability);
    if (denied) return sendJson(res, 403, { ok: false, code: 'capability_required', message: denied });
  }

  try {
    if (mode === 'commit') {
      const result = await commitAssignments({ supabase, workspaceId, user, assignments: body.assignments });
      return sendJson(res, result.ok ? 200 : result.status || 400, result);
    }

    const result = await processBatch({ supabase, workspaceId, user, body, mode });
    return sendJson(res, result.ok ? 200 : result.status || 400, result);
  } catch {
    return sendJson(res, 500, {
      ok: false,
      retryable: false,
      message: 'Document ingestion could not be completed. Review saved records before retrying.',
    });
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
    // Checked once, before the path is either READ or RECORDED. Both matter:
    // the download below uses the service role, and a recorded `storage_path`
    // is later downloaded by the same service role in horses-export.js and
    // sale-packets.js. A caller who sends bytes AND a foreign path would
    // otherwise skip the download and still persist the path.
    const suppliedPath = typeof file.storagePath === 'string' ? file.storagePath : '';
    if (suppliedPath && !mayUseClientStoragePath({ storagePath: suppliedPath, workspaceId })) {
      skipped.push({ fileName, reason: 'storage path does not belong to this workspace' });
      continue;
    }
    let content = null;
    if (typeof file.contentBase64 === 'string' && file.contentBase64) {
      content = Buffer.from(file.contentBase64, 'base64');
    } else if (suppliedPath) {
      const { data, error } = await supabase.storage.from(DOCUMENT_BUCKET).download(suppliedPath);
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
      storagePath: suppliedPath,
    });
  }

  if (!expanded.length) {
    return { ok: false, status: 400, message: 'No processable files in this batch.', skipped };
  }
  if (expanded.length > MAX_FILES_PER_BATCH) {
    return { ok: false, status: 400, message: `Batches are limited to ${MAX_FILES_PER_BATCH} files per request.` };
  }

  const entitlements = await getWorkspaceEntitlements(supabase, workspaceId, user?.email);
  if (!entitlements.ok) {
    return { ok: false, status: entitlements.status, message: entitlements.message };
  }

  const capacity = await checkDocumentCapacity(supabase, workspaceId, expanded.length, entitlements.limits);
  if (!capacity.ok) {
    // status carries the difference between "over your limit" (403) and
    // "we could not check" (503); the latter is retryable and must not read
    // to the customer as a billing problem.
    return { ok: false, status: capacity.status ?? 403, message: capacity.message };
  }

  // Storage gate: reject the whole batch before uploading anything if the
  // combined byte size would exceed the plan's storage cap.
  const incomingStorageBytes = expanded.reduce((sum, file) => sum + fileByteSize(file), 0);
  const storage = await checkStorageCapacity(supabase, workspaceId, incomingStorageBytes, entitlements.limits);
  if (!storage.ok) {
    return { ok: false, status: storage.status ?? 403, message: storage.message };
  }

  // Horse-limit gate for auto-created horses: track remaining slots so the
  // OCR pipeline cannot exceed the tier by creating horses from documents.
  const horseCapacity = await checkHorseCapacity(supabase, workspaceId, 0, entitlements.limits);
  // Refuse before computing the allowance, exactly as commitAssignments does. A
  // failed count leaves `used` undefined, and `used ?? 0` would then hand this
  // batch a full fresh allowance regardless of how many horses already exist —
  // reading "usage unknown" as "usage zero" is the failure the gates exist to
  // prevent. Auto-creation makes it worse than a wrong number: the database
  // trigger may reject the over-limit horse while createHorseFromCandidate
  // ignores that error, links documents to it, and reports a horse that was
  // never written.
  if (!horseCapacity.ok) {
    return { ok: false, status: horseCapacity.status ?? 403, message: horseCapacity.message };
  }
  let horseSlotsLeft = Math.max(0, entitlements.limits.horseLimit - (horseCapacity.used ?? 0));

  const batchId = `batch-${randomUUID()}`;
  const context = { writeAttempted: false, confirmedSteps: [], horseId: '' };
  const documents = [];
  const extractions = [];
  const proposals = [];
  const recovery = {
    files: expanded.map((file) => {
      const documentId = `doc-${randomUUID()}`;
      return {
        documentId,
        fileName: file.fileName,
        storagePath:
          file.storagePath ||
          (file.content ? documentObjectPath({ workspaceId, documentId, fileName: file.fileName }) : ''),
        uploaded: false,
        documentSaved: false,
        jobSaved: false,
      };
    }),
  };
  try {
    const batchLabel =
      typeof body.batchLabel === 'string' && body.batchLabel
        ? body.batchLabel
        : `OCR intake ${new Date().toISOString().slice(0, 10)}`;
    await saveRows(
      supabase.from('intake_batches').insert({
        workspace_id: workspaceId,
        intake_batch_id: batchId,
        label: batchLabel,
        source: 'bulk-upload-with-ocr',
        state: 'processing',
        received_at: new Date().toISOString(),
        // Persist the inventory before uploading any original. Even a lost response
        // leaves an account-scoped path back to a partially stored file.
        payload: { fileCount: expanded.length, mode, uploadedBy: user.id, files: recovery.files },
      }),
      {
        context,
        phase: 'batch-start',
        key: 'intake_batch_id',
        ids: [batchId],
        fields: { workspace_id: workspaceId, state: 'processing' },
      },
    );

    for (const [index, file] of expanded.entries()) {
      const receipt = recovery.files[index];
      const documentId = receipt.documentId;
      const storagePath = receipt.storagePath;

      if (!file.storagePath && file.content) {
        const { data: uploaded, error: uploadError } = await supabase.storage
          .from(DOCUMENT_BUCKET)
          .upload(storagePath, file.content, { contentType: file.mimeType, upsert: true });
        if (uploadError || uploaded?.path !== storagePath) throw new PersistenceError('original-upload');
        receipt.uploaded = true;
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
        size_bytes: fileByteSize(file),
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

      try {
        await saveRows(supabase.from('documents').insert(documentRow), {
          context,
          phase: 'document-save',
          key: 'document_id',
          ids: [documentId],
          fields: { workspace_id: workspaceId, storage_path: documentRow.storage_path },
        });
      } catch (error) {
        // Only a definitive SQL rejection plus a confirmed absent row permits
        // cleanup. Timeouts/lost acknowledgments may already reference these
        // bytes: preserve them and the batch inventory for recovery.
        if (receipt.uploaded && /^(?:23\w{3}|42\w{3}|P0001)$/.test(error.databaseCode || '')) {
          try {
            const stored = await readRows(
              supabase
                .from('documents')
                .select('document_id')
                .eq('workspace_id', workspaceId)
                .eq('document_id', documentId)
                .maybeSingle(),
              'document-cleanup-read',
            );
            if (!stored) {
              const { data: removed, error: removeError } = await supabase.storage
                .from(DOCUMENT_BUCKET)
                .remove([storagePath]);
              receipt.originalRemoved =
                !removeError && Array.isArray(removed) && removed.some((item) => item.name === storagePath);
              if (receipt.originalRemoved) receipt.uploaded = false;
            }
          } catch {
            /* Keep the original inventory and report the failed operation. */
          }
        }
        throw error;
      }
      receipt.documentSaved = true;
      documents.push(summarizeDocument(documentRow));

      const jobId = `job-${randomUUID()}`;
      await saveRows(
        supabase.from('document_processing_jobs').insert({
          workspace_id: workspaceId,
          job_id: jobId,
          document_id: documentId,
          horse_id: '',
          provider: ocr.provider,
          status: needsReview ? 'needs_review' : 'completed',
          extracted_text: ocr.text.slice(0, MAX_OCR_TEXT_CHARS),
          entities: extraction.extractedData,
          processing_error: ocr.error || '',
          payload: { batchId, confidence: extraction.overallConfidence },
        }),
        {
          context,
          phase: 'processing-job-save',
          key: 'job_id',
          ids: [jobId],
          fields: { workspace_id: workspaceId, document_id: documentId },
        },
      );
      receipt.jobSaved = true;
      extractions.push({ ...extraction, ref: documentId });
    }

    // Group documents into horse candidates and match against existing horses
    // by registration number, microchip, then exact name.
    // Match loadDocuments' order: equal-confidence fields retain the first
    // value, so automatic saves and explicit recovery must use the same input.
    const candidates = groupExtractionsIntoCandidates(extractions.sort((a, b) => a.ref.localeCompare(b.ref)));
    for (const candidate of candidates) {
      const identity = candidate.ambiguous
        ? { note: 'Conflicting source identity requires review before assigning this document.' }
        : await findExistingHorse(supabase, workspaceId, candidate.fields);
      const match = identity.horse;
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
      proposals.push(proposal);
      context.horseId = '';
      context.createdHorse = false;
      recovery.currentDocumentIds = candidate.documentRefs;
      if (identity.note) {
        await markDocumentsForReview({
          supabase,
          workspaceId,
          documentIds: candidate.documentRefs,
          note: identity.note,
          context,
          holdProcessingJobs: true,
        });
        proposal.ambiguous = true;
        proposal.note = identity.note;
        for (const document of documents.filter((document) => proposal.documentIds.includes(document.documentId))) {
          document.state = 'Needs Review';
          document.needsReview = true;
        }
      } else if (mode === 'auto') {
        if (match) {
          // Identity matches (registration #/microchip) are safe to attach even
          // below the auto-create bar; the document keeps its review flag.
          await attachDocumentsToHorse({
            supabase,
            workspaceId,
            user,
            horse: match,
            candidate,
            markReviewed: confident,
            context,
          });
          proposal.action = 'attached';
          proposal.horseId = match.horse_id;
          proposal.needsReview = !confident;
        } else if (confident && (candidate.fields.name || candidate.fields.registrationNumber)) {
          if (horseSlotsLeft < 1) {
            // Over the paid tier: a confident candidate's documents were inserted
            // as 'Queued' (needs_review false). Flip them to the review state so
            // they land in the manual-resolution queue instead of being stranded.
            const limitNote = `Plan's ${entitlements.limits.horseLimit} horse limit reached — horse not auto-created. Upgrade to continue.`;
            await markDocumentsForReview({
              supabase,
              workspaceId,
              documentIds: candidate.documentRefs,
              note: limitNote,
              context,
            });
            proposal.action = 'review';
            proposal.needsReview = true;
            proposal.note = limitNote;
          } else {
            const horseId = await createHorseFromCandidate({
              supabase,
              workspaceId,
              user,
              candidate,
              context,
              horseSlotsLeft,
            });
            if (context.createdHorse) horseSlotsLeft -= 1;
            proposal.action = 'created';
            proposal.horseId = horseId;
            proposal.needsReview = false;
          }
        }
      }
      if (proposal.action !== 'review') {
        for (const document of documents.filter((document) => proposal.documentIds.includes(document.documentId))) {
          document.horseId = proposal.horseId;
          document.state = 'Matched';
          if (!proposal.needsReview) document.needsReview = false;
        }
      }
    }

    const committed = proposals.filter((proposal) => proposal.action !== 'review').length;
    const batchState = !skipped.length && committed === proposals.length ? 'completed' : 'needs-review';
    await saveRows(
      supabase
        .from('intake_batches')
        .update({
          state: batchState,
          payload: {
            fileCount: expanded.length,
            mode,
            uploadedBy: user.id,
            proposals: proposals.length,
            committed,
            files: recovery.files,
            skipped,
          },
          updated_at: new Date().toISOString(),
        })
        .eq('workspace_id', workspaceId)
        .eq('intake_batch_id', batchId),
      {
        context,
        phase: 'batch-finish',
        key: 'intake_batch_id',
        ids: [batchId],
        fields: { workspace_id: workspaceId, state: batchState },
      },
    );

    await recordAuditEvent(supabase, {
      workspaceId,
      actorUserId: user.id,
      action: 'documents.bulk_upload_with_ocr',
      entityType: 'intake_batch',
      entityId: batchId,
      metadata: { mode, files: expanded.length, proposals: proposals.length, committed, skipped: skipped.length },
    });

    return {
      ok: skipped.length === 0,
      status: skipped.length ? 409 : 200,
      partial: skipped.length > 0,
      retryable: false,
      mode,
      batchId,
      documents,
      proposals,
      skipped,
      recovery,
      summary: {
        processed: documents.length,
        autoCommitted: committed,
        awaitingReview: proposals.length - committed,
      },
    };
  } catch (error) {
    return {
      ...failureResult(error, context, {
        mode,
        batchId,
        documents,
        proposals,
        skipped,
        recovery: { ...recovery, horseId: context.horseId },
      }),
      status: 409,
      partial: context.writeAttempted,
    };
  }
}

async function commitAssignments({ supabase, workspaceId, user, assignments }) {
  const list = Array.isArray(assignments) ? assignments : [];
  if (!list.length) {
    return { ok: false, status: 400, message: 'assignments[] is required for commit mode.' };
  }

  // Horse-limit gate for review-committed creations, mirroring the auto flow.
  const entitlements = await getWorkspaceEntitlements(supabase, workspaceId, user?.email);
  if (!entitlements.ok) {
    return { ok: false, status: entitlements.status, message: entitlements.message };
  }

  const horseCapacity = await checkHorseCapacity(supabase, workspaceId, 0, entitlements.limits);
  // Without this check a failed count left `used` undefined, so horseSlotsLeft
  // became the entire tier limit and the gate granted a full allowance on the
  // strength of a query that never returned.
  if (!horseCapacity.ok) {
    return { ok: false, status: horseCapacity.status ?? 403, message: horseCapacity.message };
  }
  let horseSlotsLeft = Math.max(0, entitlements.limits.horseLimit - (horseCapacity.used ?? 0));

  const results = [];
  for (const assignment of list) {
    const documentIds = Array.isArray(assignment?.documentIds) ? assignment.documentIds : [];
    const action = assignment?.action;
    if (
      !documentIds.length ||
      documentIds.some((id) => typeof id !== 'string' || !id.trim()) ||
      new Set(documentIds).size !== documentIds.length ||
      !['create-horse', 'attach-horse', 'skip'].includes(action)
    ) {
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

    const context = { writeAttempted: false, confirmedSteps: [], horseId: '' };
    try {
      const rows = await loadDocuments(supabase, workspaceId, documentIds);

      // Rebuild the merged candidate from stored extractions plus any user
      // corrections supplied in overrides.
      const candidate = {
        fields: {},
        confidenceMap: {},
        documentRefs: [],
        documentTypes: [],
        confidence: 0,
        documentRows: rows,
      };
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
        const horse = await readRows(
          supabase.from('horses').select('*').eq('workspace_id', workspaceId).eq('horse_id', horseId).maybeSingle(),
          'horse-read',
        );
        if (!horse) {
          results.push({ ok: false, documentIds, message: `Horse ${horseId} not found.` });
          continue;
        }
        context.horseId = horseId;
        await attachDocumentsToHorse({ supabase, workspaceId, user, horse, candidate, markReviewed: true, context });
        results.push({ ok: true, documentIds, action, horseId });
      } else {
        const horseId = await createHorseFromCandidate({
          supabase,
          workspaceId,
          user,
          candidate,
          context,
          horseSlotsLeft,
        });
        if (context.createdHorse) horseSlotsLeft -= 1;
        results.push({ ok: true, documentIds, action, horseId });
      }
    } catch (error) {
      if (context.createdHorse) horseSlotsLeft -= 1;
      results.push(failureResult(error, context, { documentIds, action, horseId: context.horseId }));
      if (context.writeAttempted) {
        // Unknown writes also make the remaining capacity unknown. Stop this
        // request and preserve every not-yet-attempted assignment explicitly.
        for (const pending of list.slice(results.length))
          results.push({
            ok: false,
            action: pending?.action,
            documentIds: pending?.documentIds || [],
            phase: 'not-attempted',
            needsRecovery: false,
            message: 'An earlier assignment needs recovery; this assignment was not attempted.',
          });
        break;
      }
    }
  }

  if (results.some((result) => result.ok && result.action !== 'skip'))
    await recordAuditEvent(supabase, {
      workspaceId,
      actorUserId: user.id,
      action: 'documents.commit_assignments',
      entityType: 'documents',
      metadata: { assignments: results.length },
    });

  const ok = results.every((result) => result.ok);
  return {
    ok,
    status: ok ? 200 : 409,
    mode: 'commit',
    retryable: false,
    partial: !ok && results.some((result) => result.ok || result.needsRecovery),
    results,
  };
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
    horseId: row.horse_id,
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
  const conflict = {
    note: 'Horse identity conflicts or has multiple matches. Review the original before assigning it.',
  };
  const matches = [];
  // Consult both strong identifiers before choosing a horse. A registration
  // match does not waive a contradictory microchip (or vice versa).
  for (const [field, column] of [
    ['registrationNumber', 'registration_number'],
    ['microchip', 'microchip'],
  ]) {
    const value = String(fields[field] || '').trim();
    if (!value) continue;
    const data = await readRows(
      supabase.from('horses').select('*').eq('workspace_id', workspaceId).eq(column, value).limit(2),
      'horse-match-read',
    );
    if (!Array.isArray(data)) throw new PersistenceError('horse-match-read');
    if (data.length > 1) return conflict;
    if (data[0]) matches.push({ ...data[0], matchedBy: column });
  }
  if (new Set(matches.map((horse) => horse.horse_id)).size > 1) return conflict;
  if (matches[0]) {
    return contradictsHorseIdentity(fields, matches[0]) ? conflict : { horse: matches[0] };
  }

  const name = String(fields.name || '').trim();
  if (name) {
    const data = await readRows(
      supabase.from('horses').select('*').eq('workspace_id', workspaceId).ilike('name', name).limit(2),
      'horse-match-read',
    );
    if (!Array.isArray(data)) throw new PersistenceError('horse-match-read');
    if (data.length > 1) return conflict;
    if (data[0]) {
      return contradictsHorseIdentity(fields, data[0]) ? conflict : { horse: { ...data[0], matchedBy: 'name' } };
    }
  }

  return {};
}

function contradictsHorseIdentity(fields, horse) {
  const identifier = (value) =>
    String(value || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
  const name = (value) =>
    String(value || '')
      .trim()
      .replace(/\s+/g, ' ')
      .toUpperCase();
  return [
    [fields.registrationNumber, horse.registration_number, identifier],
    [fields.microchip, horse.microchip, identifier],
    [fields.name, horse.name, name],
  ].some(
    ([source, saved, normalize]) => normalize(source) && normalize(saved) && normalize(source) !== normalize(saved),
  );
}

// Move a set of documents into the manual review queue. Used when auto-create
// is blocked (e.g. horse limit reached) so confident-but-uncreated documents
// don't linger in 'Queued' where the review surfaces never show them.
async function markDocumentsForReview({
  supabase,
  workspaceId,
  documentIds,
  note,
  context,
  holdProcessingJobs = false,
}) {
  const ids = (documentIds || []).filter((id) => typeof id === 'string' && id);
  if (!ids.length) return;
  await saveRows(
    supabase
      .from('documents')
      .update({ state: 'Needs Review', needs_review: true, review_notes: note, updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId)
      .eq('horse_id', '')
      .in('document_id', ids),
    {
      context,
      phase: 'document-review-hold',
      key: 'document_id',
      ids,
      fields: { workspace_id: workspaceId, state: 'Needs Review', needs_review: true },
    },
  );
  if (holdProcessingJobs) {
    await saveRows(
      supabase
        .from('document_processing_jobs')
        .update({ status: 'needs_review' })
        .eq('workspace_id', workspaceId)
        .eq('horse_id', '')
        .in('document_id', ids),
      {
        context,
        phase: 'job-review-hold',
        key: 'document_id',
        ids,
        fields: { workspace_id: workspaceId, status: 'needs_review' },
      },
    );
  }
}

async function createHorseFromCandidate({
  supabase,
  workspaceId,
  user,
  candidate,
  context,
  horseSlotsLeft = Infinity,
}) {
  // A lost response must not turn an identical source assignment into another
  // horse. INSERT (never UPSERT) also prevents a retry overwriting owner edits.
  const key = sourceKey(workspaceId, candidate.documentRefs);
  const horseId = `horse-ocr-${key.slice(0, 32)}`;
  context.horseId = horseId;
  const fields = candidate.fields;
  const requestHash = createHash('sha256')
    .update(JSON.stringify(Object.entries(fields).sort(([a], [b]) => a.localeCompare(b))))
    .digest('hex');
  candidate.documentRows ||= await loadDocuments(supabase, workspaceId, candidate.documentRefs);
  if (candidate.documentRows.some((row) => row.horse_id && row.horse_id !== horseId))
    throw new PersistenceError('document-target');
  const existing = await readRows(
    supabase.from('horses').select('*').eq('workspace_id', workspaceId).eq('horse_id', horseId).maybeSingle(),
    'horse-read',
  );
  if (existing) {
    if (existing.payload?.ocrSourceKey !== key || existing.payload?.ocrRequestHash !== requestHash)
      throw new PersistenceError('horse-recovery');
    await linkDocumentsAndReminders({ supabase, workspaceId, user, horseId, candidate, markReviewed: true, context });
    return horseId;
  }
  if (horseSlotsLeft < 1) throw new PersistenceError('horse-capacity');

  const profile = await readRows(
    supabase
      .from('workspace_profiles')
      .select('default_owner_name, default_barn')
      .eq('workspace_id', workspaceId)
      .maybeSingle(),
    'workspace-profile-read',
  );

  await saveRows(
    supabase.from('horses').insert({
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
        ocrSourceKey: key,
        ocrRequestHash: requestHash,
      },
    }),
    { context, phase: 'horse-save', key: 'horse_id', ids: [horseId], fields: { workspace_id: workspaceId } },
  );
  context.createdHorse = true;

  await linkDocumentsAndReminders({ supabase, workspaceId, user, horseId, candidate, markReviewed: true, context });
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

async function attachDocumentsToHorse({ supabase, workspaceId, user, horse, candidate, markReviewed, context }) {
  context.horseId = horse.horse_id;
  candidate.documentRows ||= await loadDocuments(supabase, workspaceId, candidate.documentRefs);
  if (candidate.documentRows.some((row) => row.horse_id && row.horse_id !== horse.horse_id))
    throw new PersistenceError('document-target');
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
    let query = supabase
      .from('horses')
      .update(updates)
      .eq('workspace_id', workspaceId)
      .eq('horse_id', horse.horse_id)
      .eq('updated_at', horse.updated_at);
    for (const key of Object.keys(updates).filter((key) => key !== 'updated_at'))
      query = horse[key] == null ? query.is(key, null) : query.eq(key, horse[key]);
    await saveRows(query, {
      context,
      phase: 'horse-update',
      key: 'horse_id',
      ids: [horse.horse_id],
      fields: { workspace_id: workspaceId, ...updates },
    });
  }

  await linkDocumentsAndReminders({
    supabase,
    workspaceId,
    user,
    horseId: horse.horse_id,
    candidate,
    markReviewed,
    context,
  });
  await recordAuditEvent(supabase, {
    workspaceId,
    actorUserId: user.id,
    action: 'horse.documents_attached',
    entityType: 'horse',
    entityId: horse.horse_id,
    metadata: { documents: candidate.documentRefs, filledFields: Object.keys(updates) },
  });
}

async function linkDocumentsAndReminders({ supabase, workspaceId, user, horseId, candidate, markReviewed, context }) {
  const jobs = await readRows(
    supabase
      .from('document_processing_jobs')
      .select('*')
      .eq('workspace_id', workspaceId)
      .in('document_id', candidate.documentRefs),
    'processing-job-read',
  );
  if (
    !Array.isArray(jobs) ||
    jobs.some(
      (job) =>
        job.workspace_id !== workspaceId ||
        !candidate.documentRefs.includes(job.document_id) ||
        (job.horse_id && job.horse_id !== horseId),
    )
  )
    throw new PersistenceError('processing-job-read');
  for (const row of candidate.documentRows.filter((row) => !jobs.some((job) => job.document_id === row.document_id))) {
    // An interrupted preview can save the document but not its processing row.
    // Rebuild only from its persisted extraction, never by re-uploading bytes.
    if (!row.payload?.ocrProvider) throw new PersistenceError('processing-job-read');
    const job = {
      workspace_id: workspaceId,
      job_id: `job-ocr-${sourceKey(workspaceId, [row.document_id]).slice(0, 32)}`,
      document_id: row.document_id,
      horse_id: '',
      provider: row.payload.ocrProvider,
      status: 'needs_review',
      extracted_text: row.ocr_text || '',
      entities: row.extracted_data || {},
      processing_error: '',
      payload: { batchId: row.intake_batch_id, recoveredFromStoredDocument: true },
    };
    await saveRows(supabase.from('document_processing_jobs').insert(job), {
      context,
      phase: 'processing-job-recovery',
      key: 'job_id',
      ids: [job.job_id],
      fields: { workspace_id: workspaceId, document_id: row.document_id },
    });
    jobs.push(job);
  }
  const update = {
    horse_id: horseId,
    state: 'Matched',
    updated_at: new Date().toISOString(),
  };
  if (markReviewed) {
    update.needs_review = false;
  }
  for (const row of candidate.documentRows)
    await saveRows(
      supabase
        .from('documents')
        .update(update)
        .eq('workspace_id', workspaceId)
        .eq('document_id', row.document_id)
        .eq('horse_id', row.horse_id)
        .eq('updated_at', row.updated_at),
      {
        context,
        phase: 'document-link',
        key: 'document_id',
        ids: [row.document_id],
        fields: { workspace_id: workspaceId, ...update },
      },
    );

  for (const job of jobs) {
    let query = supabase
      .from('document_processing_jobs')
      .update({ horse_id: horseId, status: 'completed', updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId)
      .eq('job_id', job.job_id)
      .eq('horse_id', job.horse_id);
    if (job.updated_at) query = query.eq('updated_at', job.updated_at);
    await saveRows(query, {
      context,
      phase: 'processing-job-link',
      key: 'job_id',
      ids: [job.job_id],
      fields: { workspace_id: workspaceId, horse_id: horseId, status: 'completed' },
    });
  }

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
    const existing = await readRows(
      supabase
        .from('reminders')
        .select('reminder_id')
        .eq('workspace_id', workspaceId)
        .eq('horse_id', horseId)
        .eq('type', reminder.type)
        .eq('due_date', reminder.dueDate)
        .maybeSingle(),
      'reminder-read',
    );
    if (existing) continue;

    const reminderId = `rem-ocr-${sourceKey(workspaceId, [horseId, reminder.type, reminder.dueDate]).slice(0, 32)}`;
    await saveRows(
      supabase.from('reminders').insert({
        workspace_id: workspaceId,
        reminder_id: reminderId,
        horse_id: horseId,
        type: reminder.type,
        due_date: reminder.dueDate,
        notification_sent: false,
        source_document_id: reminder.source,
        payload: { createdBy: 'ocr-pipeline', createdByUser: user.id },
      }),
      {
        context,
        phase: 'reminder-save',
        key: 'reminder_id',
        ids: [reminderId],
        fields: { workspace_id: workspaceId, horse_id: horseId, type: reminder.type, due_date: reminder.dueDate },
      },
    );
  }
}

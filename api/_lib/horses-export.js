import { sendJson, getQuery } from './http.js';
import { requireWorkspaceAccess } from './supabase-admin.js';
import { recordAuditEvent } from './audit.js';
import { enforceRateLimit } from './rate-limit.js';
import { applyCors } from './cors.js';
import {
  PACKET_FILE_NOT_STORED,
  PACKET_PATH_REFUSED,
  recordedDocumentPath,
  signRecordedObjects,
} from './document-storage.js';

// Full data export for one horse: profile, documents (with 1-hour signed
// URLs for the original files), ownership records, reminders, and sale
// packets — suitable for hand-off to a buyer's agent or a third-party system.

const DOCUMENT_BUCKET =
  process.env.SUPABASE_DOCUMENT_BUCKET || process.env.VITE_SUPABASE_DOCUMENT_BUCKET || 'horse-documents';
const PACKET_BUCKET = process.env.SUPABASE_SALE_PACKET_BUCKET || 'sale-packets';
const SIGNED_URL_TTL_SECONDS = 3600;

const RATE_LIMIT = { bucket: 'horses-export', limit: 12, windowSeconds: 60 };

const DOCUMENT_HAS_NO_FILE = 'No file is attached to this document.';
const DOCUMENT_ON_DEVICE_ONLY =
  'This file is saved only on the device it was added from, not in the cloud, so it is not in this export. Upload it from that device to include it.';

export default async function handler(req, res) {
  if (!applyCors(req, res, { methods: 'GET, OPTIONS' })) {
    return;
  }

  if (req.method !== 'GET') {
    return sendJson(res, 405, { ok: false, message: 'Method not allowed.' });
  }

  if (!(await enforceRateLimit(req, res, RATE_LIMIT))) {
    return;
  }

  const accessToken = req.headers.authorization?.replace(/^Bearer\s+/i, '').trim() || '';
  const query = getQuery(req);
  const workspaceId = query.workspaceId || '';
  const horseId = query.horseId || '';
  if (!workspaceId || !horseId) {
    return sendJson(res, 400, { ok: false, message: 'workspaceId and horseId query parameters are required.' });
  }

  const access = await requireWorkspaceAccess(accessToken, workspaceId);
  if (!access.ok) {
    return sendJson(res, access.status, { ok: false, message: access.message });
  }
  const { supabase, user } = access;

  const { data: horse } = await supabase
    .from('horses')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('horse_id', horseId)
    .maybeSingle();
  if (!horse) {
    return sendJson(res, 404, { ok: false, message: `Horse ${horseId} not found in this workspace.` });
  }

  const [{ data: documents }, { data: ownership }, { data: reminders }, { data: packets }] = await Promise.all([
    supabase
      .from('documents')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('horse_id', horseId)
      .order('created_at', { ascending: false }),
    supabase.from('ownership_records').select('*').eq('workspace_id', workspaceId).eq('horse_id', horseId),
    supabase
      .from('reminders')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('horse_id', horseId)
      .order('due_date', { ascending: true }),
    supabase
      .from('sale_packets')
      .select('packet_id, packet_pdf_path, watermark_text, shared_with_email, status, created_at')
      .eq('workspace_id', workspaceId)
      .eq('horse_id', horseId),
  ]);

  /*
   * Both paths below are columns a workspace manager can edit, and they are
   * signed with the service role, which bypasses Storage RLS. signRecordedObjects
   * signs only canonical paths under this workspace; anything else stays in the
   * export, marked with the reason, and a refused path is audited.
   */
  const documentRows = documents || [];
  const packetRows = packets || [];
  // Independent batches: sign both in one round trip.
  const [documentSigned, packetSigned] = await Promise.all([
    signRecordedObjects({
      supabase,
      bucket: DOCUMENT_BUCKET,
      paths: documentRows.map(recordedDocumentPath),
      workspaceId,
      ttlSeconds: SIGNED_URL_TTL_SECONDS,
      emptyReason: DOCUMENT_HAS_NO_FILE,
    }),
    signRecordedObjects({
      supabase,
      bucket: PACKET_BUCKET,
      paths: packetRows.map((packet) => packet.packet_pdf_path || ''),
      workspaceId,
      ttlSeconds: SIGNED_URL_TTL_SECONDS,
      emptyReason: PACKET_FILE_NOT_STORED,
      refusedReason: PACKET_PATH_REFUSED,
    }),
  ]);
  const documentExports = documentRows.map((doc, index) => {
    const signed = documentSigned[index];
    // A document kept only in the on-device vault has no cloud path, which is
    // not the same as having no file: say where it is, as packet assembly does.
    if (signed.unavailable === DOCUMENT_HAS_NO_FILE && doc.payload?.localFileKey) {
      signed.unavailable = DOCUMENT_ON_DEVICE_ONLY;
    }
    return {
      documentId: doc.document_id,
      title: doc.title,
      documentType: doc.document_type,
      originalFilename: doc.original_filename,
      mimeType: doc.mime_type,
      state: doc.state,
      confidence: doc.confidence,
      needsReview: doc.needs_review,
      extractedData: doc.extracted_data,
      ocrConfidenceMap: doc.ocr_confidence_map,
      createdAt: doc.created_at,
      downloadUrl: signed.url || '',
      ...(signed.unavailable ? { downloadUnavailable: signed.unavailable } : {}),
    };
  });

  const packetExports = packetRows.map((packet, index) => {
    const signed = packetSigned[index];
    return {
      packetId: packet.packet_id,
      watermarkText: packet.watermark_text,
      sharedWithEmail: packet.shared_with_email,
      status: packet.status,
      createdAt: packet.created_at,
      downloadUrl: signed.url || '',
      ...(signed.unavailable ? { downloadUnavailable: signed.unavailable } : {}),
    };
  });

  const refusedPaths = [
    ...documentRows.filter((_, index) => documentSigned[index].refused).map((doc) => `document:${doc.document_id}`),
    ...packetRows.filter((_, index) => packetSigned[index].refused).map((packet) => `packet:${packet.packet_id}`),
  ];
  if (refusedPaths.length) {
    await recordAuditEvent(supabase, {
      workspaceId,
      actorUserId: user.id,
      action: 'storage.path_refused',
      entityType: 'horse',
      entityId: horseId,
      metadata: { rows: refusedPaths },
    });
  }

  await recordAuditEvent(supabase, {
    workspaceId,
    actorUserId: user.id,
    action: 'horse.exported',
    entityType: 'horse',
    entityId: horseId,
    metadata: { documents: documentExports.length },
  });

  return sendJson(res, 200, {
    ok: true,
    exportedAt: new Date().toISOString(),
    signedUrlTtlSeconds: SIGNED_URL_TTL_SECONDS,
    horse: {
      horseId: horse.horse_id,
      name: horse.name,
      breed: horse.breed,
      color: horse.color,
      birthdate: horse.birthdate,
      gender: horse.gender,
      microchip: horse.microchip,
      registrationNumber: horse.registration_number,
      registry: horse.registry,
      ownerName: horse.owner_name,
      barnName: horse.barn_name,
      status: horse.status,
      ocrConfidence: horse.ocr_confidence,
      createdFromDocumentId: horse.created_from_document_id,
      payload: horse.payload,
    },
    documents: documentExports,
    ownershipRecords: ownership || [],
    reminders: reminders || [],
    salePackets: packetExports,
  });
}

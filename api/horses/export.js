import { sendJson, getQuery } from '../_lib/http.js';
import { requireWorkspaceAccess } from '../_lib/supabase-admin.js';
import { recordAuditEvent } from '../_lib/audit.js';
import { enforceRateLimit } from '../_lib/rate-limit.js';

// Full data export for one horse: profile, documents (with 1-hour signed
// URLs for the original files), ownership records, reminders, and sale
// packets — suitable for hand-off to a buyer's agent or a third-party system.

const DOCUMENT_BUCKET =
  process.env.SUPABASE_DOCUMENT_BUCKET || process.env.VITE_SUPABASE_DOCUMENT_BUCKET || 'horse-documents';
const PACKET_BUCKET = process.env.SUPABASE_SALE_PACKET_BUCKET || 'sale-packets';
const SIGNED_URL_TTL_SECONDS = 3600;

const RATE_LIMIT = { bucket: 'horses-export', limit: 12, windowSeconds: 60 };

export default async function handler(req, res) {
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

  const documentExports = [];
  for (const doc of documents || []) {
    let downloadUrl = '';
    if (doc.storage_path) {
      const { data: signed } = await supabase.storage
        .from(DOCUMENT_BUCKET)
        .createSignedUrl(doc.storage_path, SIGNED_URL_TTL_SECONDS);
      downloadUrl = signed?.signedUrl || '';
    }
    documentExports.push({
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
      downloadUrl,
    });
  }

  const packetExports = [];
  for (const packet of packets || []) {
    const { data: signed } = await supabase.storage
      .from(PACKET_BUCKET)
      .createSignedUrl(packet.packet_pdf_path, SIGNED_URL_TTL_SECONDS);
    packetExports.push({
      packetId: packet.packet_id,
      watermarkText: packet.watermark_text,
      sharedWithEmail: packet.shared_with_email,
      status: packet.status,
      createdAt: packet.created_at,
      downloadUrl: signed?.signedUrl || '',
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

import { randomUUID } from 'node:crypto';
import { readJsonBody, sendJson, getQuery } from './_lib/http.js';
import { requireWorkspaceAccess } from './_lib/supabase-admin.js';
import { checkSalePacketCapacity, getWorkspaceEntitlements, tierIncludesPlan } from './_lib/entitlements.js';
import { loadHorseContext } from './_lib/horse-context.js';
import { createSectionedPdf, assemblePacketPdf } from './_lib/pdf.js';
import { sendEmail } from './_lib/email.js';
import { recordAuditEvent } from './_lib/audit.js';

const DOCUMENT_BUCKET = process.env.SUPABASE_DOCUMENT_BUCKET || process.env.VITE_SUPABASE_DOCUMENT_BUCKET || 'horse-documents';
const PACKET_BUCKET = process.env.SUPABASE_SALE_PACKET_BUCKET || 'sale-packets';
const SIGNED_URL_TTL_SECONDS = 3600;
const MAX_PACKET_ATTACHMENTS = 20;

export default async function handler(req, res) {
  const accessToken = req.headers.authorization?.replace(/^Bearer\s+/i, '').trim() || '';

  if (req.method === 'GET') {
    const query = getQuery(req);
    const workspaceId = query.workspaceId || '';
    const access = await requireWorkspaceAccess(accessToken, workspaceId);
    if (!access.ok) {
      return sendJson(res, access.status, { ok: false, message: access.message });
    }
    return listPackets(res, access, query.horseId || '');
  }

  if (req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, message: 'Method not allowed.' });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { ok: false, message: 'Request body must be valid JSON.' });
  }

  const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : '';
  const horseId = typeof body.horseId === 'string' ? body.horseId : '';
  if (!workspaceId || !horseId) {
    return sendJson(res, 400, { ok: false, message: 'workspaceId and horseId are required.' });
  }

  const access = await requireWorkspaceAccess(accessToken, workspaceId);
  if (!access.ok) {
    return sendJson(res, access.status, { ok: false, message: access.message });
  }
  const { supabase, user } = access;

  const entitlements = await getWorkspaceEntitlements(supabase, workspaceId);
  if (!tierIncludesPlan(entitlements.effectiveTier, 'Professional')) {
    return sendJson(res, 403, {
      ok: false,
      code: 'tier_required',
      message: `Sale packet assembly requires the Professional plan (current effective plan: ${entitlements.effectiveTier}).`,
      requiredPlan: 'Professional',
      currentPlan: entitlements.effectiveTier,
      billingState: entitlements.billingState,
    });
  }
  const capacity = await checkSalePacketCapacity(supabase, workspaceId, 1, entitlements.limits);
  if (!capacity.ok) {
    return sendJson(res, 403, {
      ok: false,
      code: 'sale_packet_limit_reached',
      message: capacity.message,
      currentPlan: entitlements.effectiveTier,
      billingState: entitlements.billingState,
    });
  }

  try {
    const loaded = await loadHorseContext(supabase, workspaceId, horseId);
    if (!loaded.horse) {
      return sendJson(res, 404, { ok: false, message: `Horse ${horseId} not found in this workspace.` });
    }

    const buyerName = typeof body.buyerName === 'string' ? body.buyerName.trim() : '';
    const buyerEmail = typeof body.buyerEmail === 'string' ? body.buyerEmail.trim().toLowerCase() : '';
    const watermarkText = typeof body.watermarkText === 'string' && body.watermarkText.trim()
      ? body.watermarkText.trim()
      : buyerName
        ? `Copy for ${buyerName} - ${new Date().toISOString().slice(0, 10)}`
        : '';

    // Select the documents to bundle: caller-specified list, or every stored
    // document attached to the horse (originals + generated templates).
    const requestedIds = Array.isArray(body.documentIds) ? body.documentIds.filter((id) => typeof id === 'string') : [];
    let packetDocs = loaded.documents.filter((doc) => doc.storage_path);
    if (requestedIds.length) {
      packetDocs = packetDocs.filter((doc) => requestedIds.includes(doc.document_id));
    }
    packetDocs = packetDocs.slice(0, MAX_PACKET_ATTACHMENTS);

    const attachments = [];
    const unavailable = [];
    for (const doc of packetDocs) {
      const { data, error } = await supabase.storage.from(DOCUMENT_BUCKET).download(doc.storage_path);
      if (error || !data) {
        unavailable.push(`${doc.title} (${error?.message || 'download failed'})`);
        continue;
      }
      attachments.push({
        label: `${doc.document_type}: ${doc.title}`,
        mimeType: doc.mime_type,
        bytes: new Uint8Array(await data.arrayBuffer()),
      });
    }

    const context = loaded.context;
    const coverBytes = await createSectionedPdf({
      title: `Sale Packet: ${context.horse.name}`,
      sections: [
        {
          heading: 'Horse Summary',
          lines: [
            `Name: ${context.horse.name}`,
            `Registration #: ${context.horse.registrationNumber || 'Not on file'} ${context.horse.registry ? `(${context.horse.registry})` : ''}`.trim(),
            `Breed: ${context.horse.breed || 'Not on file'}    Color: ${context.horse.color || 'Not on file'}`,
            `Foaled: ${context.horse.birthdate || 'Not on file'}    Sex: ${context.horse.gender || 'Not on file'}`,
            `Microchip: ${context.horse.microchip || 'Not on file'}`,
            `Latest Coggins test: ${context.health.lastCogginsDate || 'Not on file'}`,
            `Legal owner: ${context.owner.name || 'Not on file'}`,
          ],
        },
        {
          heading: 'Presented By',
          lines: [
            `${context.workspace.businessName || 'XBAR workspace'} (${context.workspace.ranchName || ''})`.trim(),
            buyerName ? `Prepared for: ${buyerName}` : 'Prepared for: prospective buyer',
            `Prepared on: ${context.today_date}`,
          ],
        },
        {
          heading: 'Included Documents',
          lines: packetDocs.length
            ? packetDocs.map((doc, index) => `${index + 1}. ${doc.document_type}: ${doc.title}`)
            : ['No stored documents were attached to this horse.'],
        },
      ],
      footer: `XBAR sale packet · ${context.horse.name} · ${context.today_date}`,
    });

    const packetBytes = await assemblePacketPdf({ coverBytes, attachments, watermarkText });

    const packetId = `packet-${randomUUID()}`;
    const packetPath = `${workspaceId}/${horseId}/${packetId}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from(PACKET_BUCKET)
      .upload(packetPath, Buffer.from(packetBytes), { contentType: 'application/pdf', upsert: true });
    if (uploadError) {
      return sendJson(res, 502, { ok: false, message: `Failed to store sale packet: ${uploadError.message}` });
    }

    await supabase.from('sale_packets').upsert({
      workspace_id: workspaceId,
      packet_id: packetId,
      horse_id: horseId,
      created_by_user_id: user.id,
      packet_pdf_path: packetPath,
      watermark_text: watermarkText,
      shared_with_email: buyerEmail,
      document_ids: packetDocs.map((doc) => doc.document_id),
      status: 'ready',
      payload: { buyerName, unavailable, attachmentCount: attachments.length },
    });

    const { data: signed } = await supabase.storage
      .from(PACKET_BUCKET)
      .createSignedUrl(packetPath, SIGNED_URL_TTL_SECONDS);
    const downloadUrl = signed?.signedUrl || '';

    let emailResult = { ok: false, skipped: true };
    if (buyerEmail && downloadUrl) {
      emailResult = await sendEmail({
        to: buyerEmail,
        subject: `Sale packet for ${context.horse.name}`,
        text: `${context.workspace.businessName || 'An XBAR workspace'} shared a sale packet for ${context.horse.name}. Download it here (link expires in 1 hour): ${downloadUrl}`,
        html: `<p>${context.workspace.businessName || 'An XBAR workspace'} shared a sale packet for <strong>${context.horse.name}</strong>.</p><p><a href="${downloadUrl}">Download the packet</a> (link expires in 1 hour).</p>`,
      });
    }

    await recordAuditEvent(supabase, {
      workspaceId,
      actorUserId: user.id,
      action: 'sale_packet.created',
      entityType: 'sale_packet',
      entityId: packetId,
      metadata: { horseId, documents: packetDocs.length, buyerEmail: buyerEmail ? 'set' : '', emailed: Boolean(emailResult.ok) },
    });

    return sendJson(res, 200, {
      ok: true,
      packetId,
      horseId,
      packetPdfPath: packetPath,
      downloadUrl,
      expiresInSeconds: SIGNED_URL_TTL_SECONDS,
      watermarkText,
      includedDocumentIds: packetDocs.map((doc) => doc.document_id),
      unavailableDocuments: unavailable,
      emailed: Boolean(emailResult.ok),
      emailMessage: emailResult.message || '',
    });
  } catch (error) {
    return sendJson(res, 500, { ok: false, message: `Sale packet assembly failed: ${error.message}` });
  }
}

async function listPackets(res, access, horseId) {
  const { supabase, workspaceId } = access;
  let query = supabase
    .from('sale_packets')
    .select('packet_id, horse_id, packet_pdf_path, watermark_text, shared_with_email, document_ids, status, created_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (horseId) {
    query = query.eq('horse_id', horseId);
  }

  const { data, error } = await query;
  if (error) {
    return sendJson(res, 500, { ok: false, message: error.message });
  }

  const packets = [];
  for (const row of data || []) {
    const { data: signed } = await supabase.storage
      .from(PACKET_BUCKET)
      .createSignedUrl(row.packet_pdf_path, SIGNED_URL_TTL_SECONDS);
    packets.push({
      packetId: row.packet_id,
      horseId: row.horse_id,
      watermarkText: row.watermark_text,
      sharedWithEmail: row.shared_with_email,
      documentIds: row.document_ids,
      status: row.status,
      createdAt: row.created_at,
      downloadUrl: signed?.signedUrl || '',
      expiresInSeconds: SIGNED_URL_TTL_SECONDS,
    });
  }

  return sendJson(res, 200, { ok: true, packets });
}

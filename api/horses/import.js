import { randomUUID } from 'node:crypto';
import { readJsonBody, sendJson } from '../_lib/http.js';
import { requireWorkspaceAccess } from '../_lib/supabase-admin.js';
import { recordAuditEvent } from '../_lib/audit.js';
import { normalizeDate } from '../_lib/document-extraction.js';
import { enforceRateLimit } from '../_lib/rate-limit.js';
import { horsesImportSchema, parseBody } from '../_lib/validation.js';
import { applyCors } from '../_lib/cors.js';

// Bulk CSV import of horses. Accepts { workspaceId, csv } where csv is the
// raw file contents. Header names are matched case-insensitively against the
// aliases below (covers the legacy Horse_export.csv format).

const COLUMN_ALIASES = {
  name: ['name', 'horse name', 'horse'],
  breed: ['breed'],
  color: ['color', 'colour'],
  birthdate: ['birthdate', 'birth date', 'foaled', 'date of birth', 'dob'],
  gender: ['gender', 'sex'],
  status: ['status'],
  registration_number: ['registration number', 'registration #', 'reg number', 'reg #', 'registration'],
  registry: ['registry'],
  microchip: ['microchip', 'microchip number', 'chip'],
  owner_name: ['owner', 'owner name', 'legal owner'],
  barn_name: ['barn', 'barn name'],
};

const RATE_LIMIT = { bucket: 'horses-import', limit: 6, windowSeconds: 60 };

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

  const parsed = parseBody(horsesImportSchema, body);
  if (!parsed.ok || !parsed.data.csv.trim()) {
    const oversize = parsed.ok ? '' : parsed.message;
    return sendJson(res, 400, {
      ok: false,
      message: oversize.includes('2 MB') ? oversize : 'workspaceId and csv are required.',
    });
  }
  const { workspaceId, csv } = parsed.data;

  const access = await requireWorkspaceAccess(accessToken, workspaceId);
  if (!access.ok) {
    return sendJson(res, access.status, { ok: false, message: access.message });
  }
  const { supabase, user } = access;

  const rows = parseCsv(csv);
  if (rows.length < 2) {
    return sendJson(res, 400, { ok: false, message: 'CSV must include a header row and at least one data row.' });
  }

  const header = rows[0].map((cell) => cell.trim().toLowerCase());
  const columnMap = {};
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const index = header.findIndex((cell) => aliases.includes(cell));
    if (index >= 0) columnMap[field] = index;
  }
  if (!('name' in columnMap)) {
    return sendJson(res, 400, { ok: false, message: 'CSV must include a Name column.' });
  }

  let imported = 0;
  let updated = 0;
  const errors = [];

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!row.length || row.every((cell) => !cell.trim())) continue;

    const value = (field) => (field in columnMap ? String(row[columnMap[field]] || '').trim() : '');
    const name = value('name');
    if (!name) {
      errors.push({ row: rowIndex + 1, message: 'Missing horse name.' });
      continue;
    }

    const registration = value('registration_number');
    const fields = {
      name,
      breed: value('breed'),
      color: value('color'),
      birthdate: normalizeDate(value('birthdate')) || value('birthdate'),
      gender: value('gender'),
      status: value('status') || 'Active',
      registration_number: registration,
      registry: value('registry'),
      microchip: value('microchip'),
      owner_name: value('owner_name'),
      barn_name: value('barn_name'),
    };

    try {
      let existing = null;
      if (registration) {
        const { data } = await supabase
          .from('horses')
          .select('horse_id')
          .eq('workspace_id', workspaceId)
          .eq('registration_number', registration)
          .maybeSingle();
        existing = data;
      }

      if (existing) {
        await supabase
          .from('horses')
          .update({ ...fields, updated_at: new Date().toISOString() })
          .eq('workspace_id', workspaceId)
          .eq('horse_id', existing.horse_id);
        updated += 1;
      } else {
        await supabase.from('horses').insert({
          workspace_id: workspaceId,
          horse_id: `horse-${randomUUID()}`,
          ...fields,
          payload: { importedBy: user.id, importSource: 'csv' },
        });
        imported += 1;
      }
    } catch (error) {
      errors.push({ row: rowIndex + 1, message: error.message });
    }
  }

  await recordAuditEvent(supabase, {
    workspaceId,
    actorUserId: user.id,
    action: 'horses.csv_import',
    entityType: 'horses',
    metadata: { imported, updated, errors: errors.length },
  });

  return sendJson(res, 200, { ok: true, imported, updated, errors });
}

// Small CSV parser with quoted-field support (no external dependency).
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell);
      cell = '';
      rows.push(row);
      row = [];
    } else {
      cell += char;
    }
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

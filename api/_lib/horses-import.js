import { randomUUID } from 'node:crypto';
import { readJsonBody, sendJson } from './http.js';
import { getWorkspaceEntitlements, checkHorseCapacity } from './entitlements.js';
import { requireWorkspaceAccess } from './supabase-admin.js';
import { recordAuditEvent } from './audit.js';
import { normalizeDate } from './document-extraction.js';
import { enforceRateLimit } from './rate-limit.js';
import { horsesImportSchema, parseBody } from './validation.js';
import { applyCors } from './cors.js';
import { requireRoleCapability } from './permissions.js';

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

function rowValue(row, columnMap, field) {
  return field in columnMap ? String(row[columnMap[field]] || '').trim() : '';
}

export function buildHorseUpdateFields(row, columnMap) {
  const fields = { name: rowValue(row, columnMap, 'name') };
  for (const field of [
    'breed',
    'color',
    'gender',
    'status',
    'registration_number',
    'registry',
    'microchip',
    'owner_name',
    'barn_name',
  ]) {
    if (field in columnMap) fields[field] = rowValue(row, columnMap, field);
  }
  if ('birthdate' in columnMap) {
    const rawBirthdate = rowValue(row, columnMap, 'birthdate');
    fields.birthdate = normalizeDate(rawBirthdate) || rawBirthdate;
  }
  return fields;
}

export function duplicateRegistrationRows(dataRows, columnMap, rows) {
  const registrationRows = new Map();
  for (const row of dataRows) {
    const registration = rowValue(row, columnMap, 'registration_number');
    if (!registration) continue;
    const rowNumber = rows.indexOf(row) + 1;
    const seen = registrationRows.get(registration) || [];
    seen.push(rowNumber);
    registrationRows.set(registration, seen);
  }
  return {
    registrationRows,
    duplicates: [...registrationRows.entries()].filter(([, rowNumbers]) => rowNumbers.length > 1),
  };
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

  // Server-side horse-limit enforcement: the client check is UX, this is the
  // gate. Compute exactly how many NEW horses this CSV creates (rows whose
  // registration number matches an existing horse update in place and don't
  // count), then verify plan capacity before any row is written.
  const cellAt = (row, field) => rowValue(row, columnMap, field);
  const dataRows = rows.slice(1).filter((row) => row.length && row.some((cell) => cell.trim()) && cellAt(row, 'name'));
  const { registrationRows, duplicates: duplicateRegistrations } = duplicateRegistrationRows(dataRows, columnMap, rows);
  if (duplicateRegistrations.length) {
    return sendJson(res, 400, {
      ok: false,
      message: `CSV contains duplicate registration numbers: ${duplicateRegistrations
        .map(([registration, rowNumbers]) => `${registration} (rows ${rowNumbers.join(', ')})`)
        .join('; ')}. Resolve duplicates before importing.`,
    });
  }

  const csvRegistrations = [...registrationRows.keys()];
  let existingRegistrations = new Set();
  if (csvRegistrations.length) {
    const { data: existingRows, error: existingRowsError } = await supabase
      .from('horses')
      .select('registration_number')
      .eq('workspace_id', workspaceId)
      .in('registration_number', csvRegistrations);
    if (existingRowsError) {
      return sendJson(res, 502, {
        ok: false,
        message: `Unable to verify existing horse registrations. No horses were imported. ${existingRowsError.message || ''}`.trim(),
      });
    }
    existingRegistrations = new Set((existingRows || []).map((row) => row.registration_number).filter(Boolean));
  }
  const newRegistrationCount = csvRegistrations.filter((reg) => !existingRegistrations.has(reg)).length;
  const noRegistrationRowCount = dataRows.filter((row) => !cellAt(row, 'registration_number')).length;
  const plannedInserts = newRegistrationCount + noRegistrationRowCount;
  const plannedUpdates = csvRegistrations.filter((reg) => existingRegistrations.has(reg)).length;

  if (plannedInserts > 0) {
    const denied = requireRoleCapability(access.role, 'createHorse');
    if (denied) {
      return sendJson(res, 403, { ok: false, message: denied });
    }
  }
  if (plannedUpdates > 0) {
    const denied = requireRoleCapability(access.role, 'editHorse');
    if (denied) {
      return sendJson(res, 403, { ok: false, message: denied });
    }
  }

  if (plannedInserts > 0) {
    const entitlements = await getWorkspaceEntitlements(supabase, workspaceId, user?.email);
    if (!entitlements.ok) {
      return sendJson(res, entitlements.status, { ok: false, message: entitlements.message });
    }

    const capacity = await checkHorseCapacity(supabase, workspaceId, plannedInserts, entitlements.limits);
    if (!capacity.ok) {
      return sendJson(res, capacity.status ?? 403, { ok: false, message: capacity.message });
    }
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

    try {
      let existing = null;
      if (registration) {
        const { data, error: lookupError } = await supabase
          .from('horses')
          .select('horse_id')
          .eq('workspace_id', workspaceId)
          .eq('registration_number', registration)
          .maybeSingle();
        if (lookupError) {
          errors.push({
            row: rowIndex + 1,
            message: `Unable to verify existing horse: ${lookupError.message || 'database lookup failed'}`,
          });
          continue;
        }
        existing = data;
      }

      if (existing) {
        const fields = buildHorseUpdateFields(row, columnMap);

        const { error: updateError } = await supabase
          .from('horses')
          .update({ ...fields, updated_at: new Date().toISOString() })
          .eq('workspace_id', workspaceId)
          .eq('horse_id', existing.horse_id);
        if (updateError) {
          errors.push({ row: rowIndex + 1, message: updateError.message || 'Horse update failed.' });
          continue;
        }
        updated += 1;
      } else {
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
        const { error: insertError } = await supabase.from('horses').insert({
          workspace_id: workspaceId,
          horse_id: `horse-${randomUUID()}`,
          ...fields,
          payload: { importedBy: user.id, importSource: 'csv' },
        });
        if (insertError) {
          errors.push({ row: rowIndex + 1, message: insertError.message || 'Horse insert failed.' });
          continue;
        }
        imported += 1;
      }
    } catch (error) {
      errors.push({ row: rowIndex + 1, message: error?.message || 'Unexpected import failure.' });
    }
  }

  await recordAuditEvent(supabase, {
    workspaceId,
    actorUserId: user.id,
    action: 'horses.csv_import',
    entityType: 'horses',
    metadata: { imported, updated, errors: errors.length },
  });

  return sendJson(res, 200, { ok: true, partial: errors.length > 0, imported, updated, errors });
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

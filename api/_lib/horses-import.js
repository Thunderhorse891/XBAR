import { randomUUID } from 'node:crypto';
import { readJsonBody, sendJson } from './http.js';
import { getWorkspaceEntitlements, checkHorseCapacity } from './entitlements.js';
import { requireWorkspaceAccess } from './supabase-admin.js';
import { recordAuditEvent } from './audit.js';
import { normalizeDate } from './document-extraction.js';
import { enforceRateLimit } from './rate-limit.js';
import { horsesImportSchema, parseBody } from './validation.js';
import { applyCors } from './cors.js';
import { hasRoleCapability, getCapabilityDeniedMessage, requireRoleCapability } from './permissions.js';

// Bulk CSV import of horses. Accepts { workspaceId, csv } where csv is the
// raw file contents. Header names are matched case-insensitively against the
// aliases below (covers the legacy Horse_export.csv format).

const COLUMN_ALIASES = {
  name: ['name', 'horse name', 'horse'],
  breed: ['breed'],
  color: ['color', 'colour'],
  birthdate: ['birthdate', 'birth date', 'foaled', 'date of birth', 'dob'],
  gender: ['gender', 'sex'],
  segment: ['segment', 'horse segment'],
  status: ['status'],
  registration_number: ['registration number', 'registration #', 'reg number', 'reg #', 'registration'],
  registry: ['registry'],
  microchip: ['microchip', 'microchip number', 'chip'],
  owner_name: ['owner', 'owner name', 'legal owner'],
  barn_name: ['barn', 'barn name'],
};

// Keep the API terms in parity with HorseRecord; the CSV corpus checks each
// of these against its canonical application type.
export const CSV_HORSE_CLASSIFICATIONS = {
  gender: ['Mare', 'Stud', 'Gelding', 'Filly', 'Colt'],
  status: ['In Training', 'Broodmare Program', 'Sale Prep', 'Medical Review', 'Pasture', 'Retired'],
  segment: ['Broodmare', 'Stud', 'Show String', 'Sale Prospect', 'Young Stock', 'Retired'],
};
const CLASSIFICATION_COLUMNS = { gender: 'Sex', status: 'Status', segment: 'Segment' };

const RATE_LIMIT = { bucket: 'horses-import', limit: 6, windowSeconds: 60 };

function rowValue(row, columnMap, field) {
  return field in columnMap ? String(row[columnMap[field]] || '').trim() : '';
}

export function buildHorseUpdateFields(row, columnMap) {
  const fields = { name: rowValue(row, columnMap, 'name') };
  for (const field of ['breed', 'color', 'registration_number', 'registry', 'microchip', 'owner_name', 'barn_name']) {
    if (field in columnMap) fields[field] = rowValue(row, columnMap, field);
  }
  if ('birthdate' in columnMap) {
    const rawBirthdate = rowValue(row, columnMap, 'birthdate');
    fields.birthdate = normalizeDate(rawBirthdate) || rawBirthdate;
  }
  return fields;
}

function classifyHorseImportRow(row, columnMap, action) {
  const fields = {};
  const problems = [];
  for (const [field, choices] of Object.entries(CSV_HORSE_CLASSIFICATIONS)) {
    const supplied = rowValue(row, columnMap, field);
    if (!supplied && action === 'update') continue;
    const token = supplied.toLowerCase();
    const alias = field === 'gender' && token === 'stallion' ? 'stud' : token;
    const matched = choices.find((choice) => choice.toLowerCase() === alias);
    if (matched) fields[field] = matched;
    else problems.push(`${CLASSIFICATION_COLUMNS[field]} must be one of: ${choices.join(', ')}`);
  }
  return problems.length ? { error: `${problems.join('; ')}.` } : { fields };
}

// The relational reader hydrates horses from payload, not the scalar columns.
const HORSE_PAYLOAD_FIELDS = {
  name: 'name',
  breed: 'breed',
  color: 'color',
  birthdate: 'foaledOn',
  gender: 'sex',
  segment: 'segment',
  status: 'status',
  registration_number: 'registrationNumber',
  registry: 'registry',
  microchip: 'microchipId',
  owner_name: 'owner',
  barn_name: 'barnName',
};

function horseImportPayloadFields(fields) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [HORSE_PAYLOAD_FIELDS[key], value]));
}

function buildImportedHorsePayload(horseId, fields, userId) {
  return {
    id: horseId,
    ...horseImportPayloadFields(fields),
    summary: '',
    aqhaNumber: '',
    // A CSV identifier is useful for matching, not evidence that papers were verified.
    registered: false,
    age: 0,
    markings: '',
    ownerEntity: '',
    insuredValue: 0,
    profileImage: '',
    tags: ['intake-pending'],
    bloodline: { sire: '', dam: '', family: '' },
    location: { ranch: '', barn: '', pasture: '', stall: '' },
    assignments: { trainer: '', ranchManager: '', veterinarian: '', farrier: '' },
    ownership: [],
    gallery: [],
    sale: {
      listingState: 'Hold',
      askPrice: 0,
      buyerConfidence: 0,
      inquiryCount: 0,
      watchlistCount: 0,
      socialReady: false,
    },
    readiness: { score: 0, blockers: [], packetStatus: 'Needs Transfer Docs' },
    medicalNotes: '',
    lastVetVisit: '',
    documents: [],
    medicalTimeline: [],
    breedingTimeline: [],
    activity: [],
    documentFacts: [],
    alerts: [],
    notes: [],
    importedBy: userId,
    importSource: 'csv',
  };
}

function isHorsePayload(payload, horseId) {
  return payload !== null && typeof payload === 'object' && !Array.isArray(payload) && payload.id === horseId;
}

function matchesHorseWrite(rows, horseId, payloadFields) {
  return (
    Array.isArray(rows) &&
    rows.length === 1 &&
    rows[0]?.horse_id === horseId &&
    isHorsePayload(rows[0].payload, horseId) &&
    Object.entries(payloadFields).every(([field, value]) => rows[0].payload[field] === value)
  );
}

export function duplicateRegistrationRows(dataRows, columnMap, rows) {
  // Map each row array reference to its 1-based position once, so a large bulk
  // import does not pay O(n^2) for rows.indexOf(row) per data row.
  const rowNumberByRef = new Map();
  rows.forEach((row, index) => {
    if (!rowNumberByRef.has(row)) rowNumberByRef.set(row, index + 1);
  });
  const registrationRows = new Map();
  for (const row of dataRows) {
    const registration = rowValue(row, columnMap, 'registration_number');
    if (!registration) continue;
    const rowNumber = rowNumberByRef.get(row) ?? rows.indexOf(row) + 1;
    const seen = registrationRows.get(registration) || [];
    seen.push(rowNumber);
    registrationRows.set(registration, seen);
  }
  return {
    registrationRows,
    duplicates: [...registrationRows.entries()].filter(([, rowNumbers]) => rowNumbers.length > 1),
  };
}

// A lookup is evidence, not a suggestion. Never choose one of several horse
// identities or turn an unreadable response into permission to create a horse.
export function buildExistingRegistrationIndex(rows, requestedRegistrations) {
  if (!Array.isArray(rows)) throw new Error('Registration lookup did not return a readable array.');
  const requested = new Set(requestedRegistrations);
  const index = new Map();
  const horseIds = new Set();
  for (const row of rows) {
    if (
      !row ||
      typeof row.horse_id !== 'string' ||
      !row.horse_id.trim() ||
      typeof row.registration_number !== 'string' ||
      !requested.has(row.registration_number)
    ) {
      throw new Error('Registration lookup returned an invalid horse identity.');
    }
    if (index.has(row.registration_number) || horseIds.has(row.horse_id)) {
      throw new Error(`Registration ${row.registration_number} has an ambiguous horse identity. Review it first.`);
    }
    index.set(row.registration_number, row.horse_id);
    horseIds.add(row.horse_id);
  }
  return index;
}

// Bound query URLs and detect server row-limit truncation. A truncated result
// must not misclassify existing horses as new ones. Exact counts concern this
// query only; they do not make the later writes a transaction.
async function loadExistingRegistrationIndex(supabase, workspaceId, registrations) {
  const index = new Map();
  const chunkSize = 100;
  for (let offset = 0; offset < registrations.length; offset += chunkSize) {
    const chunk = registrations.slice(offset, offset + chunkSize);
    const result = await supabase
      .from('horses')
      .select('horse_id, registration_number', { count: 'exact' })
      .eq('workspace_id', workspaceId)
      .in('registration_number', chunk);
    if (result?.error) throw new Error(result.error.message || 'Registration lookup failed.');
    const found = buildExistingRegistrationIndex(result?.data, chunk);
    if (!Number.isSafeInteger(result.count) || result.count !== result.data.length) {
      throw new Error('Registration lookup was incomplete. No import can be planned from a partial result.');
    }
    for (const [registration, horseId] of found) index.set(registration, horseId);
  }
  return index;
}

// Authorize a single row for the action DECIDED AT PREFLIGHT, and hold the row
// to that action. `action` is 'update' when the row's registration matched an
// existing horse in the preflight snapshot, 'insert' otherwise. Nothing may
// switch it afterwards: a planned update whose target has since disappeared is
// refused by importHorseRows, never quietly turned into an insert. That switch
// was two bugs at once — a role holding editHorse but not createHorse (Owner,
// Sales Lead) could create a horse, and even an Admin's intended update could
// silently become a creation, both outside what the plan authorized. Pure, so
// the cases are tested directly.
export function authorizeImportRow({ action, role, insertsSoFar, insertBudget }) {
  if (action !== 'update' && action !== 'insert') {
    return { action, denied: 'Unrecognized import action.' };
  }
  if (action === 'update') {
    return { action: 'update', denied: requireRoleCapability(role, 'editHorse') };
  }
  const denied = requireRoleCapability(role, 'createHorse');
  if (denied) {
    return { action: 'insert', denied };
  }
  // Enforce the plan's capacity budget against every actual insert, so the true
  // limit holds even when more rows insert than the plan predicted.
  if (
    !Number.isSafeInteger(insertBudget) ||
    !Number.isSafeInteger(insertsSoFar) ||
    insertsSoFar < 0 ||
    insertsSoFar >= insertBudget
  ) {
    return { action: 'insert', denied: null, capacityExceeded: true };
  }
  return { action: 'insert', denied: null };
}

// Apply the parsed rows to the database, one at a time, holding each row to the
// action and target the preflight chose. Exported so the whole write path can
// be exercised against a simulated database, not just its helpers.
//
// `existingByRegistration` is the preflight snapshot: registration_number ->
// horse_id for horses that existed when the plan was built. The live database
// may have moved since. Conditional updates refuse changed targets; inserts
// recheck that their registration is still unused. The latter is NOT atomic:
// another writer can still race after that check. Closing that final window
// requires a reviewed database constraint/transaction, not another API read.
// In particular:
//   - an intended update whose target row is gone writes to zero rows; that is
//     an error, never a silent "updated: 1" and never a fallback insert;
//   - an intended update whose registration now belongs to a different horse
//     matches zero rows too (the update is pinned to the original horse_id AND
//     its registration), so it never edits the wrong horse.
export async function importHorseRows({
  supabase,
  workspaceId,
  userId,
  rows,
  columnMap,
  existingByRegistration,
  role,
  insertBudget,
  capacityExceededMessage,
}) {
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
    const targetHorseId = registration ? existingByRegistration.get(registration) : undefined;
    const action = targetHorseId ? 'update' : 'insert';

    const classifications = classifyHorseImportRow(row, columnMap, action);
    if (classifications.error) {
      errors.push({ row: rowIndex + 1, message: classifications.error });
      continue;
    }
    const decision = authorizeImportRow({ action, role, insertsSoFar: imported, insertBudget });
    if (decision.denied) {
      errors.push({ row: rowIndex + 1, message: decision.denied });
      continue;
    }
    if (decision.capacityExceeded) {
      errors.push({ row: rowIndex + 1, message: capacityExceededMessage });
      continue;
    }

    try {
      if (action === 'update') {
        const fields = { ...buildHorseUpdateFields(row, columnMap), ...classifications.fields };

        // The stored payload holds data that is not in this CSV. Read it
        // deliberately, and pin the write to the revision AND payload:
        // older writers may change the payload without moving updated_at.
        const noMatchMessage = `Could not confirm the update for registration ${registration}; it may no longer match the targeted horse or may have changed. Review the record before retrying.`;
        const current = await supabase
          .from('horses')
          .select('horse_id, payload, updated_at')
          .eq('workspace_id', workspaceId)
          .eq('horse_id', targetHorseId)
          .eq('registration_number', registration);
        if (current?.error) throw new Error(current.error.message || 'Could not read the current horse record.');
        const previous = current?.data?.[0];
        if (!Array.isArray(current?.data) || current.data.length !== 1 || previous?.horse_id !== targetHorseId) {
          throw new Error(noMatchMessage);
        }
        const priorRevision = Date.parse(previous.updated_at);
        if (!isHorsePayload(previous.payload, targetHorseId) || !Number.isFinite(priorRevision)) {
          throw new Error(
            'Current horse record has missing or invalid saved data. Review and repair it before importing.',
          );
        }
        const payloadFields = horseImportPayloadFields(fields);
        const payload = { ...previous.payload, ...payloadFields };
        const updatedAt = new Date(Math.max(Date.now(), priorRevision + 1)).toISOString();
        const { data: updatedRows, error: updateError } = await supabase
          .from('horses')
          .update({ ...fields, payload, updated_at: updatedAt })
          .eq('workspace_id', workspaceId)
          .eq('horse_id', targetHorseId)
          .eq('registration_number', registration)
          .eq('updated_at', previous.updated_at)
          .eq('payload', JSON.stringify(previous.payload))
          .select('horse_id, payload');
        if (updateError) {
          errors.push({ row: rowIndex + 1, message: updateError.message || 'Horse update failed.' });
          continue;
        }
        if (!matchesHorseWrite(updatedRows, targetHorseId, payloadFields)) {
          errors.push({ row: rowIndex + 1, message: noMatchMessage });
          continue;
        }
        updated += 1;
      } else {
        if (registration) {
          // A planned insertion must still be new. Never retarget it to UPDATE
          // if the registration appeared since planning. A failed or malformed
          // lookup is not evidence of absence either.
          const current = await supabase
            .from('horses')
            .select('horse_id, registration_number')
            .eq('workspace_id', workspaceId)
            .eq('registration_number', registration);
          if (current?.error) throw new Error(current.error.message || 'Registration recheck failed.');
          const currentIndex = buildExistingRegistrationIndex(current?.data, [registration]);
          if (currentIndex.size) {
            errors.push({
              row: rowIndex + 1,
              message: `Registration ${registration} appeared after import planning. Nothing was inserted; review it before retrying.`,
            });
            continue;
          }
        }
        const fields = {
          name,
          breed: value('breed'),
          color: value('color'),
          birthdate: normalizeDate(value('birthdate')) || value('birthdate'),
          ...classifications.fields,
          registration_number: registration,
          registry: value('registry'),
          microchip: value('microchip'),
          owner_name: value('owner_name'),
          barn_name: value('barn_name'),
        };
        const horseId = `horse-${randomUUID()}`;
        const payload = buildImportedHorsePayload(horseId, fields, userId);
        const { data: insertedRows, error: insertError } = await supabase
          .from('horses')
          .insert({
            workspace_id: workspaceId,
            horse_id: horseId,
            ...fields,
            payload,
          })
          .select('horse_id, payload');
        if (insertError) {
          errors.push({ row: rowIndex + 1, message: insertError.message || 'Horse insert failed.' });
          continue;
        }
        if (!matchesHorseWrite(insertedRows, horseId, horseImportPayloadFields(fields))) {
          errors.push({ row: rowIndex + 1, message: 'Could not confirm the inserted horse. Review before retrying.' });
          continue;
        }
        imported += 1;
      }
    } catch (error) {
      errors.push({ row: rowIndex + 1, message: error?.message || 'Unexpected import failure.' });
    }
  }

  return { imported, updated, errors };
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
  let existingByRegistration;
  try {
    existingByRegistration = await loadExistingRegistrationIndex(supabase, workspaceId, csvRegistrations);
  } catch (error) {
    return sendJson(res, 502, {
      ok: false,
      message: `Unable to verify existing horse registrations. No horses were imported. ${error.message}`,
    });
  }
  const existingRegistrations = new Set(existingByRegistration.keys());
  const plannedInserts = dataRows.filter((row) => {
    const registration = cellAt(row, 'registration_number');
    return (
      (!registration || !existingRegistrations.has(registration)) &&
      !classifyHorseImportRow(row, columnMap, 'insert').error
    );
  }).length;
  const plannedUpdates = csvRegistrations.filter((reg) => existingRegistrations.has(reg)).length;

  const canCreateHorses = hasRoleCapability(access.role, 'createHorse');
  const canEditHorses = hasRoleCapability(access.role, 'editHorse');

  // Fast, whole-request rejection when the plan plainly needs a capability this
  // role lacks. Each row is also re-authorized for its pinned action in
  // importHorseRows, so this is UX (one clear 403 instead of per-row errors),
  // not the guarantee.
  if (plannedInserts > 0 && !canCreateHorses) {
    return sendJson(res, 403, { ok: false, message: getCapabilityDeniedMessage('createHorse') });
  }
  if (plannedUpdates > 0 && !canEditHorses) {
    return sendJson(res, 403, { ok: false, message: getCapabilityDeniedMessage('editHorse') });
  }

  // Only the pinned planned inserts consume capacity. Update-only imports
  // remain possible after a downgrade or during a billing-read outage; they
  // cannot become inserts. Database capacity enforcement remains authoritative
  // for competing requests; this running budget covers only this batch.
  let insertBudget = 0;
  let capacityExceededMessage = '';
  if (plannedInserts > 0) {
    const entitlements = await getWorkspaceEntitlements(supabase, workspaceId, user?.email);
    if (!entitlements.ok) {
      return sendJson(res, entitlements.status, { ok: false, message: entitlements.message });
    }

    const capacity = await checkHorseCapacity(supabase, workspaceId, plannedInserts, entitlements.limits);
    if (!capacity.ok) {
      return sendJson(res, capacity.status ?? 403, { ok: false, message: capacity.message });
    }

    if (
      !Number.isSafeInteger(entitlements.limits.horseLimit) ||
      !Number.isSafeInteger(capacity.used) ||
      capacity.used < 0 ||
      capacity.used + plannedInserts > entitlements.limits.horseLimit
    ) {
      return sendJson(res, 503, { ok: false, message: 'Unable to verify the horse capacity budget.' });
    }
    insertBudget = plannedInserts;
    capacityExceededMessage = `This import would exceed the plan's ${entitlements.limits.horseLimit} horse limit (${capacity.used} in use). Upgrade to continue.`;
  }

  const { imported, updated, errors } = await importHorseRows({
    supabase,
    workspaceId,
    userId: user.id,
    rows,
    columnMap,
    existingByRegistration,
    role: access.role,
    insertBudget,
    capacityExceededMessage,
  });

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

// Builds the {{placeholder}} context shared by template generation and sale
// packet cover sheets: horse identity, owner/workspace profile, and the
// latest compliance dates pulled from attached documents.

import { recordedDocumentPath } from './document-storage.js';

// Report dates are written calendar days, not upload instants. Accept the
// stored ISO forms without allowing a timestamp's offset to move that day.
function calendarDay(value) {
  if (typeof value !== 'string') return '';
  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:[Zz]|[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:[Zz]|[+-](\d{2}):?(\d{2}))?)?$/.exec(
      value.trim(),
    );
  if (!match) return '';
  const [, year, month, day, hour, minute, second, offsetHour, offsetMinute] = match;
  if (
    Number(hour) > 23 ||
    Number(minute) > 59 ||
    Number(second) > 59 ||
    Number(offsetHour) > 23 ||
    Number(offsetMinute) > 59
  )
    return '';
  const date = new Date(0);
  date.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  date.setUTCHours(0, 0, 0, 0);
  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day)
  )
    return '';
  return `${year}-${month}-${day}`;
}

function reviewedHealthDocument(doc) {
  const source = doc.payload || {};
  return (
    doc.state === 'Ready' &&
    (!source.state || source.state === 'Ready') &&
    // A scoped row cannot make conflicting cached mirror evidence belong to
    // this document/horse. Legacy backend payloads may omit mirror identity.
    (source.id === undefined || source.id === doc.document_id) &&
    (source.horseId === undefined || source.horseId === doc.horse_id) &&
    (source.type === undefined || source.type === doc.document_type) &&
    !doc.needs_review &&
    !source.identityReviewRequired &&
    !(typeof source.processingNote === 'string' && source.processingNote.trim()) &&
    !(
      (doc.duplicate_risk === 'Possible Duplicate' || source.duplicateRisk === 'Possible Duplicate') &&
      !(typeof source.duplicateReviewedAt === 'string' && source.duplicateReviewedAt.trim())
    )
  );
}

function latestHealthEvidence(documents, type, latestPossibleToday) {
  const candidates = documents.flatMap((doc) => {
    if (doc.document_type !== type || !reviewedHealthDocument(doc)) return [];
    const fields = doc.extracted_data;
    // Browser mirrors store examDate; backend Coggins extraction stores
    // testDate. Conflicting or malformed supplied dates establish neither.
    const values = (type === 'Coggins' ? [fields.testDate, fields.examDate] : [fields.examDate]).filter(
      (value) => value !== undefined && value !== null && value !== '',
    );
    const days = values.map(calendarDay);
    if (!days.length || days.some((day) => !day || day !== days[0] || day > latestPossibleToday)) return [];
    const date = days[0];
    const due = calendarDay(fields.nextDueDate);
    return [{ date, due: due >= date ? due : '' }];
  });
  const date = candidates.reduce((latest, candidate) => (candidate.date > latest ? candidate.date : latest), '');
  const dueDates = new Set(candidates.filter((candidate) => candidate.date === date).map((candidate) => candidate.due));
  // Never invent a renewal window, or resolve equal-date conflicting sources
  // by whichever file was uploaded last. These are recorded facts, not a
  // clinical determination of validity or fitness to travel.
  return { date, due: dueDates.size === 1 ? [...dueDates][0] : '' };
}

export async function loadHorseContext(supabase, workspaceId, horseId, { requireProfile = false } = {}) {
  const [
    { data: horse, error: horseError },
    { data: profile, error: profileError },
    { data: documents, error: documentsError },
    { data: ownership, error: ownershipError },
  ] = await Promise.all([
    supabase
      .from('horses')
      .select(
        'horse_id, name, barn_name, status, registration_number, owner_name, breed, color, birthdate, gender, microchip, registry, payload',
      )
      .eq('workspace_id', workspaceId)
      .eq('horse_id', horseId)
      .maybeSingle(),
    supabase
      .from('workspace_profiles')
      .select('ranch_name, business_name, default_owner_name, ranch_manager_name, operations_email, payload')
      .eq('workspace_id', workspaceId)
      .maybeSingle(),
    supabase
      .from('documents')
      .select(
        'document_id, horse_id, title, document_type, state, needs_review, duplicate_risk, storage_path, mime_type, extracted_data, payload, created_at',
      )
      .eq('workspace_id', workspaceId)
      .eq('horse_id', horseId)
      .order('created_at', { ascending: false }),
    supabase
      .from('ownership_records')
      .select('legal_owner, transfer_status, compliance_deadline, payload')
      .eq('workspace_id', workspaceId)
      .eq('horse_id', horseId)
      .order('updated_at', { ascending: false })
      .limit(1),
  ]);

  // A failed authoritative read is not an empty evidence set. Refuse before
  // callers render HTML, seal a packet, or persist a generated document.
  if (horseError) throw new Error('Horse record could not be loaded. Try again before generating the report.');
  if (documentsError) throw new Error('Horse documents could not be loaded. Try again before generating the report.');
  if (ownershipError) throw new Error('Ownership records could not be loaded. Try again before generating the report.');

  // Packet branding must not silently disappear when its authoritative read
  // fails. Template callers retain their existing optional-profile behavior.
  if (requireProfile && profileError) {
    throw new Error('Workspace profile could not be loaded. Try again before creating the sale packet.');
  }

  if (!horse) {
    return { horse: null };
  }

  // Rows written by the app's relational mirror keep file metadata and
  // identity fields inside the payload jsonb rather than the dedicated
  // columns, so normalize both shapes into one.
  const docs = (documents || []).map((doc) => ({
    ...doc,
    storage_path: recordedDocumentPath(doc),
    mime_type: doc.mime_type || doc.payload?.mimeType || '',
    extracted_data:
      doc.extracted_data && Object.keys(doc.extracted_data).length ? doc.extracted_data : doc.payload?.entities || {},
  }));
  const horsePayload = horse.payload || {};
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  // No ranch time zone is stored here. Refuse a date that cannot yet be today
  // anywhere, without excluding a real same-day record from UTC+14. This is
  // not a determination that the document is clinically current.
  const latestPossibleToday = new Date(now.getTime() + 14 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const latestCoggins = latestHealthEvidence(docs, 'Coggins', latestPossibleToday);
  const latestExam = latestHealthEvidence(docs, 'Vet Record', latestPossibleToday);
  const ownershipRecord = ownership?.[0] || null;

  const context = {
    horse: {
      name: horse.name,
      registrationNumber: horse.registration_number || horsePayload.registrationNumber || '',
      registry: horse.registry || horsePayload.registry || '',
      breed: horse.breed || horsePayload.breed || '',
      color: horse.color || horsePayload.color || '',
      birthdate: horse.birthdate || horsePayload.birthdate || horsePayload.foaled || '',
      gender: horse.gender || horsePayload.sex || '',
      microchip: horse.microchip || horsePayload.microchip || '',
      barnName: horse.barn_name,
      status: horse.status,
    },
    owner: {
      name: ownershipRecord?.legal_owner || horse.owner_name || '',
    },
    workspace: {
      businessName: profile?.business_name || '',
      ranchName: profile?.ranch_name || '',
      defaultOwnerName: profile?.default_owner_name || '',
      ranchManagerName: profile?.ranch_manager_name || '',
      operationsEmail: profile?.operations_email || '',
      // These optional fields live only in the existing profile payload. Do
      // not spread it: unrelated payload fields cannot override row identity.
      contactPhone: profile?.payload?.contactPhone,
      website: profile?.payload?.website,
      packetLogoDataUrl: profile?.payload?.packetLogoDataUrl,
    },
    health: {
      lastCogginsDate: latestCoggins.date,
      nextCogginsDue: latestCoggins.due,
      lastExamDate: latestExam.date,
    },
    today_date: today,
  };

  return { horse, profile, documents: docs, ownershipRecord, context };
}

// Builds the {{placeholder}} context shared by template generation and sale
// packet cover sheets: horse identity, owner/workspace profile, and the
// latest compliance dates pulled from attached documents.

export async function loadHorseContext(supabase, workspaceId, horseId) {
  const [{ data: horse }, { data: profile }, { data: documents }, { data: ownership }] = await Promise.all([
    supabase
      .from('horses')
      .select('horse_id, name, barn_name, status, registration_number, owner_name, breed, color, birthdate, gender, microchip, registry, payload')
      .eq('workspace_id', workspaceId)
      .eq('horse_id', horseId)
      .maybeSingle(),
    supabase
      .from('workspace_profiles')
      .select('ranch_name, business_name, default_owner_name, ranch_manager_name, operations_email')
      .eq('workspace_id', workspaceId)
      .maybeSingle(),
    supabase
      .from('documents')
      .select('document_id, title, document_type, state, storage_path, mime_type, extracted_data, created_at')
      .eq('workspace_id', workspaceId)
      .eq('horse_id', horseId)
      .order('created_at', { ascending: false }),
    supabase
      .from('ownership_records')
      .select('legal_owner, transfer_status, compliance_deadline')
      .eq('workspace_id', workspaceId)
      .eq('horse_id', horseId)
      .order('updated_at', { ascending: false })
      .limit(1),
  ]);

  if (!horse) {
    return { horse: null };
  }

  const docs = documents || [];
  const latestCoggins = docs.find((doc) => doc.document_type === 'Coggins');
  const latestExam = docs.find((doc) => doc.document_type === 'Vet Record');
  const ownershipRecord = ownership?.[0] || null;

  const context = {
    horse: {
      name: horse.name,
      registrationNumber: horse.registration_number,
      registry: horse.registry,
      breed: horse.breed,
      color: horse.color,
      birthdate: horse.birthdate,
      gender: horse.gender,
      microchip: horse.microchip,
      barnName: horse.barn_name,
      status: horse.status,
    },
    owner: {
      name: ownershipRecord?.legal_owner || horse.owner_name || profile?.default_owner_name || '',
    },
    workspace: {
      businessName: profile?.business_name || '',
      ranchName: profile?.ranch_name || '',
      ranchManagerName: profile?.ranch_manager_name || '',
      operationsEmail: profile?.operations_email || '',
    },
    health: {
      lastCogginsDate: latestCoggins?.extracted_data?.testDate || '',
      nextCogginsDue: latestCoggins?.extracted_data?.nextDueDate || '',
      lastExamDate: latestExam?.extracted_data?.examDate || '',
    },
    today_date: new Date().toISOString().slice(0, 10),
  };

  return { horse, profile, documents: docs, ownershipRecord, context };
}

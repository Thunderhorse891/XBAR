/**
 * Record a newly, exclusively uploaded object. Call only after an acknowledged
 * upload with upsert:false to a fresh, server-generated path.
 *
 * A failed record save is not proof the original is unreferenced: synced records
 * can refer to it through JSON payloads, recovery inventories retain originals,
 * and a reference can appear after a read. Without an atomic ownership and
 * reference-retirement boundary, keep the object charged and recoverable.
 */
export async function recordNewStoredObject({ supabase, path, table, key, pathColumn, row }) {
  let result;
  try {
    result = await supabase.from(table).insert(row).select(`${key},${pathColumn},workspace_id`).maybeSingle();
  } catch {
    return {
      ok: false,
      message: 'The record save could not be confirmed. The file was retained for recovery.',
      cleanup: 'retained',
    };
  }
  if (
    !result?.error &&
    result?.data?.[key] === row[key] &&
    result.data[pathColumn] === path &&
    result.data.workspace_id === row.workspace_id
  )
    return { ok: true };

  return {
    ok: false,
    message:
      typeof result?.error?.message === 'string'
        ? result.error.message
        : 'The record save could not be confirmed. The file was retained for recovery.',
    cleanup: 'retained',
  };
}

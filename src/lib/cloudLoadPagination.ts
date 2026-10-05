/** Counted pages plus a second ID/revision manifest prevent truncated imports. */
export const CLOUD_LOAD_PAGE_SIZE = 500;
type Page<T> = { data: T[] | null; error: { message: string } | null; count: number | null };
export async function loadCompleteCloudRows<T extends Record<string, unknown>>(options: {
  table: string;
  idColumn: string;
  readPage: (from: number, to: number, manifestOnly: boolean) => PromiseLike<Page<T>>;
}): Promise<{ data: T[]; error: null } | { data: null; error: { message: string } }> {
  const fail = (reason: string) => ({
    data: null,
    error: { message: `Cloud load incomplete for ${options.table}: ${reason}. Your local records are unchanged.` },
  });
  try {
    let expected: number | undefined;
    const passes: T[][] = [];
    for (const manifestOnly of [false, true]) {
      const rows: T[] = [];
      const ids = new Set<string>();
      do {
        const page = await options.readPage(rows.length, rows.length + CLOUD_LOAD_PAGE_SIZE - 1, manifestOnly);
        if (page.error) return fail(page.error.message);
        if (page.count === null || !Number.isSafeInteger(page.count) || page.count < 0)
          return fail('the server did not provide a verifiable row count');
        if (expected === undefined) expected = page.count;
        if (page.count !== expected) return fail('the row count changed during loading; retry the pull');
        if (!Array.isArray(page.data)) return fail('the server did not return a row list');
        if (!page.data.length && rows.length < expected) return fail('a page ended before every row arrived');
        for (const row of page.data) {
          const id = row?.[options.idColumn];
          if (typeof id !== 'string' || !id || ids.has(id)) return fail('a row identifier was missing or repeated');
          if (typeof row.updated_at !== 'string' || !Number.isFinite(Date.parse(row.updated_at)))
            return fail('a row revision timestamp was missing or invalid');
          ids.add(id);
          rows.push(row);
        }
        if (rows.length > expected) return fail('more rows arrived than the declared total');
      } while (rows.length < expected);
      passes.push(rows);
    }
    const [rows, manifest] = passes;
    if (
      rows.some(
        (row, i) =>
          row[options.idColumn] !== manifest[i]?.[options.idColumn] || row.updated_at !== manifest[i]?.updated_at,
      )
    )
      return fail('records changed during loading; retry the pull');
    return { data: rows, error: null };
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'the server request failed');
  }
}

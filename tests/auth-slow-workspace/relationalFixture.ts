import type { Route } from '@playwright/test';
const identifiers: Record<string, string> = {
  workspace_memberships: 'id',
  workspace_invitations: 'invitation_id',
  horses: 'horse_id',
  documents: 'document_id',
  intake_batches: 'intake_batch_id',
  ownership_records: 'ownership_record_id',
  expense_receipts: 'receipt_id',
  ranch_assets: 'asset_id',
  sales_leads: 'lead_id',
  shared_listings: 'listing_id',
};
/** Model PostgREST counted collection reads; preserve mutations/errors verbatim. */
export async function fulfillRelationalFixture(route: Route, response: NonNullable<Parameters<Route['fulfill']>[0]>) {
  const request = route.request(),
    url = new URL(request.url());
  const table = url.pathname.split('/').pop() ?? '',
    idColumn = identifiers[table];
  if (
    request.method() !== 'GET' ||
    !idColumn ||
    !request.headers().prefer?.includes('count=exact') ||
    (response.status ?? 200) >= 400
  )
    return route.fulfill(response);
  let values: unknown = response.json;
  if (values === undefined && typeof response.body === 'string') {
    try {
      values = JSON.parse(response.body);
    } catch {
      return route.fulfill(response);
    }
  }
  if (!Array.isArray(values)) return route.fulfill(response);
  const rows = values.map((value, index) => {
    const row = value as Record<string, unknown>;
    const payload = row.payload && typeof row.payload === 'object' ? (row.payload as Record<string, unknown>) : {};
    return {
      ...row,
      [idColumn]: row[idColumn] ?? payload.id ?? `${table}-${row.email ?? index}`,
      updated_at: row.updated_at ?? '2026-09-10T12:00:00Z',
    };
  });
  const from = Number(url.searchParams.get('offset') ?? 0),
    limit = Number(url.searchParams.get('limit') ?? rows.length);
  const page = rows.slice(from, from + limit);
  const rest = { ...response };
  delete rest.body;
  delete rest.json;
  return route.fulfill({
    ...rest,
    json: page,
    headers: {
      ...response.headers,
      'content-range': page.length ? `${from}-${from + page.length - 1}/${rows.length}` : `*/${rows.length}`,
      'access-control-expose-headers': 'content-range',
    },
  });
}

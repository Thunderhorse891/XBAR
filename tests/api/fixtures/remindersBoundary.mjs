export const writes = [];
let scenario = {};
const rows = new Map();
const completed = new Set();
export function notificationCount() {
  return [...rows.keys()].filter((key) => key.startsWith('notification:')).length;
}
export function setScenario(next = {}) {
  scenario = next;
  writes.length = 0;
  rows.clear();
  completed.clear();
}
export function getSupabaseAdmin() {
  return {
    from(table) {
      let operation = 'read';
      let row;
      const filters = {};
      const upperBounds = {};
      let batchLimit = Infinity;
      const query = {
        select() {
          return this;
        },
        eq(key, value) {
          filters[key] = value;
          return this;
        },
        lte(key, value) {
          upperBounds[key] = value;
          return this;
        },
        order() {
          return this;
        },
        limit(value) {
          batchLimit = value;
          return this;
        },
        maybeSingle() {
          return this;
        },
        single() {
          return this;
        },
        insert(value) {
          row = value;
          operation = 'insert';
          writes.push({ table, row });
          return this;
        },
        update(value) {
          row = value;
          operation = 'update';
          writes.push({ table, row });
          return this;
        },
        then(resolve, reject) {
          let result;
          if (table === 'reminder_email_deliveries') {
            const key = `delivery:${row?.id ?? filters.id}`;
            if (operation === 'insert') {
              if (scenario.claimError) result = { data: null, error: { message: 'claim failed' } };
              else if (rows.has(key)) result = { data: null, error: { code: '23505' } };
              else {
                rows.set(key, { ...row });
                result = { data: row, error: null };
              }
            } else if (operation === 'update') {
              if (scenario.acceptError) result = { data: null, error: { message: 'accept write failed' } };
              else if (
                !rows.has(key) ||
                Object.entries(filters).some(([field, value]) => rows.get(key)[field] !== value)
              )
                result = { data: [], error: null };
              else {
                rows.set(key, { ...rows.get(key), ...row });
                result = { data: [{ id: filters.id }], error: null };
              }
            } else if (!filters.id)
              result = {
                data: [...rows.entries()]
                  .filter(([key]) => key.startsWith('delivery:'))
                  .map(([, value]) => value)
                  .filter(
                    (value) =>
                      value.status === filters.status &&
                      value.next_attempt_at &&
                      value.next_attempt_at <= upperBounds.next_attempt_at,
                  )
                  .slice(0, batchLimit)
                  .map((value) => ({ ...value })),
                error: null,
              };
            else result = { data: rows.get(key) ?? null, error: null };
          } else if (operation === 'insert') {
            const key = `notification:${row.id}`;
            if (scenario.insertResult) result = scenario.insertResult;
            else if (rows.has(key)) result = { data: null, error: { code: '23505' } };
            else {
              rows.set(key, { ...row });
              result = { data: row, error: null };
            }
          } else if (operation === 'update') {
            result = scenario.updateResult ?? { data: [{ reminder_id: filters.reminder_id }], error: null };
            if (!result.error && result.data?.length) completed.add(filters.reminder_id);
          } else if (table === 'notifications') result = { data: rows.get(`notification:${filters.id}`), error: null };
          else if (table === 'reminders')
            result = {
              data: (
                scenario.reminders ?? [
                  { workspace_id: 'w1', reminder_id: 'r1', horse_id: 'h1', type: 'farrier', due_date: '2026-09-28' },
                ]
              )
                .filter((item) => !scenario.honorCompletion || !completed.has(item.reminder_id))
                .slice(0, batchLimit),
              error: null,
            };
          else if (table === 'workspaces') result = { data: { owner_user_id: 'u1' }, error: null };
          else if (table === 'workspace_profiles')
            result = { data: { operations_email: 'fixture@example.invalid' }, error: null };
          else if (table === 'horses') result = { data: { name: 'Fixture' }, error: null };
          else throw new Error(`Unexpected table: ${table}`);
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

export const writes = [];
let scenario = {};
export function setScenario(next = {}) {
  scenario = next;
  writes.length = 0;
}
export function getSupabaseAdmin() {
  return {
    from(table) {
      let operation = 'read';
      const query = {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        lte() {
          return this;
        },
        order() {
          return this;
        },
        limit() {
          return this;
        },
        maybeSingle() {
          return this;
        },
        single() {
          return this;
        },
        insert(row) {
          operation = 'insert';
          writes.push({ table, row });
          return this;
        },
        update(row) {
          operation = 'update';
          writes.push({ table, row });
          return this;
        },
        then(resolve, reject) {
          let result;
          if (operation === 'insert') result = scenario.insertResult ?? { data: { id: 'n1' }, error: null };
          else if (operation === 'update')
            result = scenario.updateResult ?? { data: [{ reminder_id: 'r1' }], error: null };
          else if (table === 'reminders')
            result = {
              data: [
                { workspace_id: 'w1', reminder_id: 'r1', horse_id: 'h1', type: 'farrier', due_date: '2026-09-28' },
              ],
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

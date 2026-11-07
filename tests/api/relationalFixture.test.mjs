import assert from 'node:assert/strict';
import test from 'node:test';
import { fulfillRelationalFixture } from '../auth-slow-workspace/relationalFixture.ts';
function fixture({ method = 'GET', prefer = 'count=exact' } = {}) {
  let result;
  return {
    route: {
      request: () => ({
        url: () => 'https://fixture.invalid/rest/v1/horses?offset=1&limit=1',
        method: () => method,
        headers: () => ({ prefer }),
      }),
      fulfill: async (value) => {
        result = value;
      },
    },
    get result() {
      return result;
    },
  };
}
test('browser fixture models counted ranges, row IDs and revisions', async () => {
  const f = fixture();
  await fulfillRelationalFixture(f.route, {
    status: 200,
    json: [{ payload: { id: 'a' } }, { payload: { id: 'b' } }, { payload: { id: 'c' } }],
  });
  assert.equal(f.result.headers['content-range'], '1-1/3');
  assert.equal(f.result.json.length, 1);
  assert.equal(f.result.json[0].horse_id, 'b');
  assert.ok(f.result.json[0].updated_at);
});
test('browser fixture never turns failed or uncounted requests into successful pages', async () => {
  for (const options of [{}, { method: 'POST' }, { prefer: '' }]) {
    const f = fixture(options);
    const response = {
      status: options.method || options.prefer !== undefined ? 200 : 503,
      json: { message: 'unavailable' },
    };
    await fulfillRelationalFixture(f.route, response);
    assert.deepEqual(f.result, response);
  }
});

// Disposable native PostgreSQL only; no service or production credentials.
// PG_MODULE_PATH may point to a separate test-only pg installation.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import console from 'node:console';
const { default: pg } = await import(process.env.PG_MODULE_PATH || 'pg');
if (!['localhost', '127.0.0.1'].includes(process.env.PGHOST) || process.env.PGDATABASE !== 'xbar_free_tier_test') {
  throw new Error('Refusing anything except local disposable xbar_free_tier_test');
}
const config = { connectionTimeoutMillis: 5000, statement_timeout: 20000 };
const connect = async () => {
  const c = new pg.Client(config);
  await c.connect();
  return c;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const admin = await connect();
const service = async (c) => {
  await c.query('set local role service_role');
  await c.query('select set_config(\'request.jwt.claims\',\'{"role":"service_role"}\',true)');
};
async function fixture() {
  const actor = randomUUID(),
    ws = randomUUID();
  await admin.query('insert into auth.users(id,email) values($1,$2)', [actor, actor + '@example.invalid']);
  await admin.query("insert into workspaces(id,owner_user_id,name) values($1,$2,'Reservation race')", [ws, actor]);
  await admin.query('insert into workspace_subscription_profiles(workspace_id) values($1)', [ws]);
  return { actor, ws };
}
function reserve({ actor, ws }, id, bytes) {
  return `select xbar_reserve_upload('${id}','${ws}','${actor}','horse-documents','${ws}/documents/${id}/race.pdf',${bytes},'application/pdf','document')`;
}
async function prepareUpload(f) {
  const id = randomUUID(),
    token = randomUUID();
  await admin.query(reserve(f, id, 100));
  await admin.query('select xbar_begin_upload($1,$2)', [id, token]);
  await admin.query('select xbar_bind_upload($1,$2,$3)', [id, token, 'provider-' + id]);
  return id;
}
async function race(label, firstSQL, secondSQL, expectedError, expectedWait) {
  const first = await connect(),
    second = await connect();
  let pending;
  try {
    await first.query('begin');
    await service(first);
    await first.query(firstSQL);
    await second.query("select set_config('application_name',$1,false)", ['reserved-race-' + label]);
    await second.query('begin');
    await service(second);
    pending = second.query(secondSQL).then(
      () => ({ accepted: true }),
      (error) => ({ error }),
    );
    const deadline = Date.now() + 10000;
    while (true) {
      const rows = (
        await admin.query('select wait_event_type,wait_event from pg_stat_activity where application_name=$1', [
          'reserved-race-' + label,
        ])
      ).rows;
      if (
        rows.some((r) => r.wait_event_type === 'Lock' && (!expectedWait || r.wait_event.toLowerCase() === expectedWait))
      )
        break;
      if (Date.now() > deadline) throw new Error(label + ': second connection never waited at the intended lock');
      await sleep(20);
    }
    await first.query('commit');
    const result = await pending;
    assert.ok(result.error, label + ': losing operation unexpectedly succeeded');
    assert.equal(result.error.message, expectedError);
    await second.query('rollback');
    console.log('PASS ' + label + ': observed lock wait and exact losing error');
  } finally {
    await first.query('rollback').catch(() => {});
    await second.query('rollback').catch(() => {});
    await first.end();
    await second.end();
  }
}
const originalProjectBudget = (await admin.query('select limit_bytes from upload_project_budget')).rows[0].limit_bytes;
try {
  // This suite isolates workspace limits; the project default has its own race suite.
  await admin.query('update upload_project_budget set limit_bytes=9007199254740991');
  const f = await fixture(),
    a = randomUUID(),
    b = randomUUID();
  await race(
    'concurrent-reserve',
    reserve(f, a, 805306368),
    reserve(f, b, 805306368),
    'Storage limit reached for this workspace.',
    'advisory',
  );
  assert.equal(
    Number(
      (await admin.query('select count(*) from workspace_upload_reservations where workspace_id=$1', [f.ws])).rows[0]
        .count,
    ),
    1,
  );
  const completeFirst = await prepareUpload(await fixture());
  await race(
    'complete-wins',
    `select xbar_claim_upload_completion('${completeFirst}','${randomUUID()}')`,
    `select xbar_claim_upload_abort('${completeFirst}','${randomUUID()}')`,
    'Upload state conflict.',
  );
  assert.equal(
    (await admin.query('select state from workspace_upload_reservations where id=$1', [completeFirst])).rows[0].state,
    'completing',
  );
  const abortFirst = await prepareUpload(await fixture());
  await race(
    'abort-wins',
    `select xbar_claim_upload_abort('${abortFirst}','${randomUUID()}')`,
    `select xbar_claim_upload_completion('${abortFirst}','${randomUUID()}')`,
    'Upload state conflict.',
  );
  assert.equal(
    (await admin.query('select state from workspace_upload_reservations where id=$1', [abortFirst])).rows[0].state,
    'aborting',
  );

  // Actual object visibility changes independently of reservation state.
  // Every admission read must see one coherent snapshot: max(actual,reserved),
  // never zero (undercharge) or twice the reservation (double charge).
  const objectRace = await fixture(),
    id = randomUUID(),
    expected = 629145600;
  await admin.query(reserve(objectRace, id, expected));
  const path = `${objectRace.ws}/documents/${id}/race.pdf`,
    writer = await connect();
  let finished = false;
  const writing = (async () => {
    for (let n = 0; n < 50; n++) {
      await writer.query(
        "insert into storage.objects(bucket_id,name,metadata) values('horse-documents',$1,jsonb_build_object('size',$2::bigint))",
        [path, expected],
      );
      await writer.query("delete from storage.objects where bucket_id='horse-documents' and name=$1", [path]);
    }
  })().finally(() => {
    finished = true;
  });
  let observations = 0;
  try {
    do {
      const value = (await admin.query('select xbar_workspace_upload_admission_bytes($1) as bytes', [objectRace.ws]))
        .rows[0].bytes;
      assert.equal(Number(value), expected);
      observations++;
    } while (!finished || observations < 50);
    await writing;
  } finally {
    await writer.end();
  }
  console.log(`PASS coherent object/reservation accounting across ${observations} concurrent reads`);
} finally {
  await admin.query('update upload_project_budget set limit_bytes=$1', [originalProjectBudget]);
  await admin.end();
}

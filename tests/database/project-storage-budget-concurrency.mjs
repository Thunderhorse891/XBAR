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
    assert.equal(result.error.code, expectedError.startsWith('Project storage capacity reached.') ? 'PZ001' : '55000');
    await second.query('rollback');
    console.log('PASS ' + label + ': observed lock wait and exact losing error');
  } finally {
    await first.query('rollback').catch(() => {});
    await second.query('rollback').catch(() => {});
    await first.end();
    await second.end();
  }
}
try {
  const original = (await admin.query('select limit_bytes from upload_project_budget')).rows[0].limit_bytes;
  const a = await fixture(),
    b = await fixture();
  const id = randomUUID();
  try {
    assert.equal(Number(original), 900000000);
    await race(
      'cross-workspace-project-budget',
      reserve(a, id, 600000000),
      reserve(b, randomUUID(), 600000000),
      'Project storage capacity reached. Upload not started.',
    );
    assert.equal(
      Number((await admin.query('select xbar_project_upload_admission_bytes() bytes')).rows[0].bytes),
      600000000,
    );
    // Over-budget recovery and exact retry remain available after an intentional
    // operator reduction. Unknown unrelated objects cannot break existing IDs.
    await admin.query('update upload_project_budget set limit_bytes=1');
    assert.equal((await admin.query(reserve(a, id, 600000000))).rows[0].xbar_reserve_upload.id, id);
    await admin.query("insert into storage.buckets(id,name) values('project-orphans','project-orphans')");
    await admin.query("insert into storage.objects(bucket_id,name,metadata) values('project-orphans','unknown','{}')");
    assert.equal((await admin.query(reserve(a, id, 600000000))).rows[0].xbar_reserve_upload.id, id);
    await assert.rejects(admin.query(reserve(b, randomUUID(), 1)), (e) => e.code === 'PZ002');
    await admin.query(
      "update storage.objects set metadata=jsonb_build_object('size',100) where bucket_id='project-orphans'",
    );
    assert.equal(
      Number((await admin.query('select xbar_project_upload_admission_bytes() bytes')).rows[0].bytes),
      600000100,
    );
    // Actual object plus an active reservation is charged once, all buckets count.
    await admin.query(
      "insert into storage.objects(bucket_id,name,metadata) values('horse-documents',$1,jsonb_build_object('size',600000000))",
      [`${a.ws}/documents/${id}/race.pdf`],
    );
    assert.equal(
      Number((await admin.query('select xbar_project_upload_admission_bytes() bytes')).rows[0].bytes),
      600000100,
    );
    const token = randomUUID();
    await admin.query('select xbar_begin_upload($1,$2)', [id, token]);
    await admin.query('select xbar_bind_upload($1,$2,$3)', [id, token, 'provider-budget']);
    await admin.query('select xbar_claim_upload_completion($1,$2)', [id, token]);
    await admin.query('select xbar_start_upload_completion($1,$2)', [id, token]);
    await admin.query('select xbar_settle_upload_stored($1,$2)', [id, token]);
    assert.equal(
      Number((await admin.query('select xbar_project_upload_admission_bytes() bytes')).rows[0].bytes),
      600000100,
    );
    await assert.rejects(admin.query(reserve(b, randomUUID(), 0)), (e) => e.code === 'PZ001');
    await admin.query("delete from storage.objects where bucket_id='project-orphans' or name=$1", [
      `${a.ws}/documents/${id}/race.pdf`,
    ]);
    await admin.query('update upload_project_budget set limit_bytes=900000000');
    // Different workspaces avoid the workspace lock, exercising duplicate-ID
    // lookup racing with insertion. Full cap must not misreport not-started.
    const duplicate = randomUUID();
    await race(
      'duplicate-id-at-cap',
      reserve(a, duplicate, 900000000),
      reserve(b, duplicate, 1),
      'Upload reservation identity conflict.',
    );
    await admin.query('begin');
    await service(admin);
    await assert.rejects(admin.query('select xbar_project_upload_admission_bytes()'), (e) => e.code === '42501');
    await admin.query('rollback');
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await admin.query('begin');
      await admin.query(`set local role ${role}`);
      await assert.rejects(admin.query('select * from upload_project_budget'), (e) => e.code === '42501');
      await admin.query('rollback');
    }
    console.log('PASS all-bucket/orphan/unknown/over-budget/recovery/no-double-charge/private-setting regressions');
  } finally {
    await admin.query('rollback');
    await admin.query('update upload_project_budget set limit_bytes=$1', [original]);
    await admin.query('delete from workspace_upload_reservations where workspace_id=any($1::uuid[])', [[a.ws, b.ws]]);
    await admin.query('delete from workspaces where id=any($1::uuid[])', [[a.ws, b.ws]]);
    await admin.query('delete from auth.users where id=any($1::uuid[])', [[a.actor, b.actor]]);
    await admin.query("delete from storage.objects where bucket_id='project-orphans'");
    await admin.query("delete from storage.buckets where id='project-orphans'");
  }
} finally {
  await admin.end();
}

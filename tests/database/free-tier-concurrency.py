"""Real PostgreSQL, full production schema, disposable localhost database ONLY.

This is deliberately not a mock: a committed first write fills the last slot
while a second authenticated session is observed waiting on its advisory lock.
The losing write must fail with the exact capacity error, not any SQL error.
"""
import json
import os
import queue
import subprocess
import threading
import time
import uuid

if os.environ.get('PGHOST') not in ('localhost', '127.0.0.1') or os.environ.get('PGDATABASE') != 'xbar_free_tier_test':
    raise SystemExit('Refusing anything except local disposable xbar_free_tier_test')
PSQL = ['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1']


def sql(statement):
    return subprocess.run(PSQL + ['-c', statement], text=True, capture_output=True, timeout=20, check=True).stdout.strip()


def auth(actor):
    claims = json.dumps({'sub': actor, 'role': 'authenticated'})
    return f"set local role authenticated; set local request.jwt.claim.sub='{actor}'; set local request.jwt.claims='{claims}';"


def fixture():
    actor, outsider, ws = (str(uuid.uuid4()) for _ in range(3))
    sql(f"insert into auth.users(id,email) values('{actor}','{actor}@example.invalid'),('{outsider}','{outsider}@example.invalid');"
        f"insert into workspaces(id,owner_user_id,name) values('{ws}','{actor}','Disposable Free race');"
        f"insert into workspace_subscription_profiles(workspace_id) values('{ws}');")
    assert sql(f"select horse_limit from xbar_commercial_limits('{ws}')") == '2'
    return actor, outsider, ws


def race(label, actor, first_sql, second_sql, expected_error, final_query, expected_value):
    first = subprocess.Popen(PSQL, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    output = queue.Queue()
    threading.Thread(target=lambda: [output.put(line.strip()) for line in first.stdout], daemon=True).start()
    second = None
    try:
        first.stdin.write(f"begin; {auth(actor)} {first_sql}; select 'first-write-ready';\n")
        first.stdin.flush()
        deadline = time.monotonic() + 10
        while output.get(timeout=max(0.01, deadline-time.monotonic())) != 'first-write-ready':
            if time.monotonic() >= deadline:
                raise TimeoutError('First write failed to reach barrier')
        app = 'free-race-' + label
        second = subprocess.Popen(PSQL + ['-c', f"set application_name='{app}'; begin; {auth(actor)} {second_sql}; commit;"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        deadline = time.monotonic() + 10
        while sql(f"select count(*) from pg_stat_activity where application_name='{app}' and wait_event_type='Lock' and lower(wait_event)='advisory'") != '1':
            if second.poll() is not None:
                raise AssertionError(('Second write never waited', second.communicate()))
            if time.monotonic() >= deadline:
                raise TimeoutError('Second write did not wait on workspace lock')
            time.sleep(0.05)
        first.stdin.write("commit; select 'first-committed';\n")
        first.stdin.flush()
        stdout, stderr = second.communicate(timeout=15)
        assert second.returncode != 0 and expected_error in stderr, (label, stdout, stderr)
        assert sql(final_query) == expected_value, label + ' final persisted count/size mismatch'
        print('PASS: ' + label + ' authenticated two-connection quota race', flush=True)
    finally:
        if second is not None and second.poll() is None:
            second.kill()
            second.communicate(timeout=5)
        first.stdin.close()
        try:
            first.wait(timeout=5)
        except subprocess.TimeoutExpired:
            first.kill()
            first.wait(timeout=5)


actor, outsider, ws = fixture()
sql(f"insert into horses(workspace_id,horse_id,name) values('{ws}','seed','Seed');")
race('horse', actor,
     f"insert into horses(workspace_id,horse_id,name) values('{ws}','first','First')",
     f"insert into horses(workspace_id,horse_id,name) values('{ws}','second','Second')",
     'Horse limit reached for this workspace.', f"select count(*) from horses where workspace_id='{ws}'", '2')

actor, outsider, ws = fixture()
sql(f"insert into documents(workspace_id,document_id,title,state) select '{ws}','seed-'||i,'Seed','Ready' from generate_series(1,9) i;")
race('document', actor,
     f"insert into documents(workspace_id,document_id,title,state) values('{ws}','first','First','Ready')",
     f"insert into documents(workspace_id,document_id,title,state) values('{ws}','second','Second','Ready')",
     'Document limit reached for this workspace.', f"select count(*) from documents where workspace_id='{ws}'", '10')

actor, outsider, ws = fixture()
sql(f"insert into documents(workspace_id,document_id,title,state,size_bytes) values('{ws}','seed','Seed','Ready',1073741823);")
race('storage', actor,
     f"insert into documents(workspace_id,document_id,title,state,size_bytes) values('{ws}','first','First','Ready',1)",
     f"insert into documents(workspace_id,document_id,title,state,size_bytes) values('{ws}','second','Second','Ready',1)",
     'Storage limit reached for this workspace.', f"select sum(size_bytes) from documents where workspace_id='{ws}'", '1073741824')

actor, outsider, ws = fixture()
race('seat', actor,
     f"insert into workspace_memberships(workspace_id,user_id,email,role,status) values('{ws}','{actor}','{actor}@example.invalid','Admin','active')",
     f"insert into workspace_memberships(workspace_id,user_id,email,role,status) values('{ws}','{outsider}','{outsider}@example.invalid','Staff','active')",
     'Seat limit reached for this workspace.', f"select count(*) from workspace_memberships where workspace_id='{ws}'", '1')

# The same actual table policies must refuse a different authenticated ranch.
result = subprocess.run(PSQL + ['-c', f"begin; {auth(outsider)} insert into horses(workspace_id,horse_id,name) values('{ws}','intruder','Denied'); commit;"], capture_output=True, text=True, timeout=15)
assert result.returncode != 0 and 'row-level security policy' in result.stderr, result.stderr
assert sql(f"select count(*) from horses where workspace_id='{ws}' and horse_id='intruder'") == '0'
print('PASS: cross-workspace authenticated create denied with zero persisted rows', flush=True)

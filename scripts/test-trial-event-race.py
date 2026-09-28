"""Disposable PostgreSQL only: three connections force the webhook/trial race.

Requires psql and the PG* environment set by trial-event-database.yml.
The fixed workspace UUID and test trigger belong only to the CI fixture.
"""

import json
import queue
import subprocess
import sys
import threading
import time

PSQL = ["psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"]
WORKSPACE = "11111111-1111-4111-8111-111111111111"
TRIAL = {"startedAt": "2026-09-25T12:00:00Z", "endsAt": "2026-10-09T12:00:00Z", "plan": "Professional"}


def sql(statement):
    result = subprocess.run(PSQL + ["-c", statement], capture_output=True, text=True, timeout=15, check=True)
    return result.stdout.strip()


def race(existing, expect_loss):
    sql("truncate workspace_subscription_events, workspace_billing_customers, workspace_subscription_profiles")
    if existing:
        sql(f"insert into workspace_subscription_profiles (workspace_id, tier, billing_state) values ('{WORKSPACE}', 'Starter', 'Inactive')")

    gate = subprocess.Popen(PSQL, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    output = queue.Queue()
    reader = threading.Thread(target=lambda: [output.put(line.strip()) for line in gate.stdout], daemon=True)
    reader.start()
    webhook = None
    try:
        gate.stdin.write("select pg_advisory_lock(926030); select 'gate-ready';\n")
        gate.stdin.flush()
        deadline = time.monotonic() + 10
        while output.get(timeout=max(0.01, deadline - time.monotonic())) != "gate-ready":
            if time.monotonic() >= deadline:
                raise TimeoutError("Gate connection did not acquire its lock")

        event = f"""set application_name = 'xbar-trial-webhook-test';
          select public.xbar_apply_subscription_event(
            '{WORKSPACE}', 'evt-race', 'customer.subscription.updated', now(), '{{}}',
            'Professional', 'Active', 29, '{{"billingState":"Active"}}',
            'cus-test', 'sub-test', 'price-test', 1, false, 'annual');"""
        webhook = subprocess.Popen(PSQL + ["-c", event], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        deadline = time.monotonic() + 10
        while sql("select count(*) from pg_stat_activity where application_name='xbar-trial-webhook-test' and wait_event_type='Lock' and lower(wait_event)='advisory'") != "1":
            if webhook.poll() is not None:
                raise AssertionError(f"Webhook exited before the barrier: {webhook.communicate()}")
            if time.monotonic() >= deadline:
                raise TimeoutError("Webhook did not reach the forced race window")
            time.sleep(0.05)

        payload = json.dumps({"trial": TRIAL})
        if existing:
            changed = sql(f"update workspace_subscription_profiles set payload='{payload}'::jsonb where workspace_id='{WORKSPACE}' and billing_state='Inactive' and payload='{{}}'::jsonb returning workspace_id")
            assert changed == WORKSPACE, "Trial update must commit before the webhook resumes"
        else:
            sql(f"insert into workspace_subscription_profiles (workspace_id,tier,billing_state,payload) values ('{WORKSPACE}','Starter','Inactive','{payload}'::jsonb)")

        gate.stdin.write("select pg_advisory_unlock(926030);\n")
        gate.stdin.flush()
        stdout, stderr = webhook.communicate(timeout=15)
        assert webhook.returncode == 0, stderr
        assert stdout.strip() == "t", stdout
        result = json.loads(sql(f"select json_build_object('profile',p.payload->'trial','customer',c.entitlement_payload->'trial','state',p.billing_state,'period',p.billing_period) from workspace_subscription_profiles p join workspace_billing_customers c using(workspace_id) where p.workspace_id='{WORKSPACE}'"))
        assert result["state"] == "Active" and result["period"] == "annual", result
        if expect_loss:
            assert result["profile"] is None and result["customer"] is None, result
        else:
            assert result["profile"] == TRIAL and result["customer"] == TRIAL, result
        print(f"{'Reproduced loss' if expect_loss else 'Preserved trial'}: {'existing profile' if existing else 'concurrent first profile'}", flush=True)
    finally:
        if webhook is not None and webhook.poll() is None:
            webhook.kill()
            webhook.communicate(timeout=5)
        gate.stdin.close()
        try:
            gate.wait(timeout=5)
        except subprocess.TimeoutExpired:
            gate.kill()
            gate.wait(timeout=5)


if __name__ == "__main__":
    for existing in (True, False):
        race(existing, "--expect-loss" in sys.argv)

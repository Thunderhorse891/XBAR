# Isolated PostgreSQL recovery verification

This workflow uses a disposable official PostgreSQL 17.6 service on the standard
GitHub-hosted runner. It has no Supabase project connection, production secret,
customer fixture, paid database branch, deployment step or migration application.
The password and identities are synthetic and valid only inside this job.

`bootstrap.sql` provides the auth/storage catalogs needed to load the repository's
actual generated schema and current policy/function definitions. It must never
be executed against a Supabase project. No existing policy is replaced by a fake
permissive policy: authenticated role assertions execute the real repository RLS.

The baseline covers owner, Admin, Ranch Manager, Medical Lead, Sales Lead,
Owner/client, outsider, inactive member, anonymous and unknown-role writes/reads; a failed
foreign-workspace write rolls back an earlier allowed write. Medical Lead updates
use an allowed medical field and separately verify that an unrelated field is
rejected by the real specialist trigger. Current shared-owner
deletion refusal and private-account request fencing are tested too.

This establishes an actual-PostgreSQL test path for proposed audit 09/12 changes.
It does not implement or certify the proposed history table or transactional-save
RPC. Those need their own actual SQL, role/hold/race/rollback tests, independent
security review and explicit production-migration approval before rollout.

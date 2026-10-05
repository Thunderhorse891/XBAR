# Customer action feedback

## Bounded first correction

Baseline: `a17aaf930a4b4d138f591f148851a4a110422fa9`.

XBAR already has one global Sonner toaster, used through `useUiStore.pushToast`. This change improves that existing system and the global create/edit drawer; it does not add a second notification system, change branding, or add irreversible-delete recovery claims.

### Inventory

- Global create/edit: horse create/edit, expense creation, document intake, health/breeding records, horse moves, buyer follow-up creation and equipment creation already emit result toasts. Before this correction, validation and rejection were transient, an exception could leave async forms busy, repeated submits were not synchronously guarded, and success preceded the local storage acknowledgment.
- Equipment details: create/save/delete and Mark Repaired already have result-dependent toasts. The delete confirmation explicitly says it cannot be undone. This patch does not change deletion semantics.
- Medical, breeding and ownership screens: existing result-dependent notifications remain in place. Their domain repairs are separate work.
- Horse archiving: existing recoverable archive has a scoped Undo plus persistent Restore. Gallery removal retains originals and has its own Restore. Those implementations are preserved.
- Documents, exports and Settings: existing result/error reporting remains. Cloud autosave separately owns its queued/syncing/error/acknowledged status.
- Buyer follow-up Revoke: the handler ignores `updateSalesLead`'s result before reporting access revoked. This is an identified separate follow-up, not fixed by this drawer patch.

## Result contract

- A refused mutation leaves the draft visible and announces its reason inline and in an error toast.
- A thrown mutation does not produce success. The draft remains, retry is enabled, and the message asks the customer to check the records before retrying an unconfirmed action.
- A synchronous lock prevents repeated clicks from launching duplicate operations. The drawer says when it is saving; dismissal is disabled until that operation finishes because the underlying write is not cancelable.
- Success waits for the captured device-write receipt. It says “Saved on this device”; cloud sessions explicitly say cloud sync runs separately. It never calls the local acknowledgment a server acknowledgment.
- Missing/rejected/false device acknowledgment gives a persistent session-only warning. The mutation has already occurred, so the drawer closes rather than inviting a duplicate create.
- Document intake is a queue outcome and remains informational, with its full existing review/missing-original disclosure and “Queue state saved” wording. It is not presented as proof that every original uploaded or every source fact was approved.
- New quick-create requests clear old draft/error state. Late results cannot close a newer drawer, navigate it, or disclose old-context details after the account/workspace changes.
- Repeated quick-create validation updates one notification rather than stacking duplicates over the form. Shared toasts stay visible for six seconds by default; warnings, errors and actions get ten seconds unless the caller explicitly specifies otherwise. The toaster keeps its live region, adds safe-area offsets, wraps long content, and no longer inherits the legacy custom toast entrance animation.

## Verification

The first eight actual-component regression tests failed on the baseline and passed after the correction. Seventeen focused component/store tests cover validation, refusal, thrown sync/async actions, duplicate clicks, missing/rejected/failed writes, receipt replacement, cloud wording, request replacement, stale account completion, dismissal while saving, shared toast durations, changed-account retry after rerender, and Back/Forward navigation during persistence. Existing workflow tests run alongside them.

Eight Playwright cases cover desktop/mobile confirmation after navigation and reload, refusal after popup dismissal, exception recovery, context changes, and immediately starting the next action while its confirmation is visible. Local execution reaches Vite on localhost, but Chromium fails before page creation with socket `EPERM`; rendered verification and screenshots therefore remain a hosted CI gate. No local browser pass is claimed.

All 164 configured Node test steps passed using the supported `node --import=tsx` loader adapter. Canonical `npm test` reached the sandbox-blocked `tsx` CLI IPC listener; the adapter runs the same complete command list and changes only that invocation. Typecheck, full ESLint (zero errors/four existing warnings), full formatting, app build and marketing generation passed.

Independent review reproduced two lifecycle gaps in the first candidate: retrying an old draft after an account switch, and completion overriding newer navigation. Both gained failing-before/passing-after tests. Context now stays pinned to the opening request until it is reopened, and only the original committed location may receive the completion redirect.

The first hosted run passed 173 browser tests and exposed four failures: modal drawer pointer capture blocked Close toast; success notifications covered Create in two existing upload workflows; and an existing checkout test used the previous error-toast lifetime. Notification bodies now pass pointer input through, their explicit controls remain interactive, and toast interactions do not dismiss an open drawer. The checkout regression advances beyond the new ten-second lifetime while preserving its original persistent-error assertions. The revised hosted run remains required.

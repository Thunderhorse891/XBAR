# Mobile setup: visible, announced and recoverable failure

## Scope and baseline

Main remains c81b03be9b9faed9aa4a0e8f1e45867aefd0ddc0. This is a separate
main-based draft; checkout #405 and native-code #406 are untouched. The older
#246 redesign was read and is not incorporated: it changes setup structure and
has a separate visual hold. This correction preserves current branding, setup
fields, defaults, permissions, cloud-before-checkout gating and plan routing.
No hosted account, email, subscription, production data or setting is changed.

## Reproduction and correction

The existing setup failure was persistent visually but used an ordinary div.
It neither announced itself as an alert nor provided a focus target. A
controlled render of the real SetupWorkspace component with a failed cloud
save reproduced the absent alert. It also proved that entered ranch names are
retained and that no navigation occurs on failure. The regression failed
before the correction and passes afterward.

The failure summary now has role=alert and tabIndex=-1. An effect focuses it
when an error arrives, bringing the explanation into view without adding an
extra keyboard tab stop. Starting a retry clears the stale failure; saving
continues to disable duplicate submission. No service errors are swallowed or
rewritten and success is still gated on the existing save result.

The controlled regression checks unchanged field values, exact derived owner
values on retry, no navigation on failure, disabled pending retry and the
original selected-plan destination only after a successful synthetic cloud
save. All 12 route tests pass. Optional module overrides and a Navigate boundary
in the test harness permit isolated dependencies; default harness behavior is
unchanged. This shares the optional-boundary facility with #406 without stacking
on or modifying it. Combining those drafts must retain both regression cases.

## Phone-width and first-horse acceptance

A new supported e2e case at 390x844 starts with an invalid empty setup, requires
a focused alert in view, corrects the two names, opens the horse roster and
uses Back, then creates the first horse with derived owner/entity defaults.
It checks exact saved count, uppercase registered name, nonempty ID and the
same record after reload. The fixture only marks local entry; it does not clear
storage on reload or use hosted customers. This is browser viewport coverage,
not evidence from an actual iPhone or Android device.

The local browser environment already refused normal Playwright startup at
uv_interface_addresses during #406 verification. No security flags or alternate
network route is used to bypass that restriction. This new focus/Back/horse
case requires exact-head remote CI before it is called verified. Hosted signup,
email confirmation, interrupted service recovery, actual device keyboards and
hosted first-horse persistence remain separate gates.

## Validation

Typecheck, test-project compilation, ESLint (four existing warnings), formatting,
diff checks and app/marketing build pass locally. The first browser-test typing
error was corrected before publication and test-project compilation reran
successfully. Canonical npm test was repeated afterward and reaches the known
tsx IPC listen EPERM. The full configured chain passes through the supported Node tsx-loader
substitution without removing steps or assertions. Exact-head remote CI and
the new browser case remain required.

# Preview server default port: bounded polish batch

Base: draft #403 at d1390fa1b5bce3f6ae576be762b8cfd06736ce5f. This narrow
follow-up stays separate to avoid resetting the combined candidate CI. Main
and READY production were read as c81b03be9b9faed9aa4a0e8f1e45867aefd0ddc0.
No checkout-lane branch, live data, artwork or deployment was modified.

## Reproduced and fixed

With PORT unset and no --port argument, scripts/serve-dist.mjs reads argv[0]
because indexOf returns -1. Number of the Node executable path becomes NaN;
server.listen refuses it instead of using the intended 4173 fallback. The
registered nativeRouting suite now executes the real bundled launcher,
intercepting only HTTP listen and the module URL. Its isolated new test failed
before the fix with Invalid listen port and passes afterward. No socket or
production service is contacted by this fixture. Explicit CLI port, PORT
precedence, unrelated flags and ephemeral port zero are covered. npm run preview
already supplies --port 4173; this fixes direct/default launcher invocation,
not a claimed production outage.

The correction checks that --port exists before reading its next argument.
No route mapping, hosting defaults, payment behavior or app bundle is changed.
All eight existing/new native-routing and launcher tests pass.

## Source review coverage

Full reads: UploadRecoveryPanel, HorsePhotoSourceDialog, ConfirmActionDialog,
confirmActionDialog.css, useHorsePhotoSelection and photoSelection. Re-read
shared Dialog, mobile build launcher, preview server and nativeRouting tests.
Account/workspace and one-shot photo ticket checks remain unchanged. Source
review confirms explicit labels and existing focus restoration callbacks; it
does not establish real screen-reader, keyboard, mobile picker or device
behavior. No new reproducible fault was established in the six unchanged
modules. The consolidated baseline now records 62 reviewed, 727 maintained
pending and 140 excluded out of 929 files. Larger app-wide and native acceptance
remains open; no exhaustive accessibility or launch-ready claim is made.

## Validation and remaining gates

The required canonical npm test was attempted and stops at the existing tsx
launcher IPC socket restriction (listen EPERM). The complete configured chain
is also run with only standalone tsx commands replaced by Node's supported
--import=tsx invocation, retaining every assertion. Typecheck and ESLint pass
with four pre-existing Fast Refresh warnings; repository formatting passes.
The direct launcher fixture passes all eight routing/build tests. Actual server
socket startup and browser/device acceptance remain environment-limited and
must be confirmed by the remote exact-head workflow. The #402/#403 source heads
remain unchanged by this follow-up; their running CI is reported separately.

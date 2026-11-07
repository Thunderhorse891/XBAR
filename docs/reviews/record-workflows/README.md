# Equipment and selected-record handoffs (audit 28 and 32)

Base: remote main de684de5c6526f66d26ac4108ed50378236a67dd, independently matched tree 5258fa54046e8d633d36ba232f374a00fd9f3bed.

## Corrected behavior

- Equipment creation opens the existing named/category/location form without mutating a placeholder. A successful create opens its exact existing asset maintenance editor.
- Equipment cards and counts use the selected asset category (default Equipment); categories survive reload through the URL. Cards expose the existing assignment, condition, next-service and notes editor. Role restrictions and unsuccessful repair messages stay truthful.
- Asset editors read the requested ID, support query changes and late record loading, and clear stale form data when a requested record is unavailable. Inline asset creation initializes its own details rather than preserving another asset's form.
- Open Group passes its segment to the roster, excludes archived horses, and handles an all-archived roster. Young Stock is a valid filter from the same segment list used by creation.
- Horse-profile Upload Doc and Build Sale Packet retain the horse through existing destination query contracts.

## Evidence

Nine controlled tests execute the actual route components and their event/effect callbacks with controlled store/router boundaries. The original five cases all fail against the main baseline and pass after correction. An independent reviewer identified the stale query-to-missing-asset case; it reproduces against the first patch and passes after correction. The suite also checks category selection, asset identity and role-disabled controls. It is registered in npm test.

Three browser workflows cover equipment create → selected maintenance edit → reload, profile → horse-specific upload/packet, and two distinct groups → Young Stock filter → reload. These must run in exact-head CI. Local Chromium aborts on process_singleton socket EPERM before any page is created, including an approved escalation retry. Vite itself starts when bound to loopback; the unmodified 0.0.0.0 test config additionally hits uv_interface_addresses. No local browser or rendered visual pass is claimed.

All configured Node steps pass using the supported Node import-loader adapter for the tsx CLI's blocked IPC socket. TypeScript, full ESLint (four existing Fast Refresh warnings), Prettier, application build and marketing generation pass. Exact-head CI/review, production deployment and affected production verification remain release gates.

## Scope boundaries

No migration, customer-data mutation, file deletion or redesign. Gallery and file-first horse Documents are independent follow-on findings. Care Tasks group filtering is coordinated with the care workflow owner. This patch does not turn a maintenance date into a durable work-order ledger.

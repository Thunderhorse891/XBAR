# Buyer inquiry resolver-envelope compatibility

The actual inquiry handler rejected the current nested listing resolver envelope with404 instead of writing a buyer event. A mixed response could instead select a conflicting top-level workspace and empty horse/listing IDs. Synthetic handler tests reproduced both defects before correction; a valid legacy single-row control passed.

The correction accepts the canonical envelope or one legacy row, requires complete consistent target identifiers and preserves opaque horse/listing IDs exactly. Canonical envelope path, Live state, horse identity and access mode must agree. RPC token/release refusal still stops before the service-role insert. Request validation, CORS, rate limiting and insertion failures retain their existing behavior.

Fifteen actual-handler tests execute real JSON parsing and validation while replacing external Supabase/rate/CORS boundaries. They cover current/legacy response, conflicting scope, absent/malformed targets, path/state mismatch, ambiguous rows, token refusal, public metadata, insertion failure and opaque IDs. The suite is individually registered in npm test.

This candidate was reconstructed after the earlier local-only checkout disappeared. Fresh independent review and full exact-head checks are required. No real buyer inquiry or message was sent; no production database change is included.

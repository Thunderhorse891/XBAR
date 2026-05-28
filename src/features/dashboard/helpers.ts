// The Dashboard route delegates all data-derivation work to the
// functions exported from @/lib/dashboardOps
// (buildBudgetSummary, buildCareBoardRows, buildTransferGapRows) and to
// @/lib/format (formatCompactCurrency, formatCurrency, formatDateLabel).
//
// No additional pure helper functions are defined locally in
// src/pages/Dashboard.tsx, so this file intentionally has no exports.
// Add dashboard-specific pure utilities here as they are introduced.

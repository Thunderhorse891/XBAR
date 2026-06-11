# XBAR Production Upgrade Checklist

## Platform

- Deploy the web app to a real runtime surface such as Vercel or Netlify.
- Capacitor scaffold is active so the existing React app can ship to iOS and Android from one codebase.
- Browser routing is ready for hosted platforms, with hash routing preserved for GitHub Pages previews.
- Legacy desktop wrapper source has been removed from the active repo path so the platform direction is web + mobile only.

## Product

- Finish the relational Supabase runtime and remove remaining snapshot-era fallback behavior from the main path.
- Add a real OCR and entity extraction pipeline for registration papers, Coggins, transfer packets, bills of sale, health certificates, and receipt proof.
- Build real receipt and expense storage around feed, wormer, dental float, farrier, vet, haul, breeding, and facility spend.
- Add operational alerts for Coggins, health certificates, wormer cadence, dental float cadence, transfer holds, proof gaps, and buyer follow-ups.
- Add workspace invitations, seat enforcement, and backend role assignment.
- Complete buyer-safe packet pages with real public access control, release controls, analytics, and proof sanitization.

## Design System

- Build XBAR as premium operational command infrastructure, not generic SaaS dashboard UI.
- Keep one restrained graphite/gunmetal/silver/electric-blue brand system across the product.
- Give each section a distinct operational silhouette: Command Center, Command Files, Title & Transfer, Proof Vault, Care Status, Buyer Desk, Operating Ledger, Ranch Assets, Field Conditions, and Ranch Control should not share the same repeated layout pattern.
- Every major surface should answer: entity, status, evidence, risk, and next action.
- Reduce generic card grids unless they are supporting a specific operational decision.
- Standardize icons to one family and one stroke system.
- Keep the shell aligned to graphite command surfaces, metallic workspace panels, controlled blue accents, and precise typography.

## Suggested Stack Direction

- React + hosted web deployment for the main product surface.
- Capacitor for mobile distribution.
- Supabase for auth, database, storage, invitations, document storage, OCR metadata, and audit history.
- Stripe with Checkout, Billing Portal, and webhooks for subscriptions.
- A unified component system layered on top of the current app, with room to migrate to a stronger token-driven UI library such as shadcn/ui.

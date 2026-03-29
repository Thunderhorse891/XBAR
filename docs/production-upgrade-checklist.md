# XBAR Production Upgrade Checklist

## Platform

- Deploy the web app to a real runtime surface such as Vercel or Netlify.
- Add Capacitor so the existing React app can ship to iOS and Android from one codebase.
- Retire the Tauri-first product path once Capacitor and the hosted web runtime are stable.

## Product

- Finish the relational Supabase runtime and remove remaining snapshot-era fallback behavior from the main path.
- Add a real OCR and entity extraction pipeline for registration papers, coggins, transfer packets, and health certificates.
- Build real receipt and expense storage around feed, wormer, dental float, farrier, and vet spend.
- Add compliance alerts for coggins, health certificates, wormer cadence, and dental float cadence.
- Add workspace invitations, seat enforcement, and backend role assignment.
- Complete buyer-safe share pages with real public access control and analytics.

## Design System

- Rebuild the product shell around one consistent token system for spacing, typography, shadows, and color.
- Move the UI toward a premium SaaS direction: quiet surfaces, tighter hierarchy, stronger typography, and fewer generic cards.
- Keep one brand accent and neutral semantic colors instead of ad hoc page-by-page styling.
- Add loading skeletons, stronger empty states, and mobile-sized touch targets.
- Standardize icons to one family and one stroke system.

## Suggested Stack Direction

- React + hosted web deployment for the main product surface.
- Capacitor for mobile distribution.
- Supabase for auth, database, storage, and invitations.
- Stripe with Checkout, Billing Portal, and webhooks for subscriptions.
- A unified component system layered on top of the current app, with room to migrate to a stronger token-driven UI library.

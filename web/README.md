# XBAR Web — Next.js Frontend

Premium aerospace-graphite frontend for the XBAR equine operations platform.
Next.js 14 App Router · TypeScript · Tailwind CSS · shadcn-style components ·
Zustand · TanStack Query · React Hook Form + Zod · Framer Motion · Lucide.

## Quick start

```bash
cd web
npm install
npm run dev
```

Open http://localhost:3000. The app runs entirely against **mock data** until
`NEXT_PUBLIC_API_URL` is set (see `.env.example`) — every page, mutation, and
OCR flow works offline.

Sign in with any email + 8-character password. The login form includes a demo
plan picker (Basic / Pro / Business) that drives subscription-tier gating:

- **Basic** — core pages; sale-packet upsells and locked barn settings
- **Pro** — sale packet generation enabled
- **Business** — barn settings, packet-requests widget, team step in onboarding

## Structure

```
app/                 App Router pages (landing, login, onboarding, (app)/*)
  (app)/             Authenticated shell: dashboard, horses, documents,
                     calendar, settings/billing, barn/settings
components/ui/       Themed shadcn-style primitives
components/…         Feature components (OCR modal, sale packet wizard, …)
hooks/queries.ts     TanStack Query hooks
lib/api.ts           API client: JWT fetch wrapper + mock backend
lib/mock-data.ts     Relative-dated development data
stores/              Zustand stores (ui, ocr, subscription)
middleware.ts        Auth + tier route protection (cookies)
```

## Conventions

- **Palette** is locked to the design brief (`tailwind.config.ts`); no green
  anywhere — verified/success states use XBAR blues.
- Light workspace, dark graphite for sidebar/command panels only.
- Focus rings are electric blue; OCR progress announces via a live region;
  all icon buttons carry ARIA labels; skip-to-content on every layout.
- Heavy modals (OCR, sale packet generator) are code-split via `next/dynamic`.

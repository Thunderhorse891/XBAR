# Vercel browser workspace preview

This dedicated preview branch runs `npm run build:local` on Vercel. The frontend Supabase URL and key are explicitly empty, so it creates no cloud auth client. The existing browser workspace flow needs no account or password.

Workspace records stay in browser storage on this Vercel origin. This is not a copy of the existing cloud ranch, and records do not sync between devices. Database policies and server authorization are unchanged.

Keep this build override on the dedicated preview branch. Do not merge it into the cloud production branch. Restore the standard build command when returning this preview to cloud sign-in.

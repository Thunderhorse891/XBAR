# Email delivery readiness

## What exists

Application email has four lifecycle templates (welcome, trial ending, trial expired,
and payment failed), buyer sale-packet notifications, and due-care reminders.
`api/_lib/email.js` chooses Resend first, then SendGrid, then explicitly enabled
Gmail SMTP. Supabase Auth confirmation, password reset, and auth invitations use
Supabase's separate SMTP configuration; configuring the app transport does not
configure those messages.

Daily care reminders create durable in-app notifications even without email.
Welcome and trial sends have no automatic historical backfill. Trial emails are
selected only within their existing date windows. Payment-failed email is triggered
by Stripe events. Packet email failure does not invalidate the generated packet;
the existing download/share flow remains available.

## No-new-service-cost Gmail option

The app supports an existing personal Gmail account without a purchased domain.
This is an optional low-volume fallback, not a guarantee of production delivery.
Google can block unusual server sign-ins and temporarily suspend sending. Mail
sent by the app shares the Gmail account's quota with its normal mail. Google
currently documents a limit around 500 messages/day, with sending blocked for
1–24 hours after a limit is exceeded. Never treat that ceiling as a throughput
promise or use this path for unsolicited/bulk mail.

The website can keep its `vercel.app` address. That address is not an email domain
owned by the application. Gmail sends as the authenticated Gmail address, retaining
the ranch's display name and seller Reply-To. It never impersonates a sender on
`vercel.app`, `xbar.app`, or another unverified domain.

### Setup requires owner approval and secure owner entry

1. Confirm the specific Gmail account may send XBAR's transactional email. Creating
   and storing a Google App Password grants persistent mailbox access, not merely
   send-only access. Use a dedicated account, keep the credential private, and revoke
   it from Google if no longer needed. No password should be pasted into chat or Git.
2. The owner enables Google 2-Step Verification if needed and creates a dedicated
   App Password in their Google account. App Password availability depends on the
   account's security settings. Do not weaken security or disable protection to
   make this option appear.
3. In Vercel's XBAR Production environment, the owner securely stores the dedicated
   App Password as secret `GMAIL_SMTP_APP_PASSWORD`, sets `GMAIL_SMTP_USER` to that
   same Gmail address, and explicitly sets `GMAIL_SMTP_ENABLED=true`. Never use a
   `VITE_` prefix. Existing Resend/SendGrid keys take precedence; do not remove or
   replace a working provider without approval.
4. Deploy the approved code/configuration. `/api/health` should report
   `subsystems.email=true` and an explicit Gmail **configured but unverified**
   warning. It intentionally does not expose the account or credential.
5. With approval for the exact recipient, test one message to an owner-controlled
   inbox and verify both provider acceptance and actual receipt. Then exercise
   welcome, trial, payment-failure and packet paths with synthetic fixtures. No
   buyer email or real payment is needed for these acceptance checks.
6. Separately inspect Supabase Auth SMTP. Its built-in mail service is not a public
   production email route. If Gmail SMTP is approved for Auth too, the owner enters
   the dedicated credential in Supabase, with `smtp.gmail.com`, port `465`, TLS,
   and the same authenticated sender. Verify sign-up confirmation and password
   recovery using an approved synthetic account before relying on them.

The Gmail adapter uses implicit TLS on port 465 with certificate validation,
bounded connection/socket timeouts, no connection pool, and no SMTP debug logs.
Vercel Node functions support this port. Google may still refuse a connection.
SMTP acceptance is not proof the recipient's inbox received the message.

## Failure and reconciliation contract

Lifecycle claims distinguish pending/uncertain from provider-accepted requests in
`workspace_subscription_events.payload.delivery_state`. A concurrent or legacy
claim is never proof of delivery. Missing providers and explicit provider declines
release only the owned pending claim. Timeouts, lost connections, HTTP 408/5xx,
and failed receipt persistence retain the claim to prevent duplicate email.

A pending result needs an operator to reconcile provider records before retrying.
Do not delete claims blindly. If no trustworthy acceptance/non-acceptance evidence
exists, leave the claim pending. Legacy claims without a delivery state also need
reconciliation. No migration or automatic claim backfill is performed.

Gmail temporary SMTP declines are retryable with backoff; a documented daily-limit
reply requests at least 24 hours. The care-reminder queue uses that backoff.
Lifecycle retries occur through their existing endpoint/webhook/daily schedule,
not a new delivery queue. They do not promise automatic recovery after every
configuration problem. Trial cron returns non-success on per-workspace failures
rather than a misleading successful batch.

## Safe acceptance checklist

- No credentials: missing/disabled/malformed config causes no network send
- Mocked SMTP: actual Gmail sender, seller Reply-To, branded HTML/plain text,
  explicit recipient acceptance, auth rejection, daily quota, transport timeout
- Retry cases: concurrent calls, failed/zero-row claim write, accepted mail whose
  receipt write fails, unresolved claim plus changed recipient, explicit rejection
- Existing transports: Resend and SendGrid payloads and provider order remain valid
- Approved live test only: named owner-controlled inbox receipt, auth confirmation,
  recovery link, app welcome, saved synthetic trial record and packet share
- Payments: test-mode fixtures only until a separate real transaction is authorized

## Official references

- [Vercel SMTP support](https://vercel.com/kb/guide/serverless-functions-and-smtp)
- [Google SMTP protocol](https://developers.google.com/workspace/gmail/imap/imap-smtp)
- [Google App Password requirements](https://support.google.com/accounts/answer/185833)
- [Personal Gmail limits](https://support.google.com/mail/answer/22839)
- [Nodemailer Gmail caveats](https://nodemailer.com/guides/using-gmail)
- [Supabase Auth custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)

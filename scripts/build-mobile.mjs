// Build the web bundle for Capacitor (iOS/Android).
//
// Mobile wraps dist/index.html directly, so the marketing-site post-build
// (which replaces dist/index.html with the public homepage) must be skipped,
// and the router uses hash mode because there is no server to rewrite
// /app/* paths inside the WebView.

import { spawn } from 'node:child_process';
import { loadEnv } from 'vite';
import { SITE_ORIGIN } from './marketing/render.mjs';

// In-app links to /privacy, /terms and /pricing must resolve to the real
// marketing site: those pages are not in the native bundle and no server routes
// them inside the WebView, so a relative path is a dead link and App Review
// treats that as a broken app (2.1).
//
// Nothing checked in sets VITE_PUBLIC_APP_URL (.env.production does not, and
// .env.example leaves it blank), so relying on the release operator to remember
// a command-line override would ship broken links by default. Default it to the
// same SITE_ORIGIN the marketing generator canonicalizes to — one source of
// truth, already correct today, and still overridable for a custom domain.
//
// Resolve through Vite's own loadEnv rather than process.env alone. Vite lets a
// prefixed process.env value win over its .env files, so passing a fallback
// down as an explicit variable would silently beat a VITE_PUBLIC_APP_URL the
// operator had correctly set in .env.production or .env.local — a custom-domain
// build would ship the default origin while looking configured.
const fileEnv = loadEnv('production', process.cwd(), 'VITE_');
const configuredSiteUrl = (process.env.VITE_PUBLIC_SITE_URL || fileEnv.VITE_PUBLIC_SITE_URL || '').trim();
const configuredAppUrl = (process.env.VITE_PUBLIC_APP_URL || fileEnv.VITE_PUBLIC_APP_URL || '').trim();
/*
 * The site is derived from the app URL before falling back to the default.
 *
 * .env.example promises that configuring only one of these works, and without
 * this line that promise was false in the direction people actually use: a
 * custom domain setting only VITE_PUBLIC_APP_URL got SITE_ORIGIN as its site,
 * so Terms and Privacy pointed at the stock production host rather than their
 * own. The runtime fallback in publicSiteOrigin() could not save it either,
 * because this script always injects VITE_PUBLIC_SITE_URL, so the value it
 * would have derived was already overwritten.
 */
const publicSiteUrl = (
  configuredSiteUrl ||
  configuredAppUrl.replace(/\/+$/, '').replace(/\/app$/, '') ||
  SITE_ORIGIN
).replace(/\/+$/, '');
/*
 * An ORIGIN, deliberately, with no `/app` appended.
 *
 * An earlier revision set this to `<site>/app` on the reasoning that the SPA is
 * served there. That was wrong, because this variable is not the client's
 * alone: api/sale-packets.js builds `${appOrigin}/app/verify/<id>` from it and
 * api/invite.js concatenates it the same way, so a value carrying `/app`
 * produced `/app/app/verify/<id>` — breaking the verification link printed
 * inside every sale packet, which is the one artifact whose whole purpose is
 * being checkable by a stranger.
 *
 * It also did not buy what it was meant to. buildPublicShareUrl still appends
 * `#/profiles/...`, and the deployed web bundle runs BrowserRouter, which
 * ignores a fragment — so the shared link was broken either way, before and
 * after. Correcting that means changing how share URLs are built for a
 * browser-routed target, which is web behavior this change has no business
 * touching.
 */
const publicAppUrl = (configuredAppUrl || publicSiteUrl).replace(/\/+$/, '');

const env = {
  ...process.env,
  XBAR_SKIP_MARKETING: '1',
  VITE_ROUTER_MODE: 'hash',
  VITE_STATIC_TARGET: 'web',
  // Marks the bundle as a store build, so purchase flows are gone from the
  // very first paint rather than after Capacitor's runtime is injected. Apple
  // rejects a paywall that sends customers to a non-IAP purchase (3.1.1), and
  // a paywall that flashes before disappearing is still a paywall.
  VITE_NATIVE_APP: 'true',
  /*
   * Two values, because the deployment has two roots on one origin.
   *
   * `npm run build` moves the SPA shell to `app.html`, served under `/app/*`,
   * and replaces `/` with static marketing HTML that has no router and ignores
   * a hash. So `/privacy` and `/terms` are marketing pages while every in-app
   * route lives under `/app`.
   *
   * Setting one variable for both was wrong in a way that renders cleanly:
   * `buildPublicShareUrl` consumes the app URL, so a single marketing origin
   * turned every shared, copied and emailed buyer link into
   * `https://site/#/profiles/<id>` — which loads the marketing homepage, looks
   * like a working page, and never shows the horse.
   */
  VITE_PUBLIC_SITE_URL: publicSiteUrl,
  VITE_PUBLIC_APP_URL: publicAppUrl,
};

console.log(`[mobile] legal links resolve to ${publicSiteUrl}; in-app links resolve to ${publicAppUrl}`);

const child = spawn('npm', ['run', 'build'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

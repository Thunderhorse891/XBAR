// Production-parity static server for the built dist/ output.
//
// `vite preview` cannot serve this repo correctly anymore: production routing
// is split between static marketing pages at the root and the SPA shell at
// /app/* (dist/app.html), with redirects handled by vercel.json. This server
// mirrors that routing so `npm run preview` and the prod-smoke Playwright
// suite exercise what production actually does.

import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, '..', 'dist');
const port = Number(process.env.PORT ?? process.argv[process.argv.indexOf('--port') + 1] ?? 4173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
};

// Mirrors the permanent redirects in vercel.json.
const APP_LEGACY =
  /^\/(horses|documents|sales|buyers|sale-packets|billing|settings|today|herd-groups|pastures|feed|health-care|ownership-chain|equipment|breeding-foaling|reports|expenses|reminders|medical|breeding|ownership|follow-ups|shared-access|getting-started|weather|animals|documents-vault|document-library|sales-pipeline|buyer-deal-room|buyer-follow-up|sale-packet-studio|plans|subscribe|subscriptions|assets-equipment)(\/.*)?$/;

function redirectTarget(pathname) {
  if (pathname === '/landing') return '/';
  if (pathname === '/login') return '/app/login';
  if (pathname === '/setup') return '/app/setup';
  if (pathname === '/assets') return '/app/assets';
  if (pathname.startsWith('/profiles/')) return `/app${pathname}`;
  const legacy = pathname.match(APP_LEGACY);
  if (legacy) return `/app/${legacy[1]}${legacy[2] ?? ''}`;
  return null;
}

function send(res, status, body, type, extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body), ...extraHeaders });
  res.end(body);
}

function sendFile(res, filePath, status = 200) {
  const body = readFileSync(filePath);
  send(res, status, body, MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream');
}

function resolveFile(pathname) {
  const safe = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const full = path.join(dist, safe);
  if (!full.startsWith(dist)) return null;
  if (existsSync(full) && statSync(full).isFile()) return full;
  if (existsSync(full) && statSync(full).isDirectory()) {
    const index = path.join(full, 'index.html');
    if (existsSync(index)) return index;
  }
  if (!path.extname(full)) {
    const asIndex = `${full}/index.html`;
    if (existsSync(asIndex)) return asIndex;
    const asHtml = `${full}.html`;
    if (existsSync(asHtml)) return asHtml;
  }
  return null;
}

const server = createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, 'Method Not Allowed', 'text/plain; charset=utf-8');
    return;
  }
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.slice(0, -1);

  const redirect = redirectTarget(pathname);
  if (redirect) {
    send(res, 308, '', 'text/plain; charset=utf-8', { Location: `${redirect}${url.search}` });
    return;
  }

  if (pathname === '/app' || pathname.startsWith('/app/')) {
    sendFile(res, path.join(dist, 'app.html'));
    return;
  }

  const file = resolveFile(pathname === '/' ? '/index.html' : pathname);
  if (file) {
    sendFile(res, file);
    return;
  }

  const notFound = path.join(dist, '404.html');
  if (existsSync(notFound)) sendFile(res, notFound, 404);
  else send(res, 404, 'Not Found', 'text/plain; charset=utf-8');
});

server.listen(port, '0.0.0.0', () => {
  console.log(`[serve-dist] serving ${dist} at http://127.0.0.1:${port} (production-parity routing)`);
});

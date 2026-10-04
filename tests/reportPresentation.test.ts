import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_REPORT_PRESENTATION,
  REPORT_ACCENT_PRESETS,
  resolveReportPresentation,
  validReportAccent,
} from '../src/lib/reportPresentation.js';

for (const tier of ['Starter', 'Professional'] as const) {
  assert.deepEqual(
    resolveReportPresentation(tier, { accent: '#000000', layout: 'cover', whiteLabel: true }),
    DEFAULT_REPORT_PRESENTATION,
  );
}
assert.deepEqual(resolveReportPresentation('Ranch Ops', { accent: '#000000', layout: 'cover', whiteLabel: true }), {
  accent: '#000000',
  layout: 'cover',
  whiteLabel: false,
});
assert.equal(resolveReportPresentation('Enterprise', { whiteLabel: true }).whiteLabel, true);
for (const color of [
  '#ffffff',
  '#eeeeee',
  '#aabbcc',
  'red',
  '#000',
  'url(https://example.test)',
  '#000000;display:none',
])
  assert.equal(validReportAccent(color), false, color);
for (const color of Object.values(REPORT_ACCENT_PRESETS)) assert.equal(validReportAccent(color), true, color);
const tokens = readFileSync('src/styles/brandTokens.css', 'utf8');
for (const [name, color] of Object.entries(REPORT_ACCENT_PRESETS))
  assert.ok(tokens.includes(`--xbar-${name.toLowerCase()}: ${color};`), `Print preset drift: ${name}`);
assert.equal(resolveReportPresentation('Ranch Ops', { accent: '#ffffff' }).accent, DEFAULT_REPORT_PRESENTATION.accent);
console.log('Report presentation: existing tiers, contrast, identity and token parity passed.');

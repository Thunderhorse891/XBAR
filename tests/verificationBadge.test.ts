import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBadgeSnippet, buildShareText, buildVerifyPath, buildVerifyUrl } from '../src/lib/verificationBadge.js';

test('verify path is basename-relative under /app', () => {
  assert.equal(buildVerifyPath('packet-abc'), '/app/verify/packet-abc');
});

test('verify url joins origin without doubling the slash', () => {
  assert.equal(buildVerifyUrl('https://xbar.app', 'packet-abc'), 'https://xbar.app/app/verify/packet-abc');
  assert.equal(buildVerifyUrl('https://xbar.app/', 'packet-abc'), 'https://xbar.app/app/verify/packet-abc');
});

test('badge snippet is a self-contained anchor to the verify url with the seal code', () => {
  const snippet = buildBadgeSnippet('https://xbar.app/app/verify/packet-abc', 'SEAL-BA78-16BF-8F01');
  assert.match(snippet, /^<a /);
  assert.ok(snippet.includes('href="https://xbar.app/app/verify/packet-abc"'));
  assert.ok(snippet.includes('SEAL-BA78-16BF-8F01'));
  assert.ok(snippet.includes('Verified by XBAR'));
  assert.ok(snippet.includes('target="_blank"'));
  assert.ok(snippet.includes('rel="noopener noreferrer"'));
  // No script, honest label only — never claims an appraisal.
  assert.ok(!/<script/i.test(snippet));
  assert.ok(!/apprais/i.test(snippet));
});

test('badge snippet HTML-escapes its inputs so a listing embed is safe', () => {
  const snippet = buildBadgeSnippet('https://x.test/app/verify/p"><script>alert(1)</script>', 'SEAL-"><b>');
  assert.ok(!snippet.includes('<script>'));
  assert.ok(snippet.includes('&lt;script&gt;'));
  assert.ok(snippet.includes('&quot;'));
});

test('badge snippet omits the seal code cleanly when none is given', () => {
  const snippet = buildBadgeSnippet('https://xbar.app/app/verify/packet-abc', '');
  assert.ok(snippet.includes('Verified by XBAR'));
  assert.ok(!snippet.includes('&middot;'));
});

test('share text is honest and includes the horse and seal', () => {
  const text = buildShareText('Docs Smokin Gun', 'SEAL-BA78-16BF-8F01');
  assert.ok(text.includes('Docs Smokin Gun'));
  assert.ok(text.includes('SEAL-BA78-16BF-8F01'));
  assert.ok(/verified by xbar/i.test(text));
  assert.ok(/unaltered/i.test(text));
  assert.ok(!/apprais|guarantee/i.test(text));
});

test('share text falls back gracefully without a name or seal', () => {
  const text = buildShareText('', '');
  assert.ok(text.startsWith('This horse'));
  assert.ok(!text.includes('(seal'));
});

test('share text names the ranch and the seal code without double-prefixing', () => {
  const text = buildShareText('Bella', 'SEAL-AB12-CD34-EF56', 'Rocking R Ranch');
  assert.equal(
    text,
    'Rocking R Ranch: sale packet for Bella verified by XBAR (seal code SEAL-AB12-CD34-EF56). ' +
      "Confirm it's unaltered before you buy:",
  );
  assert.ok(!text.includes('SEAL-SEAL-'), 'seal code must not be double-prefixed');
  assert.ok(!/apprais|guarantee/i.test(text));
});

test('share text without a ranch still reads honestly', () => {
  const text = buildShareText('Bella', 'SEAL-AB12-CD34-EF56');
  assert.ok(text.startsWith('Bella: sale packet verified by XBAR (seal code SEAL-AB12-CD34-EF56).'));
  assert.ok(/unaltered/i.test(text));
});

/* The native-share caption must never carry a quick-start placeholder.
 *
 * After "Use preview defaults" the workspace stores `My Ranch LLC` as the
 * business name; the wizard resolves the caption prefix through
 * realWorkspaceName so a synced or upgraded workspace does not share
 * buyer-facing text claiming an invented company sent the packet.
 */
test('the share caption omits a quick-start placeholder ranch name', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const wizardSrc = readFileSync(join(process.cwd(), 'src/components/SalePacketWizard.tsx'), 'utf8');
  assert.ok(
    /realWorkspaceName\(workspaceProfile\.businessName\)/.test(wizardSrc),
    'the wizard must filter the business name through realWorkspaceName',
  );
  assert.ok(
    !/workspaceProfile\.businessName \|\| workspaceProfile\.ranchName/.test(wizardSrc),
    'the unfiltered name must not reach the share caption',
  );
});

test('realWorkspaceName treats quick-start placeholders as absent', async () => {
  const { isQuickStartSentinel, realWorkspaceName } = await import('../src/lib/workspaceIdentity.js');
  assert.ok(isQuickStartSentinel('My Ranch LLC'));
  assert.ok(isQuickStartSentinel('Main Ranch'));
  assert.ok(isQuickStartSentinel('Operations Lead'));
  assert.ok(isQuickStartSentinel('owner@ranch.local'));
  assert.ok(!isQuickStartSentinel('Rocking R Ranch'));
  assert.equal(realWorkspaceName('My Ranch LLC'), '');
  assert.equal(realWorkspaceName('  Main Ranch  '), '', 'surrounding whitespace is trimmed first');
  assert.equal(realWorkspaceName('Rocking R Ranch'), 'Rocking R Ranch');
  assert.equal(realWorkspaceName(''), '');
  // The caption the wizard builds from a filtered placeholder: no invented
  // prefix, honest unprefixed form.
  const text = buildShareText(
    'Bella',
    'SEAL-AB12-CD34-EF56',
    realWorkspaceName('My Ranch LLC') || realWorkspaceName('Main Ranch'),
  );
  assert.ok(!text.includes('My Ranch LLC') && !text.includes('Main Ranch'));
  assert.ok(text.startsWith('Bella: sale packet verified by XBAR'));
});

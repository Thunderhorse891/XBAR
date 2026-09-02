import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

/*
 * The packet's verifier, EXECUTED rather than read.
 *
 * Every other test of this script asserts on its text, and text assertions
 * cannot tell a guard that works from one that only looks like it does. The
 * defect these cover was a seal forgery: an altered packet pointing an
 * attachment at 'https://attacker.example/file,<the original base64>' had the
 * original suffix hashed, matched the seal, and was reported PASS while the
 * link fetched unsealed content from somewhere else.
 *
 * So this builds the smallest DOM the script touches, runs the real shipped
 * bytes through `new Function`, clicks the button, and reads the verdict the
 * buyer would see.
 */

const source = await readFile(new URL('../src/lib/packetVerifierScript.ts', import.meta.url), 'utf8');
// Anchored on the export, not on the first backtick: the header comments quote
// `script-src ...` and would otherwise start the slice inside prose.
const marker = 'export const PACKET_VERIFIER_SCRIPT = `';
const start = source.indexOf(marker);
assert.ok(start > -1, 'the verifier constant must be findable');
const script = source.slice(start + marker.length, source.lastIndexOf('`'));
assert.ok(script.includes('xbar-verify-btn'), 'the verifier script must be extractable from its module');

const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex');
const b64 = (text) => Buffer.from(text, 'utf8').toString('base64');

function element(attrs = {}) {
  const node = { _attrs: { ...attrs }, textContent: '' };
  node.getAttribute = (name) => (name in node._attrs ? node._attrs[name] : null);
  node.setAttribute = (name, value) => {
    node._attrs[name] = value;
  };
  return node;
}

/** Runs the real verifier over one packet and returns what the buyer is shown. */
async function verify({ payload, sealedDigest, links }) {
  const out = element({ 'data-digest': sealedDigest });
  const record = element();
  record.textContent = payload;
  const stamp = element();
  stamp.textContent = 'WATERMARK';

  let click;
  const btn = element();
  btn.addEventListener = (_event, handler) => {
    click = handler;
  };

  const document = {
    getElementById: (id) =>
      ({ 'xbar-verify-btn': btn, 'xbar-verify-out': out, 'xbar-credential-payload': record, 'xbar-watermark': stamp })[
        id
      ] ?? null,
    /*
     * Honours the selector, because the attack this file exists to catch is a
     * link the selector was NOT written to see. A stub that returns the same
     * list whatever it is asked cannot express that, and would have passed the
     * unmarked-link forgery exactly as the shipped verifier did.
     */
    querySelectorAll: (selector) =>
      selector === 'a' ? links : links.filter((link) => link.getAttribute('data-xbar-file') !== null),
  };

  // The script feature-detects through `window`, which is the browser it runs
  // in; Node has the same primitives on globalThis.
  const windowStub = { crypto: globalThis.crypto, TextEncoder };
  new Function('document', 'window', 'crypto', 'TextEncoder', 'atob', script)(
    document,
    windowStub,
    globalThis.crypto,
    TextEncoder,
    globalThis.atob,
  );

  assert.ok(click, 'the verifier must register a click handler');
  click();

  /*
   * Wait for the verdict, not for a fixed number of ticks. `crypto.subtle`
   * resolves off the main thread, so a tick count that is enough on an idle
   * machine is not enough under a full `npm test` run — which is exactly how
   * this first failed.
   */
  const deadline = Date.now() + 10_000;
  while (!out.getAttribute('data-state') && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.ok(out.getAttribute('data-state'), `the verifier never reported a verdict: ${out.textContent}`);
  return { state: out.getAttribute('data-state'), text: out.textContent };
}

/** A packet whose single attachment really is embedded, sealed correctly. */
function honestPacket(hrefFor) {
  const fileBytes = 'the real coggins';
  const base64 = b64(fileBytes);
  const credential = {
    watermark: 'WATERMARK',
    attachments: [{ id: 'file-1', fileName: 'coggins.pdf', digest: sha256Hex(Buffer.from(fileBytes, 'utf8')) }],
  };
  const payload = JSON.stringify(credential);
  return {
    payload,
    sealedDigest: sha256Hex(Buffer.from(payload, 'utf8')),
    links: [
      element({
        'data-xbar-file': 'file-1',
        download: 'coggins.pdf',
        href: hrefFor(base64),
      }),
    ],
  };
}

test('an untouched packet still verifies', async () => {
  // The over-correction guard, and it comes first: a verifier that fails
  // everything is useless, and this is the shape every real packet has.
  const result = await verify(honestPacket((base64) => `data:application/pdf;base64,${base64}`));
  assert.equal(result.state, 'pass', result.text);
  assert.match(result.text, /matches the seal/);
});

test('an attachment relinked to a remote URL is reported ALTERED, not passed', async () => {
  /*
   * The attack. The link keeps the original base64 as a suffix so the old
   * "everything after the first comma" slice hashes bytes that match the seal,
   * while the href itself points at an attacker.
   */
  const result = await verify(honestPacket((base64) => `https://attacker.example/file,${base64}`));
  assert.equal(result.state, 'fail', `expected ALTERED, got: ${result.text}`);
  assert.match(result.text, /ALTERED/);
  assert.match(result.text, /not embedded in this packet/);
});

test('other non-data schemes carrying the sealed bytes are refused too', async () => {
  for (const href of [
    'http://attacker.example/f,BYTES',
    '//attacker.example/f,BYTES',
    '/local/path,BYTES',
    'javascript:void,BYTES',
    'DATA_LOOKALIKE:x;base64,BYTES',
  ]) {
    const result = await verify(honestPacket((base64) => href.replace('BYTES', base64)));
    assert.equal(result.state, 'fail', `${href} must not verify: ${result.text}`);
    assert.match(result.text, /not embedded in this packet/);
  }
});

test('a data URL whose bytes were swapped is still caught by the digest', async () => {
  // The original defence must keep working: a genuinely embedded but different
  // file fails on the hash rather than on the scheme check.
  const packet = honestPacket(() => `data:application/pdf;base64,${b64('a forged coggins')}`);
  const result = await verify(packet);
  assert.equal(result.state, 'fail');
  assert.match(result.text, /is not the one that was sealed/);
});

test('undecodable base64 in a data URL is refused rather than throwing', async () => {
  const packet = honestPacket(() => 'data:application/pdf;base64,@@@not base64@@@');
  const result = await verify(packet);
  assert.equal(result.state, 'fail');
  assert.match(result.text, /not embedded in this packet|Could not finish/);
});

test('a link the packet never sealed is reported ALTERED, however innocent it looks', async () => {
  /*
   * The complement to the relinked-attachment attack, and it needs no
   * cleverness at all: leave every sealed link exactly as it is, and APPEND
   * one. The verifier selected `a[data-xbar-file]`, and that attribute is
   * ordinary HTML the alterer controls — so an added link simply was not
   * looked at. Every sealed digest still matched, nothing was missing, and the
   * verdict was PASS while the buyer clicked content the seal had never seen.
   *
   * An attacker who has to mark their own forgery to have it checked will not.
   */
  const packet = honestPacket((base64) => `data:application/pdf;base64,${base64}`);
  const planted = element({ href: 'https://attacker.example/coggins-2026.pdf', download: 'coggins-2026.pdf' });
  planted.textContent = 'Coggins 2026 (updated)';
  packet.links.push(planted);

  const result = await verify(packet);
  assert.equal(result.state, 'fail', result.text);
  assert.match(result.text, /Coggins 2026 \(updated\)/, 'the buyer must be told which link to distrust');
  assert.match(result.text, /not part of the sealed record/);
});

test('an unnamed planted link is still reported, identified by its target', async () => {
  // Same attack with no link text to quote. Reporting "a link" and nothing
  // else would tell the buyer there is a problem and not which one it is.
  const packet = honestPacket((base64) => `data:application/pdf;base64,${base64}`);
  packet.links.push(element({ href: 'https://attacker.example/quiet.pdf' }));

  const result = await verify(packet);
  assert.equal(result.state, 'fail', result.text);
  assert.match(result.text, /attacker\.example\/quiet\.pdf/);
});

test('the sealed links are still checked on their own terms', async () => {
  /*
   * The over-rejection direction for this change. Sweeping every anchor must
   * not turn the marked links into unmarked ones: an honest packet has to keep
   * passing (covered above), and a marked link whose bytes were swapped must
   * still fail on the DIGEST rather than being lumped in as "not sealed" —
   * otherwise the message sends a buyer looking for the wrong thing.
   */
  const packet = honestPacket(() => `data:application/pdf;base64,${b64('a different file entirely')}`);
  const result = await verify(packet);

  assert.equal(result.state, 'fail', result.text);
  assert.match(result.text, /is not the one that was sealed/);
  assert.doesNotMatch(result.text, /not part of the sealed record/);
});

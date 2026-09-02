import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PACKET_VERIFIER_SCRIPT } from '../src/lib/packetVerifierScript.js';

/*
 * The packet's verify button was inert on the deployed site.
 *
 * A packet opened from the on-device vault is a blob document created by the
 * XBAR page, so it inherits the page's CSP — and that policy is
 * `script-src 'self' 'wasm-unsafe-eval' blob:`, with no `unsafe-inline` and no
 * nonce. The inline verifier was blocked. Nothing threw where a user could see
 * it; the button simply did nothing, which is the failure mode a security fix
 * can least afford, since the whole point was to let a buyer check a packet.
 *
 * Serving the script externally was not available: the packet is emailed,
 * carried on a USB stick, and opened from `file://`, where there is nothing to
 * fetch. So it stays inline and its exact hash is allowlisted.
 *
 * A hash covers exact bytes, which makes it exactly the kind of thing that
 * rots. These tests recompute it from the script the packet actually ships and
 * fail with the value to paste.
 */

test('the verifier the packet ships actually parses', () => {
  /*
   * Every other test here reads the script as TEXT, and text assertions cannot
   * tell a working script from a broken one. A stray brace once shipped a
   * verifier that threw `SyntaxError` before its first statement — the button
   * did nothing, the seal went unchecked, and the whole suite stayed green.
   *
   * `new Function` compiles without executing, which is the question being
   * asked: does this parse.
   */
  assert.doesNotThrow(() => new Function(PACKET_VERIFIER_SCRIPT), 'the packet would ship a script that cannot run');
});

function cspHash(script: string) {
  return `sha256-${createHash('sha256').update(script, 'utf8').digest('base64')}`;
}

async function scriptSrc() {
  const csp = JSON.parse(await readFile('vercel.json', 'utf8')).headers[0].headers.find(
    (header: { key: string }) => header.key === 'Content-Security-Policy',
  ).value as string;
  return csp.split(';').find((directive: string) => directive.trim().startsWith('script-src'))!;
}

test('the deployed CSP allows the exact verifier the packet ships', async () => {
  const expected = cspHash(PACKET_VERIFIER_SCRIPT);
  const directive = await scriptSrc();

  assert.ok(
    directive.includes(`'${expected}'`),
    `script-src does not allow the current verifier. Add '${expected}' to the script-src directive in vercel.json (it is${directive}).`,
  );
});

test('allowlisting the verifier did not weaken the policy', async () => {
  const directive = await scriptSrc();

  // A hash source ADDS permission for one inline script. It must not have been
  // paid for by loosening anything else — an `unsafe-inline` here would allow
  // every injected script in the app, which is a far worse trade than a dead
  // button.
  assert.ok(!directive.includes("'unsafe-inline'"), 'inline scripts must not be blanket-allowed');
  assert.ok(!directive.includes("'strict-dynamic'"), 'strict-dynamic would disable the self allowance');
  assert.ok(directive.includes("'self'"), "the app's own bundles must still load");
});

test('the verifier carries no escape sequences the template literal would eat', () => {
  /*
   * The script is emitted inside a template literal, so a `\n` written in the
   * source becomes a REAL newline in the emitted string — a syntax error inside
   * a JavaScript string literal in the packet, and a different hash besides.
   * The script uses String.fromCharCode(10) instead, and this keeps it that
   * way.
   */
  assert.ok(!PACKET_VERIFIER_SCRIPT.includes('\n  var NL = "'), 'newlines must come from String.fromCharCode');
  assert.match(PACKET_VERIFIER_SCRIPT, /String\.fromCharCode\(10\)/);
  assert.ok(!PACKET_VERIFIER_SCRIPT.includes('`'), 'a backtick would terminate the template literal early');
  assert.ok(!PACKET_VERIFIER_SCRIPT.includes('${'), 'an interpolation would be evaluated at generation time');
});

test('the packet still embeds the verifier inline', async () => {
  const generator = await readFile('src/lib/localSalePacketGenerator.ts', 'utf8');

  // Inline is the requirement, not an accident: an external script cannot be
  // fetched from a packet opened off a USB stick. The hash is what makes inline
  // work on the deployed site.
  assert.match(generator, /<script>\$\{PACKET_VERIFIER_SCRIPT\}<\/script>/);
});

test('the readout is the whole sealed record, not a chosen subset', () => {
  /*
   * The curated version printed nine facts. So an attacker could edit the
   * displayed breed, colour, owner entity, compliance deadline, a release
   * blocker or a document title, leave the payload untouched, and the digest
   * still matched — while none of those edits appeared in the readout. The
   * check reported `pass` over a page that lied.
   *
   * Walking the payload means the readout IS the sealed record. A field added
   * to the credential next year shows up without anyone remembering to add it,
   * which is exactly the drift a hand-picked list guarantees.
   */
  assert.match(PACKET_VERIFIER_SCRIPT, /describe\(notes, parsed, ' {2}'\);/, 'the whole payload must be walked');
  assert.match(PACKET_VERIFIER_SCRIPT, /function describe\(out, value, indent, key\)/);

  // Arrays and nested objects are part of the sealed record too: documents,
  // attachments, pending documents, blockers and warnings all live in them.
  assert.match(PACKET_VERIFIER_SCRIPT, /Array\.isArray\(value\)/, 'lists must be rendered, not skipped');
  assert.match(PACKET_VERIFIER_SCRIPT, /typeof value === 'object'/, 'nested sections must be rendered');

  // The hand-picked reads are gone rather than merely supplemented.
  for (const curated of ['parsed.identity.microchipId', 'parsed.ownership.transferStatus', 'parsed.care.status']) {
    assert.ok(!PACKET_VERIFIER_SCRIPT.includes(curated), `${curated} was a curated read and must be gone`);
  }
});

/*
 * Sealing the stylesheet.
 *
 * Every other sweep in the verifier asks whether the sealed CONTENT changed.
 * None asked whether the packet can still show the answer honestly, and CSS
 * alone is enough to lie about it: hide the output element, draw a PASS with a
 * pseudo-element, and an altered packet reads as verified while the script
 * runs correctly and reports ALTERED into an invisible box. A style element is
 * not an embedded resource and does not raise the script count, so neither of
 * those sweeps sees it — added or edited in place.
 */
test('the digest pinned in the verifier is the stylesheet the generator emits', async () => {
  const generator = await readFile('src/lib/localSalePacketGenerator.ts', 'utf8');
  const declared = /export const PACKET_STYLESHEET = `([\s\S]*?)`;/.exec(generator);
  assert.ok(declared, 'the stylesheet must be a single constant the verifier can pin');

  const digest = createHash('sha256').update(declared[1], 'utf8').digest('hex');
  assert.ok(
    PACKET_VERIFIER_SCRIPT.includes(`var STYLE_SHA256 = '${digest}';`),
    `the verifier pins a stale stylesheet digest. Set STYLE_SHA256 in src/lib/packetVerifierScript.ts to '${digest}'.`,
  );
});

test('the stylesheet is the same bytes in every packet', async () => {
  const generator = await readFile('src/lib/localSalePacketGenerator.ts', 'utf8');
  const declared = /export const PACKET_STYLESHEET = `([\s\S]*?)`;/.exec(generator);
  assert.ok(declared, 'the stylesheet constant must be findable');

  /*
   * It used to interpolate the watermark font size, which made the CSS
   * per-packet and so unsealable by a fixed digest. The two sizes are two
   * classes now. Anything interpolated back in silently un-seals it.
   */
  assert.ok(!declared[1].includes('${'), 'a per-packet stylesheet cannot be pinned by digest');

  // And the packet must carry exactly one, with no element styling itself —
  // which is what makes the verifier's count rule a fact about this format
  // rather than a guess.
  const html = generator.slice(generator.indexOf('const html = `'));
  assert.equal(html.split('<style>').length - 1, 1, 'a sealed packet has exactly one stylesheet');
  assert.match(html, /<style>\$\{PACKET_STYLESHEET\}<\/style>/, 'and it is the pinned one');
  assert.ok(!/ style="/.test(html), 'no element may carry its own style attribute');
});

test('the presentation sweep runs before the crypto gate', () => {
  /*
   * A file opened from disk often has no `crypto.subtle`, and that path returns
   * early — into the same output box an added stylesheet can hide. Counting
   * stylesheets needs no crypto, so it must happen first or it never happens
   * where the attack is easiest.
   */
  const sweepAt = PACKET_VERIFIER_SCRIPT.indexOf('var presentation = armingProblems().concat(presentationProblems());');
  const cryptoAt = PACKET_VERIFIER_SCRIPT.indexOf('if (!window.crypto || !crypto.subtle');
  assert.ok(sweepAt > -1, 'the presentation sweep must run on click');
  assert.ok(cryptoAt > sweepAt, 'and it must run before the crypto gate returns');
});

test('the ancestry the verifier pins is the one the generator emits', async () => {
  /*
   * Derived, not transcribed. The verifier refuses to print a verdict unless
   * the result box sits where the seal put it, which is what stops an altered
   * packet pointing the box at the sealed `watermark` rule — six percent
   * alpha, rotated, behind the content, and a perfectly ordinary rectangle. A
   * hand-copied chain would rot the first time the packet's markup moved, and
   * rot silently: every honest packet would start failing, or the pin would
   * quietly stop matching anything.
   */
  const generator = await readFile('src/lib/localSalePacketGenerator.ts', 'utf8');
  const html = generator.slice(generator.indexOf('const html = `'));
  const target = html.indexOf('id="xbar-verify-out"');
  assert.ok(target > -1, 'the result box must be findable in the generator');

  // Walk the markup before the box, tracking which elements are still open.
  const open: [string, string][] = [];
  const tag = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g;
  const voids = new Set(['meta', 'br', 'hr', 'img', 'input', 'link', 'source', 'track']);
  let match: RegExpExecArray | null;
  while ((match = tag.exec(html)) && match.index < target) {
    const [, closing, name, attrs] = match;
    if (closing) {
      for (let i = open.length - 1; i >= 0; i -= 1) {
        if (open[i]![0] === name.toUpperCase()) {
          open.splice(i, 1);
          break;
        }
      }
      continue;
    }
    if (voids.has(name.toLowerCase()) || attrs.trim().endsWith('/')) continue;
    open.push([name.toUpperCase(), /class="([^"]*)"/.exec(attrs)?.[1] ?? '']);
  }

  /*
   * `target` sits inside the box's own opening tag, so the box is already the
   * innermost element still open. Reversing gives exactly the order the
   * verifier walks: the box, then outward.
   */
  assert.equal(open.at(-1)?.[1], 'verify__out', 'the innermost open element must be the result box itself');
  const chain = open
    .slice()
    .reverse()
    .slice(0, 5)
    .map(([name, cls]) => `['${name}', '${cls}']`)
    .join(',\n    ');

  assert.ok(
    PACKET_VERIFIER_SCRIPT.includes(`var SEALED_OUT_CHAIN = [\n    ${chain},\n  ];`),
    `the verifier pins a stale ancestry. Set SEALED_OUT_CHAIN in src/lib/packetVerifierScript.ts to:\n  var SEALED_OUT_CHAIN = [\n    ${chain},\n  ];`,
  );
});

test('the packet carries no inline event handlers for the verifier to trip on', async () => {
  /*
   * The verifier refuses to arm if it finds one, which only works as a rule
   * because the generator emits none. An inline handler on the verify button
   * runs before this script reaches the end of the body and can silence it
   * outright with `stopImmediatePropagation`, so a handler added here would
   * both break every honest packet and, worse, make the rule look wrong rather
   * than the markup.
   */
  const generator = await readFile('src/lib/localSalePacketGenerator.ts', 'utf8');
  const html = generator.slice(generator.indexOf('const html = `'));
  assert.ok(!/\son[a-z]+\s*=/i.test(html), 'a sealed packet must bind no handler through markup');
  assert.match(PACKET_VERIFIER_SCRIPT, /function armingProblems\(\)/, 'and the check must run at arming time');

  /*
   * Arming, not clicking. A check inside the click handler cannot catch what
   * stops the click handler running, which is the whole of this attack.
   */
  const armAt = PACKET_VERIFIER_SCRIPT.indexOf('var arming = armingProblems();');
  // lastIndexOf: the missing-element guard registers an earlier listener of
  // its own, and matching that one would assert nothing about this order.
  const listenAt = PACKET_VERIFIER_SCRIPT.lastIndexOf("btn.addEventListener('click'");
  assert.ok(armAt > -1 && listenAt > armAt, 'the sweep must happen before the listener is even registered');
});

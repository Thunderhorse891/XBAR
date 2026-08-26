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

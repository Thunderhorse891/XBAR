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

/*
 * The packet's real stylesheet, read from the generator rather than retyped.
 *
 * The verifier pins its digest, so a copy that drifts by one byte would make
 * every test here fail for the wrong reason — and, worse, a test fixture with
 * its own CSS could not tell a sealed stylesheet from an altered one.
 */
const generatorSource = await readFile(new URL('../src/lib/localSalePacketGenerator.ts', import.meta.url), 'utf8');
const PACKET_STYLESHEET = /export const PACKET_STYLESHEET = `([\s\S]*?)`;/.exec(generatorSource)?.[1];
assert.ok(PACKET_STYLESHEET, 'the packet stylesheet must be extractable from the generator');

const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex');
const b64 = (text) => Buffer.from(text, 'utf8').toString('base64');

function element(attrs = {}, tagName = 'A') {
  const node = { _attrs: { ...attrs }, textContent: '', tagName, parentElement: null };
  node.getAttribute = (name) => (name in node._attrs ? node._attrs[name] : null);
  node.setAttribute = (name, value) => {
    node._attrs[name] = value;
  };
  /*
   * Laid out unless something collapses it. The verifier measures its own
   * output box, which is the rule that does not depend on naming a hiding
   * mechanism — a stub that always reported a size could not express it.
   */
  node.getBoundingClientRect = () => (node._collapsed ? { width: 0, height: 0 } : { width: 320, height: 24 });
  return node;
}

/** Runs the real verifier over one packet and returns what the buyer is shown. */
async function verify({
  payload,
  sealedDigest,
  links,
  extras = [],
  stylesheets,
  inlineStyled = [],
  noSubtleCrypto = false,
  outAttrs = {},
  outCollapsed = false,
  outAncestors = [],
  decoyOutputs = 0,
  omitOut = false,
}) {
  const out = element({ 'data-digest': sealedDigest, ...outAttrs }, 'DIV');
  out._collapsed = outCollapsed;
  // Hiding an ANCESTOR is the same attack one level up, and the verifier walks
  // the chain rather than checking the box alone.
  let ancestorTail = out;
  for (const ancestor of outAncestors) {
    ancestorTail.parentElement = ancestor;
    ancestorTail = ancestor;
  }
  const record = element();
  record.textContent = payload;
  const stamp = element();
  stamp.textContent = 'WATERMARK';

  let click;
  const btn = element();
  btn.addEventListener = (_event, handler) => {
    click = handler;
  };

  // The packet always contains the verifier's own script tag. Without it here,
  // every honest packet would trip the "exactly one script" rule — the stub has
  // to model the page as it actually ships.
  const ownScript = element({}, 'SCRIPT');
  /*
   * And its single stylesheet, whose bytes the verifier pins by digest. A stub
   * with no style element would report "0 stylesheets" for every packet,
   * turning the honest case into a failure and hiding the two alterations this
   * rule exists to catch.
   */
  const sheets = (stylesheets ?? [PACKET_STYLESHEET]).map((css) => {
    const node = element({}, 'STYLE');
    node.textContent = css;
    return node;
  });
  extras = [ownScript, ...sheets, ...extras];

  const alerts = [];

  const document = {
    getElementById: (id) =>
      ({
        'xbar-verify-btn': btn,
        'xbar-verify-out': omitOut ? undefined : out,
        'xbar-credential-payload': record,
        'xbar-watermark': stamp,
      })[id] ?? null,
    /*
     * Honours the selector, because the attacks this file exists to catch are
     * exactly the things a selector was NOT written to see: a link without the
     * marker attribute, and an element that is not a link at all. A stub that
     * returns the same list whatever it is asked cannot express either, and
     * would have passed both forgeries exactly as the shipped verifier did.
     */
    querySelectorAll: (selector) => {
      const wanted = selector.split(',').map((part) => part.trim().toUpperCase());
      if (selector === 'a[data-xbar-file]') {
        return links.filter((link) => link.getAttribute('data-xbar-file') !== null);
      }
      /*
       * An attribute selector is not a tag name. Falling through to the
       * tag-name branch would match nothing for '[style]', so every element
       * styling itself would pass — the stub reading exactly like coverage
       * while covering nothing.
       */
      /*
       * An id selector is not a tag name either. Falling through would report
       * zero elements claiming to be the result box, so a decoy that steals
       * the verdict would read as a packet having no result box at all.
       */
      if (selector === '#xbar-verify-out') {
        return omitOut ? [] : [out, ...Array.from({ length: decoyOutputs }, () => element({}, 'DIV'))];
      }
      if (selector === '[style]') {
        return [...links, ...extras, ...inlineStyled].filter((node) => node.getAttribute('style') !== null);
      }
      return [...links, ...extras, ...inlineStyled].filter((node) => wanted.includes(node.tagName));
    },
  };

  // The script feature-detects through `window`, which is the browser it runs
  // in; Node has the same primitives on globalThis.
  const windowStub = {
    crypto: noSubtleCrypto ? undefined : globalThis.crypto,
    TextEncoder,
    alert: (text) => alerts.push(text),
  };
  new Function('document', 'window', 'crypto', 'TextEncoder', 'atob', script)(
    document,
    windowStub,
    globalThis.crypto,
    TextEncoder,
    globalThis.atob,
  );

  assert.ok(click, 'the verifier must register a click handler');
  click();

  // A packet with no result box has nowhere to print, so the dialog is the
  // whole verdict and there is no data-state to wait for.
  if (omitOut) return { state: null, text: '', alerts };

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
  return { state: out.getAttribute('data-state'), text: out.textContent, alerts };
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

test('an added image is reported ALTERED, even though nothing was clicked', async () => {
  /*
   * A link at least requires the buyer to click it. An `img` or `iframe` SHOWS
   * unsealed content on sight, and the anchor sweep never looked at one. This
   * matters most exactly where the packet is most likely to be read — a file
   * opened from disk, where the deployment's CSP does not apply at all.
   */
  const packet = honestPacket((base64) => `data:application/pdf;base64,${base64}`);
  packet.extras = [element({ src: 'https://attacker.example/fake-coggins.png' }, 'IMG')];

  const result = await verify(packet);
  assert.equal(result.state, 'fail', result.text);
  assert.match(result.text, /added img element/);
  assert.match(result.text, /attacker\.example\/fake-coggins\.png/);
});

test('an added iframe is reported too, by the same rule', async () => {
  const packet = honestPacket((base64) => `data:application/pdf;base64,${base64}`);
  packet.extras = [element({ src: 'https://attacker.example/vet-record' }, 'IFRAME')];

  const result = await verify(packet);
  assert.equal(result.state, 'fail', result.text);
  assert.match(result.text, /added iframe element/);
});

test('a second script is reported, because it could rewrite this verdict', async () => {
  /*
   * The checker cannot prove its own innocence — the packet says so in its
   * by-hand instructions. It can still say what it sees, and a packet carrying
   * more than the one script it ships with is not the packet that was sealed.
   */
  const packet = honestPacket((base64) => `data:application/pdf;base64,${base64}`);
  packet.extras = [element({}, 'SCRIPT')];

  const result = await verify(packet);
  assert.equal(result.state, 'fail', result.text);
  assert.match(result.text, /contains 2 scripts/);
});

test('an honest packet embeds nothing, so the sweep must stay silent on it', async () => {
  /*
   * The over-rejection direction, and the one that would destroy the feature:
   * a verifier that calls every real packet altered teaches buyers to ignore
   * it. An honest packet has exactly one script and no embedded resources at
   * all — asserted here against the same script the generator ships.
   */
  const result = await verify(honestPacket((base64) => `data:application/pdf;base64,${base64}`));
  assert.equal(result.state, 'pass', result.text);
  assert.doesNotMatch(result.text, /added .* element/);
  assert.doesNotMatch(result.text, /scripts/);
});

test('the generator really does embed nothing, which is what makes the rule safe', async () => {
  /*
   * The rule "any embedded resource is an alteration" is a fact about this
   * format, not a guess — but only while it stays true. If the packet template
   * ever grows a logo or an inline SVG, every real packet starts reporting
   * ALTERED, so this fails first and points here.
   */
  const generator = await readFile('src/lib/localSalePacketGenerator.ts', 'utf8');
  const template = generator.slice(
    generator.indexOf('const html = `'),
    generator.indexOf('`;', generator.indexOf('const html = `')),
  );

  for (const tag of ['img', 'iframe', 'embed', 'object', 'video', 'audio', 'source', 'link', 'svg', 'form']) {
    assert.doesNotMatch(
      template,
      new RegExp(`<${tag}\\b`),
      `the packet template now emits <${tag}>, so the verifier's embedded-resource rule must be revisited`,
    );
  }
  assert.equal(
    (template.match(/<script\b/g) ?? []).length,
    1,
    'the packet ships exactly one script, which is what the count rule relies on',
  );
});

/*
 * Forging the VERDICT rather than the content.
 *
 * Every attack above alters what the seal covers. This one leaves the payload
 * and the attachments exactly as sealed — so the verifier genuinely reaches
 * its pass branch — and changes only how the answer is displayed: hide
 * `#xbar-verify-out`, draw a PASS with a pseudo-element. A style element is
 * not an embedded resource and does not raise the script count, so before this
 * neither sweep saw it, added or edited in place.
 */
const FORGERY = '#xbar-verify-out{display:none}.verify::after{content:"PASS"}';

test('a stylesheet added to the packet is caught', async () => {
  const result = await verify({
    ...honestPacket((base64) => `data:application/pdf;base64,${base64}`),
    stylesheets: [PACKET_STYLESHEET, FORGERY],
  });
  assert.equal(result.state, 'fail', result.text);
  assert.match(result.text, /2 stylesheets/);
  assert.equal(result.alerts.length, 1, 'and it must be said out loud, since the page decides what is visible');
  assert.match(result.alerts[0], /controls how this check is displayed/);
});

test('the packet stylesheet edited in place is caught', async () => {
  /*
   * The count stays at one and every other sweep is satisfied, which is why
   * counting alone was not enough: the digest is what sees this.
   */
  const result = await verify({
    ...honestPacket((base64) => `data:application/pdf;base64,${base64}`),
    stylesheets: [PACKET_STYLESHEET + FORGERY],
  });
  assert.equal(result.state, 'fail', result.text);
  assert.match(result.text, /stylesheet in this packet is not the one that was sealed/);
  assert.equal(result.alerts.length, 1, 'and said out loud');
});

test('an element styling itself is caught', async () => {
  const hidden = element({ style: 'display:none' }, 'DIV');
  const result = await verify({
    ...honestPacket((base64) => `data:application/pdf;base64,${base64}`),
    inlineStyled: [hidden],
  });
  assert.equal(result.state, 'fail', result.text);
  assert.match(result.text, /carrying a style attribute/);
  assert.equal(result.alerts.length, 1, 'and said out loud');
});

test('an added stylesheet is caught in the browser that cannot hash', async () => {
  /*
   * The case the attack is easiest in. A packet opened from disk often has no
   * `crypto.subtle`, and that path returns early — into the very box an added
   * stylesheet hides. Counting stylesheets needs no crypto, so it has to
   * happen before that gate rather than after it.
   */
  const result = await verify({
    ...honestPacket((base64) => `data:application/pdf;base64,${base64}`),
    stylesheets: [PACKET_STYLESHEET, FORGERY],
    noSubtleCrypto: true,
  });
  assert.equal(result.state, 'fail', result.text);
  assert.match(result.text, /2 stylesheets/);
  assert.equal(result.alerts.length, 1, 'the dialog is the only channel left here');
});

test('an untouched packet is not accused of styling itself', async () => {
  // The over-correction guard for all four above. A verifier that alerts on
  // every honest packet trains the buyer to click through the one that matters.
  const result = await verify(honestPacket((base64) => `data:application/pdf;base64,${base64}`));
  assert.equal(result.state, 'pass', result.text);
  assert.deepEqual(result.alerts, [], 'an honest packet must raise no dialog');
});

/*
 * Hiding the VERDICT without touching the CSS.
 *
 * Sealing the stylesheet closed one route and only one. The native `hidden`
 * attribute hides an element with no CSS, no extra script and no embedded
 * resource, so an altered packet could mark the result box hidden, append an
 * ordinary element reading PASS, and let the verifier write its real ALTERED
 * where nobody would look. A duplicate id does it from the other end.
 */
const honest = () => honestPacket((base64) => `data:application/pdf;base64,${base64}`);

test('a result box marked hidden is caught with no CSS involved', async () => {
  const result = await verify({ ...honest(), outAttrs: { hidden: '' } });
  assert.equal(result.state, 'fail', result.text);
  assert.match(result.text, /marked hidden/);
  assert.equal(result.alerts.length, 1, 'and it must be said out loud — the page decides what is visible');
});

test('hiding an ancestor of the result box is the same attack one level up', async () => {
  const wrapper = element({ hidden: '' }, 'DIV');
  const result = await verify({ ...honest(), outAncestors: [wrapper] });
  assert.equal(result.state, 'fail', result.text);
  assert.match(result.text, /marked hidden/);
  assert.equal(result.alerts.length, 1);
});

test('a result box collapsed into a closed section is caught', async () => {
  const collapsed = element({}, 'DETAILS');
  collapsed.open = false;
  const result = await verify({ ...honest(), outAncestors: [collapsed] });
  assert.equal(result.state, 'fail', result.text);
  assert.match(result.text, /collapsed section/);
});

test('a result box occupying no space is caught however it got that way', async () => {
  /*
   * The rule that does not name a mechanism, which is the mistake the
   * CSS-only sweep made. Whatever was done to it, a box with no area is
   * showing nobody anything.
   */
  const result = await verify({ ...honest(), outCollapsed: true });
  assert.equal(result.state, 'fail', result.text);
  assert.match(result.text, /takes up no space/);
  assert.equal(result.alerts.length, 1);
});

test('a decoy result box that steals the verdict is caught', async () => {
  // getElementById returns the first, so a duplicate id sends the real verdict
  // into a copy while the visible one keeps its forged text.
  const result = await verify({ ...honest(), decoyOutputs: 1 });
  assert.equal(result.state, 'fail', result.text);
  assert.match(result.text, /2 elements claiming to be the result box/);
  assert.equal(result.alerts.length, 1);
});

test('a packet with its result box removed does not fail silently', async () => {
  /*
   * The button used to do nothing at all — no verdict, no error — while a
   * forged PASS sat beside it unchallenged. That is the one failure mode a
   * verifier cannot afford.
   */
  const result = await verify({ ...honest(), omitOut: true });
  assert.equal(result.alerts.length, 1, 'the dialog is the only channel left');
  assert.match(result.alerts[0], /missing the part of itself that reports the result/);
});

test('an untouched packet is not accused of hiding its own verdict', async () => {
  // The over-correction guard for all six above.
  const result = await verify(honest());
  assert.equal(result.state, 'pass', result.text);
  assert.deepEqual(result.alerts, [], 'an honest packet must raise no dialog');
});

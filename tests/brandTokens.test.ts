import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

/*
 * The brand layer, checked by measurement rather than by eye.
 *
 * These exist because the app arrived at nine distinct blue hexes across four
 * unrelated families, none sharing a token, and the most-clicked control in the
 * product sat below the AA threshold in a blue that belonged to none of them.
 * A string check would not have caught that; a contrast calculation does.
 */

function relativeLuminance(hex: string): number {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255);
  const [r, g, b] = channels.map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const [high, low] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

/*
 * Declarations only. These guards are about what defines a colour, and a
 * comment defines nothing -- the comment on the primary button deliberately
 * names the hexes it replaced, which is worth keeping and must not trip a rule
 * about raw hexes in code.
 */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function tokenValue(css: string, name: string): string {
  const match = css.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  assert.ok(match, `${name} must be defined as a hex value`);
  return match![1];
}

test('the ink roles carry white text at AA, and the edge role is never asked to', async () => {
  const tokens = await readFile('src/styles/brandTokens.css', 'utf8');

  /*
   * Every ink role is a button ground or link colour with white on top, so 4.5:1
   * against white is the bar -- `.button` inherits body size at weight 700, which
   * is not large text.
   */
  for (const role of ['--accent-ink', '--accent-ink-lift', '--accent-ink-hover', '--accent-ink-press']) {
    const value = tokenValue(tokens, role);
    const ratio = contrastRatio('#ffffff', value);
    assert.ok(ratio >= 4.5, `${role} (${value}) is ${ratio.toFixed(2)}:1 against white, below AA for normal text`);
  }

  /*
   * The supplied brand blue stays exactly as supplied and is the EDGE colour:
   * rim lights, 1px borders, focus rings. It clears 3:1 against the working
   * ground, which is the bar for a non-text UI boundary, and does not clear
   * 4.5:1 -- which is precisely why the ink roles exist rather than one blue
   * doing both jobs.
   */
  const edge = tokenValue(tokens, '--xbar-blue');
  assert.equal(edge, '#0078d7', 'the supplied brand blue must not be tuned to fix a contrast problem');

  const ground = tokenValue(await readFile('src/index.css', 'utf8'), '--bg');
  const edgeRatio = contrastRatio(edge, ground);
  assert.ok(edgeRatio >= 3, `the edge role is ${edgeRatio.toFixed(2)}:1 on ${ground}, below the 3:1 UI boundary bar`);
  assert.ok(edgeRatio < 4.5, 'if the supplied blue ever clears AA for text, collapse the roles rather than keep two');
});

test('the primary button is built from roles, and the blue that failed AA is gone', async () => {
  const css = withoutComments(await readFile('src/index.css', 'utf8'));
  const primary = css.slice(css.indexOf('.button--primary {'), css.indexOf('.button--ghost {'));
  assert.ok(primary.length > 0, 'the primary button rule must be findable');

  assert.match(primary, /background: linear-gradient\(180deg, var\(--accent-ink-lift\) 0%, var\(--accent-ink\) 100%\)/);
  assert.ok(
    !/#[0-9a-fA-F]{6}/.test(primary.replace(/#ffffff/g, '')),
    'no raw hex may define the primary button colour',
  );

  // The retired family, which belonged to none of the brand palettes.
  for (const retired of ['#4880ff', '#2d6fff', '#5a8eff', '#3d7cff', '#1a57e8']) {
    assert.ok(!css.toLowerCase().includes(retired), `${retired} must not return to the global stylesheet`);
  }
});

test('the token file is actually loaded, and the cinematic tier honours reduced motion', async () => {
  /*
   * public/brand/xbar-brand-tokens.css held the same constants and governed
   * nothing: public/ is copied verbatim and is not in the build graph, so
   * nothing ever loaded it. A token file no one imports is worse than none --
   * it reads like the source of truth.
   */
  const entry = await readFile('src/main.tsx', 'utf8');
  assert.match(entry, /import '\.\/styles\/brandTokens\.css';/);

  const motion = await readFile('src/styles/motion.css', 'utf8');
  assert.match(motion, /--motion-cinematic:/);
  assert.match(motion, /--ease-cinematic:/);

  const guard = motion.slice(motion.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(guard, /\.motion-brand-in/, 'a brand animation is decoration, and must collapse under reduced motion');
});

test('sign-in brand images reserve their real shape and keep the rim light', async () => {
  /*
   * The `width`/`height` attributes are not decoration: they set the aspect
   * ratio the browser reserves BEFORE the bytes arrive. Declared 980x331 for a
   * 1122x912 file and 512x512 for a 1004x959 one, the reserved box was the
   * wrong shape and the panel reflowed as each image decoded.
   *
   * The dimensions asserted here are the files' own, read from the PNG headers
   * rather than copied from the markup, so re-exported artwork fails this
   * instead of silently reintroducing the shift.
   */
  const login = await readFile('src/routes/Login.tsx', 'utf8');

  for (const [file, className] of [['public/brand/xbar-report-horse.png', 'clean-login-visual__art']] as const) {
    const header = await readFile(file);
    assert.equal(header.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${file} must be a PNG`);
    const width = header.readUInt32BE(16);
    const height = header.readUInt32BE(20);

    const tag = login.slice(login.indexOf(className), login.indexOf(className) + 400);
    assert.match(tag, new RegExp(`width="${width}"`), `${className} must declare its real width (${width})`);
    assert.match(tag, new RegExp(`height="${height}"`), `${className} must declare its real height (${height})`);
  }

  /*
   * And the mark keeps its colour. Blue appears in the artwork only as a rim
   * light; desaturating it deletes the single feature that identifies the brand
   * at the one place it appears on this screen.
   */
  const entry = await readFile('src/routes/loginHero.css', 'utf8');
  const watermark = entry.slice(
    entry.indexOf('.clean-login-visual__art {'),
    entry.indexOf('.clean-login-visual .clean-login-visual__copy'),
  );
  assert.ok(watermark.length > 0, 'the watermark rule must be findable');
  assert.ok(!/grayscale\(/.test(watermark), 'the brand mark must not be desaturated on the sign-in panel');
});

test('public and application palettes share the owner-selected signature colors', async () => {
  const app = withoutComments(await readFile('src/styles/brandTokens.css', 'utf8'));
  const publicTokens = withoutComments(await readFile('public/brand/xbar-brand-tokens.css', 'utf8'));
  const expected = {
    '--xbar-black': '#0b0d0f',
    '--xbar-graphite': '#171b20',
    '--xbar-gunmetal': '#202d3c',
    '--xbar-steel': '#596168',
    '--xbar-silver': '#d6dde5',
    '--xbar-blue': '#0078d7',
    '--xbar-ice': '#94d8f2',
    '--xbar-white': '#ffffff',
  };
  for (const [token, color] of Object.entries(expected)) {
    assert.equal(tokenValue(app, token).toLowerCase(), color, `app ${token} must match the signature palette`);
    assert.equal(tokenValue(publicTokens, token).toLowerCase(), color, `public ${token} must match the app`);
  }
  const constants = (css: string) =>
    [...css.matchAll(/(--xbar-[\w-]+):\s*(#[\da-f]{6})/gi)]
      .map((match) => [match[1], match[2].toLowerCase()])
      .sort(([a], [b]) => a.localeCompare(b));
  assert.deepEqual(constants(publicTokens), constants(app), 'every duplicated brand constant must stay in parity');
  assert.equal(tokenValue(app, '--accent-ink'), expected['--xbar-gunmetal']);
  assert.equal(tokenValue(app, '--accent-ink-press'), expected['--xbar-graphite']);
  assert.ok(
    contrastRatio(expected['--xbar-steel'], expected['--xbar-white']) >= 4.5,
    'secondary text remains readable on white',
  );
  assert.ok(
    contrastRatio(expected['--xbar-ice'], expected['--xbar-white']) < 3,
    'pale ice is decorative, never a standalone focus boundary',
  );
  assert.match(app, /--accent-edge:\s*var\(--xbar-blue\)/, 'accessible focus edges must not become pale ice');
});

test('the signature derivative preserves every supplied source master byte for byte', async () => {
  const originals = {
    'xbar-horse-outline-safe.png': '66c6710e8ba1428923a60cae5f15101cfa4a4b0e489990c8f4f04fc9a7cb17ac',
    'xbar-report-horse.png': '8a8cc3c6215d2b2f45f260ff3d26848313391fab605799321f11eb9f8503eb54',
    'xbar-report-mark.png': '58e1fd7ed972f146311dda41806a8f9420a17c46452ccfabcb3143ac7d91ada8',
    'xbar-wordmark.png': '319e0ed1dce00354184955e4399887035a6e6b487e675ef0c5f9e0176dc79928',
    'apple-touch-icon.png': 'f442212afe2e48d591081cfd3860a0f601e85911626e579a74d8287cdbe238c1',
  };
  for (const [file, hash] of Object.entries(originals)) {
    assert.equal(
      createHash('sha256')
        .update(await readFile(`public/brand/${file}`))
        .digest('hex'),
      hash,
      `${file} is an unchanged supplied master`,
    );
  }
});

test('original metallic artwork is the only rendered XBAR logo, without a traced replacement', async () => {
  const component = await readFile('src/components/BrandMark.tsx', 'utf8');
  const publicLogo = await readFile('scripts/marketing/signature.mjs', 'utf8');
  assert.match(component, /import\.meta\.env\.BASE_URL/, 'compact artwork must respect the supported deployment base');
  for (const [name, source] of [
    ['application', component],
    ['public site', publicLogo],
  ]) {
    assert.match(source, /xbar-original-lockup-480\.png/, `${name} must render the selected original B artwork`);
    assert.match(source, /preserveAspectRatio=["']xMidYMid meet["']/, `${name} must contain the complete original`);
    assert.doesNotMatch(
      source,
      /compactPaths|geometry\.paths|<path\b|signatureMotion/,
      `${name} must not redraw the horse`,
    );
  }
  const email = await readFile('api/_lib/email.js', 'utf8');
  const sample = await readFile('scripts/marketing/sample-packet.mjs', 'utf8');
  const reports = await readFile('src/lib/reportBranding.ts', 'utf8');
  const manifest = await readFile('public/site.webmanifest', 'utf8');
  for (const [name, source] of [
    ['email', email],
    ['sample', sample],
    ['report', reports],
    ['manifest', manifest],
  ]) {
    assert.doesNotMatch(
      source,
      /xbar-signature-(?:horse|print|email|icon)/,
      `${name} must not publish the rejected silhouette`,
    );
  }
  assert.match(email, /xbar-original-lockup-480\.png/);
  assert.match(sample, /xbar-original-lockup-480\.png/);
  assert.match(manifest, /xbar-original-icon-512\.png/);
  const icon = await readFile('public/brand/xbar-original-icon-512.png');
  assert.equal(icon.readUInt32BE(16), 512);
  assert.equal(icon.readUInt32BE(20), 512);
});

// Run the shared controller against the browser boundary it consumes, without
// launching a browser. Scheduling and cancellation are measured on real code.
type SignatureAnimation = {
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
  cancelled: boolean;
  onfinish: (() => void) | null;
  cancel: () => void;
};

function signatureEvents() {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  return {
    addEventListener(name: string, listener: (event: unknown) => void) {
      const registered = listeners.get(name) ?? new Set();
      registered.add(listener);
      listeners.set(name, registered);
    },
    removeEventListener(name: string, listener: (event: unknown) => void) {
      listeners.get(name)?.delete(listener);
    },
    dispatch(name: string, event: unknown = {}) {
      listeners.get(name)?.forEach((listener) => listener(event));
    },
    listenerCount: () => [...listeners.values()].reduce((total, entries) => total + entries.size, 0),
  };
}

async function signatureHarness(
  options: {
    reduced?: boolean;
    saveData?: boolean;
    hidden?: boolean;
    paused?: boolean;
    finePointer?: boolean;
    geometryThrows?: boolean;
    lengths?: number[];
    animationSupported?: boolean;
  } = {},
) {
  const { installSignatureMotion, SIGNATURE_DURATION_MS } = await import('../src/lib/signatureMotion.js');
  const animations: SignatureAnimation[] = [];
  const reduced = { ...signatureEvents(), matches: options.reduced ?? false };
  const pointer = { ...signatureEvents(), matches: options.finePointer ?? true };
  const connection = { ...signatureEvents(), saveData: options.saveData ?? false };
  let scheduledFrame: FrameRequestCallback | undefined;
  const win = {
    ...signatureEvents(),
    navigator: { connection },
    matchMedia: (query: string) => (query.includes('prefers-reduced-motion') ? reduced : pointer),
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      scheduledFrame = callback;
      return 1;
    },
    cancelAnimationFrame: () => {
      scheduledFrame = undefined;
    },
  };
  const doc = { ...signatureEvents(), hidden: options.hidden ?? false, defaultView: win };
  const attributes = new Map<string, string>();
  const paths = (options.lengths ?? [10, 20, 30]).map((length) => ({
    getTotalLength: () => {
      if (options.geometryThrows) throw new Error('SVG geometry is unavailable');
      return length;
    },
    animate: (keyframes: Keyframe[], animationOptions: KeyframeAnimationOptions) => {
      const animation: SignatureAnimation = {
        keyframes,
        options: animationOptions,
        cancelled: false,
        onfinish: null,
        cancel() {
          this.cancelled = true;
        },
      };
      animations.push(animation);
      return animation;
    },
  }));
  const svg = {
    ...signatureEvents(),
    ownerDocument: doc,
    closest: () => null,
    ...(options.animationSupported === false ? {} : { animate() {} }),
    querySelectorAll: (selector: string) => (selector === '.xbar-signature__trace' ? paths : []),
    setAttribute: (name: string, value: string) => {
      attributes.set(name, value);
    },
    removeAttribute: (name: string) => {
      attributes.delete(name);
    },
  };
  let paused = options.paused ?? false;
  const controller = installSignatureMotion(svg as unknown as SVGSVGElement, () => paused);
  return {
    animations,
    attributes,
    controller,
    duration: SIGNATURE_DURATION_MS,
    enter: () => {
      const callback = scheduledFrame;
      scheduledFrame = undefined;
      callback?.(0);
    },
    hover: (pointerType = 'mouse') => svg.dispatch('pointerenter', { pointerType }),
    reduce: () => {
      reduced.matches = true;
      reduced.dispatch('change');
    },
    save: () => {
      connection.saveData = true;
      connection.dispatch('change');
    },
    hide: () => {
      doc.hidden = true;
      doc.dispatch('visibilitychange');
    },
    exit: () => win.dispatch('pagehide'),
    pause: () => {
      paused = true;
      controller.cancel();
    },
    listenerCount: () =>
      svg.listenerCount() +
      doc.listenerCount() +
      win.listenerCount() +
      reduced.listenerCount() +
      connection.listenerCount(),
  };
}

test('the signature traces actual paths sequentially for exactly 1500ms and then becomes static', async () => {
  const harness = await signatureHarness();
  assert.equal(harness.duration, 1500);
  harness.enter();
  assert.equal(harness.attributes.get('data-tracing'), 'true');
  assert.equal(harness.animations.length, 3);
  let end = 0;
  for (const [index, animation] of harness.animations.entries()) {
    assert.equal(animation.options.duration, [250, 500, 750][index], 'timing follows real path length');
    assert.equal(animation.options.delay, end, 'path traces are sequential, not simultaneous raster fades');
    assert.equal(animation.options.iterations ?? 1, 1, 'signature motion must never loop');
    assert.equal(animation.options.fill, 'backwards', 'the highlight must not hold its last frame');
    assert.equal(animation.keyframes[0].strokeDashoffset, '0.18');
    assert.equal(animation.keyframes.at(-1)?.strokeDashoffset, '-1');
    assert.equal(animation.keyframes.at(-1)?.opacity, 0, 'the trace disappears into the static base');
    assert.ok(
      animation.keyframes.every((frame) => !('transform' in frame)),
      'tracing does not pulse or scale the horse',
    );
    end += Number(animation.options.duration);
    animation.onfinish?.();
  }
  assert.equal(end, 1500);
  assert.equal(harness.attributes.has('data-tracing'), false);
  harness.enter();
  assert.equal(harness.animations.length, 3, 'entry runs once');
  harness.controller.dispose();
});

test('signature hover replay is limited to a fine mouse pointer and replaces rather than stacks traces', async () => {
  const harness = await signatureHarness();
  harness.enter();
  harness.hover('touch');
  harness.hover('pen');
  assert.equal(harness.animations.length, 3);
  harness.hover();
  assert.equal(harness.animations.length, 6);
  assert.ok(harness.animations.slice(0, 3).every((animation) => animation.cancelled));
  assert.equal(
    Math.max(
      ...harness.animations
        .slice(3)
        .map((animation) => Number(animation.options.delay) + Number(animation.options.duration)),
    ),
    1500,
  );
  harness.controller.dispose();
  const coarse = await signatureHarness({ finePointer: false });
  coarse.enter();
  coarse.hover();
  assert.equal(coarse.animations.length, 3, 'a coarse pointer never causes hover replay');
  coarse.controller.dispose();
});

test('signature preferences, page lifecycle, and pause cancel the highlight while retaining static recognition', async () => {
  for (const action of ['reduce', 'save', 'hide', 'exit', 'pause'] as const) {
    const harness = await signatureHarness();
    harness.enter();
    harness[action]();
    assert.ok(
      harness.animations.every((animation) => animation.cancelled),
      `${action}: all paths must stop`,
    );
    assert.equal(harness.attributes.has('data-tracing'), false);
    // Cancellation removes only its own tracing flag, never the static SVG.
    assert.deepEqual([...harness.attributes.keys()], []);
    harness.controller.dispose();
  }
  for (const options of [{ reduced: true }, { saveData: true }, { hidden: true }, { paused: true }]) {
    const harness = await signatureHarness(options);
    harness.enter();
    harness.hover();
    assert.equal(harness.animations.length, 0, 'disabled motion stays static from entry and hover');
    assert.equal(harness.attributes.has('data-tracing'), false);
    harness.controller.dispose();
  }
});

test('signature disposal and unsupported geometry leave a safe static fallback', async () => {
  const harness = await signatureHarness();
  assert.ok(harness.listenerCount() > 0);
  harness.controller.dispose();
  assert.equal(harness.listenerCount(), 0, 'unmount removes every lifecycle listener');
  harness.enter();
  harness.hover();
  assert.equal(harness.controller.play(), false);
  assert.equal(harness.animations.length, 0, 'an unmounted mark cannot resume');
  for (const options of [
    { geometryThrows: true },
    { lengths: [] },
    { lengths: [0] },
    { lengths: [Number.NaN] },
    { animationSupported: false },
  ]) {
    const fallback = await signatureHarness(options);
    fallback.enter();
    assert.equal(fallback.animations.length, 0);
    assert.equal(fallback.attributes.has('data-tracing'), false);
    fallback.controller.dispose();
  }
});

test('original artwork styling uses brand tokens and never recolours or retraces the horse', async () => {
  const css = withoutComments(await readFile('public/brand/xbar-signature.css', 'utf8'));
  assert.doesNotMatch(css, /filter:|mask-image:|stroke-dash|infinite|#[\da-f]{3,8}\b/i);
  assert.match(css, /aspect-ratio:\s*1672 \/ 941/);
  assert.match(css, /border: 1px solid var\(--xbar-silver\)/);
  const login = await readFile('src/routes/Login.tsx', 'utf8');
  const home = await readFile('scripts/marketing/home.mjs', 'utf8');
  assert.doesNotMatch(login, /XbarMark variant="hero"/);
  assert.doesNotMatch(home, /signatureSvg\(\{ hero: true/);
});

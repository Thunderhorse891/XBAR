import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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

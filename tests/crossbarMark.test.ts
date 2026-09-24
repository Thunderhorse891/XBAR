import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

// The Crossbar is specified by construction, not by eye: a solid X of two
// 45-degree bands 4 units thick with square terminals, a 4-unit gap, and a
// 4-unit bar exactly as wide as the X, on a 32-unit grid; the wordmark is
// outlines, 8 units to the right. These tests hold that construction, and
// keep the React component and the published files drawing the same thing.

type Point = [number, number];

async function constant(name: string): Promise<string> {
  const source = await readFile('src/components/BrandMark.tsx', 'utf8');
  const match = new RegExp(`export const ${name} =\\s*'([^']+)'`).exec(source);
  assert.ok(match, `${name} is exported from BrandMark.tsx`);
  return match[1]!;
}

// Straight-line subpaths only: M/L/H/V/Z, which is all the mark uses.
function polygons(d: string): Point[][] {
  const shapes: Point[][] = [];
  let current: Point[] = [];
  let x = 0;
  let y = 0;
  for (const [, command, args] of d.matchAll(/([MLHVZ])([^MLHVZ]*)/g)) {
    const n = args!.trim()
      ? args!
          .trim()
          .split(/[\s,]+/)
          .map(Number)
      : [];
    if (command === 'M') {
      current = [];
      shapes.push(current);
      [x, y] = n as Point;
    } else if (command === 'L') [x, y] = n as Point;
    else if (command === 'H') x = n[0]!;
    else if (command === 'V') y = n[0]!;
    else continue;
    current.push([x, y]);
  }
  return shapes;
}

const bounds = (points: Point[]) => ({
  minX: Math.min(...points.map(([px]) => px)),
  maxX: Math.max(...points.map(([px]) => px)),
  minY: Math.min(...points.map(([, py]) => py)),
  maxY: Math.max(...points.map(([, py]) => py)),
});

// Distance from a point to the infinite line through a and b.
function distance([px, py]: Point, [ax, ay]: Point, [bx, by]: Point) {
  return Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / Math.hypot(bx - ax, by - ay);
}

test('the mark is an X of 4-unit 45-degree bands above a 4-unit bar as wide as the X', async () => {
  const [x, bar] = polygons(await constant('CROSSBAR_MARK_PATH'));
  assert.ok(x && bar, 'two shapes: the X and the bar');
  assert.equal(x.length, 12, 'the X is one 12-sided solid');

  const xBox = bounds(x);
  const barBox = bounds(bar);
  assert.deepEqual([xBox.minX, xBox.maxX, xBox.minY, xBox.maxY], [4, 28, 0, 24], 'a 24-unit X centred on the grid');
  assert.deepEqual([barBox.minX, barBox.maxX], [xBox.minX, xBox.maxX], 'the bar spans the X exactly');
  assert.equal(barBox.maxY - barBox.minY, 4, 'a 4-unit bar');
  assert.equal(barBox.minY - xBox.maxY, 4, 'a 4-unit gap, detached');
  assert.equal(barBox.maxY, 32, 'on the 32-unit grid');

  // Band thickness: each long edge is 4 units from its parallel partner.
  const at = (i: number) => x[i % x.length]!;
  const close = (actual: number, expected: number, what: string) =>
    assert.ok(Math.abs(actual - expected) < 1e-3, `${what}: ${actual} ≠ ${expected}`);
  close(distance(at(1), at(0), at(11)), 4, 'band thickness');
  close(distance(at(4), at(3), at(2)), 4, 'band thickness');

  // Square terminals: each end is cut at right angles to its band, which runs at 45 degrees.
  for (const [a, b] of [
    [0, 1],
    [3, 4],
    [6, 7],
    [9, 10],
  ] as const) {
    const [dx, dy] = [at(b)[0] - at(a)[0], at(b)[1] - at(a)[1]];
    close(Math.abs(dx), Math.abs(dy), `terminal ${a}-${b} runs at 45 degrees`);
    close(Math.hypot(dx, dy), 4, `terminal ${a}-${b} is as wide as the band`);
  }
});

test('the lockup is the same mark, an 8-unit space, and a wordmark in outlines at the X height', async () => {
  const lockup = await constant('CROSSBAR_LOCKUP_PATH');
  const mark = await constant('CROSSBAR_MARK_PATH');
  const round = (value: number) => Math.round(value * 1e4) / 1e4;
  const shifted = polygons(mark).map((shape) => shape.map(([px, py]) => [round(px - 4), py] as Point));
  assert.deepEqual(polygons(lockup).slice(0, 2), shifted, 'the lockup opens with the mark, flush left');

  const wordmark = lockup.slice(lockup.indexOf('M32'));
  const coords = [...wordmark.matchAll(/-?\d+(\.\d+)?/g)].map((m) => Number(m[0]));
  const xs = coords.filter((_, i) => i % 2 === 0);
  const ys = coords.filter((_, i) => i % 2 === 1);
  assert.equal(Math.min(...xs), 32, 'the wordmark starts 8 units after the X (4-unit bands, 2 × band)');
  assert.deepEqual([Math.min(...ys), Math.max(...ys)], [0, 24], 'cap height matches the X, on its baseline');
});

test('the published files carry the same outlines, monochrome, with no live text', async () => {
  const mark = await constant('CROSSBAR_MARK_PATH');
  const lockup = await constant('CROSSBAR_LOCKUP_PATH');
  const file = (name: string) => readFile(`public/brand/crossbar/${name}`, 'utf8');
  const LIMESTONE = '#EEF0E8';
  const CARBON = '#0C0F0D';

  for (const [name, d, fill] of [
    ['xbar-crossbar-mark.svg', mark, LIMESTONE],
    ['xbar-crossbar-mark-reverse.svg', mark, CARBON],
    ['xbar-crossbar-lockup.svg', lockup, LIMESTONE],
    ['xbar-crossbar-lockup-reverse.svg', lockup, CARBON],
  ] as const) {
    const svg = await file(name);
    assert.ok(svg.includes(`fill="${fill}" d="${d}"`), `${name} draws the component's outline in ${fill}`);
    assert.doesNotMatch(svg, /<text|<image|base64/, `${name} is vector outlines, not text or a raster`);
    assert.doesNotMatch(svg.toUpperCase(), /#C2E86B/, `${name} carries no chartreuse: that is for interaction`);
  }
});

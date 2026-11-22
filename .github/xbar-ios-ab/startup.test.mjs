import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('./startup.js', import.meta.url), 'utf8');

test('records only redacted local phase information and bounds output', () => {
  const events = new Map();
  const records = [];
  const window = {
    addEventListener: (name, fn) => events.set(name, fn),
    setTimeout() {},
  };
  const document = {
    addEventListener: (name, fn) => events.set(name, fn),
    getElementById: () => ({ childNodes: ['synthetic'] }),
  };
  vm.runInNewContext(source, { window, document, console: { info: (message) => records.push(message) } });
  assert.match(records[0], /"phase":"html-script"/);
  events.get('error')({
    target: window,
    error: { name: 'TypeError', message: 'SENSITIVE-TEXT', stack: 'https://example.invalid/?token=SENSITIVE-URL' },
    filename: 'capacitor://localhost/assets/index-ab12.js',
    lineno: 10,
    colno: 2,
  });
  assert.match(records[1], /"asset":"index-ab12.js:10:2"/);
  events.get('DOMContentLoaded')();
  assert.match(records[3], /"phase":"root-populated"/);
  for (let index = 0; index < 30; index++) {
    events.get('unhandledrejection')({ reason: { name: 'private@example.invalid' } });
  }
  assert.equal(records.length, 12);
  assert.doesNotMatch(records.join('\n'), /SENSITIVE|example\.invalid/);
});

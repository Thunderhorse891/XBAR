import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
const code = readFileSync(new URL('./lifecycle.js', import.meta.url), 'utf8');
test('encodes independently observable lifecycle phases without exposing URLs', () => {
  for (const [setup, expected] of [
    [{ dom: true, root: true, module: true, entry: true, populated: true }, 'local-1-1-1-1-1-none'],
    [{ dom: true, root: true, module: true, issue: 'module' }, 'local-1-1-1-0-0-module'],
    [{ dom: true, root: true, module: true, entry: true, issue: 'script' }, 'local-1-1-1-1-0-script'],
    [{ about: true }, 'about-0-0-0-0-0-none'],
  ]) {
    const logs = [], handlers = {}, timers = [];
    const window = {
      webkit: { messageHandlers: { xbarBoot: { postMessage: (r) => logs.push(r) } } },
      addEventListener: (type, cb) => { handlers[type] = cb; },
      setTimeout: (cb, ms) => { assert.equal(ms, 30000); timers.push(cb); },
    };
    const document = {
      addEventListener: (type, cb) => { handlers[type] = cb; },
      getElementById: () => setup.root ? { childNodes: setup.populated ? [{}] : [] } : null,
      querySelectorAll: () => setup.module ? [{ src: 'capacitor://localhost/assets/entry.js?private=true' }] : [],
    };
    const location = setup.about ? { protocol: 'about:', hostname: '' } : { protocol: 'capacitor:', hostname: 'localhost' };
    runInNewContext(code, { window, document, location, URL });
    if (setup.dom) handlers.DOMContentLoaded();
    if (setup.entry) window.__xbarQaModuleEntered();
    if (setup.issue) handlers.error({ target: setup.issue === 'script' ? window : { nodeName: 'SCRIPT', type: 'module' } });
    timers[0](); timers[0]();
    assert.equal(logs.length, 1);
    assert.equal(logs[0].phase, 'lifecycle-summary');
    assert.equal(logs[0].kind, null);
    assert.equal(logs[0].asset, expected);
  }
});

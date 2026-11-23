(function () {
  'use strict';
  var send = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.xbarBoot;
  if (!send) return;
  var dom = false, entry = false, issue = 'none', emitted = false;
  window.__xbarQaModuleEntered = function () { entry = true; };
  document.addEventListener('DOMContentLoaded', function () { dom = true; }, { once: true });
  window.addEventListener('error', function (event) {
    if (event.target === window) { issue = 'script'; return; }
    var target = event.target;
    if (target && target.nodeName === 'SCRIPT' && target.type === 'module') issue = 'module';
    else if (target && target.nodeName === 'LINK' && target.rel === 'modulepreload') issue = 'module';
  }, true);
  window.addEventListener('unhandledrejection', function () { issue = 'rejection'; });
  function emit() {
    if (emitted) return;
    emitted = true;
    var origin = location.protocol === 'capacitor:' && location.hostname === 'localhost' ? 'local'
      : location.protocol === 'about:' ? 'about' : 'other';
    var root = document.getElementById('root');
    var moduleTag = Array.prototype.some.call(document.querySelectorAll('script[type="module"][src]'), function (script) {
      try {
        var src = new URL(script.src, document.baseURI);
        return src.protocol === location.protocol && src.hostname === location.hostname &&
          /^\/assets\/[A-Za-z0-9_-]+\.js$/.test(src.pathname);
      } catch (_error) { return false; }
    });
    send.postMessage({phase: 'lifecycle-summary', kind: null, asset:
      [origin, +dom, +Boolean(root), +moduleTag, +entry, +Boolean(root && root.childNodes.length), issue].join('-')});
  }
  window.setTimeout(emit, 30000);
}());

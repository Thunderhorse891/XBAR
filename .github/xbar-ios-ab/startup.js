/* Synthetic native CI only. Do not package this in a customer build. */
(function () {
  var emitted = 0;
  var errorNames = /^(?:Error|TypeError|SyntaxError|ReferenceError|RangeError|SecurityError|NetworkError|AbortError)$/;
  function locationHint(value) {
    // Bundle paths and numeric positions only. Never retain URLs, query,
    // fragments, message text, form fields, user data or raw stack.
    var match = String(value || '').match(/\/assets\/([a-zA-Z0-9_-]{1,96}\.(?:js|css))(?::(\d{1,7}):(\d{1,7}))?(?:$|[)\s?#])/);
    return match ? match[1] + (match[2] ? ':' + match[2] + ':' + match[3] : '') : null;
  }
  function note(phase, value, file) {
    if (emitted++ >= 12) return;
    var label = value && errorNames.test(value.name) ? value.name : null;
    var record = JSON.stringify({ phase: phase, kind: label, asset: locationHint(file) || locationHint(value && value.stack) });
    console.info('XBAR_BOOT ' + record);
  }
  note('html-script');
  window.addEventListener('error', function (event) {
    if (event.target === window) {
      note('script-error', event.error, event.filename && event.filename + ':' + event.lineno + ':' + event.colno);
    } else {
      var target = event.target;
      if (target && (target.nodeName === 'SCRIPT' || target.nodeName === 'LINK')) {
        note('resource-error', null, target.src || target.href);
      }
    }
  }, true);
  window.addEventListener('unhandledrejection', function (event) {
    note('unhandled-rejection', event.reason);
  });
  document.addEventListener('DOMContentLoaded', function () {
    note('dom-ready');
    var root = document.getElementById('root');
    if (!root) return note('root-missing');
    if (root.childNodes.length) return note('root-populated');
    var observer = new MutationObserver(function () {
      if (!root.childNodes.length) return;
      observer.disconnect();
      note('root-populated');
    });
    observer.observe(root, { childList: true });
    window.setTimeout(function () {
      if (!root.childNodes.length) note('root-still-empty');
      observer.disconnect();
    }, 15000);
  }, { once: true });
}());

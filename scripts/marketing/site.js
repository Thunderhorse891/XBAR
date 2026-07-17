// XBAR first-party analytics beacon (marketing pages only).
//
// The public site sets script-src 'self', so there is no third-party
// analytics script — this tiny beacon reports pageviews and the two CTA
// clicks that matter (sign-up and sample packet) to our own /api/metrics.
// Anonymous by design: no cookies, no identifiers, no cross-site anything,
// and it respects Do Not Track / Global Privacy Control.
/* global document, location */
(function () {
  'use strict';

  var nav = typeof navigator === 'undefined' ? null : navigator;
  if (!nav) return;
  if (nav.doNotTrack === '1' || nav.globalPrivacyControl === true) return;

  function send(event) {
    try {
      var payload = JSON.stringify(event);
      if (nav.sendBeacon && nav.sendBeacon('/api/metrics', new Blob([payload], { type: 'application/json' }))) {
        return;
      }
      fetch('/api/metrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
      }).catch(function () {});
    } catch {
      /* analytics must never break the page */
    }
  }

  function referrerHost() {
    try {
      if (!document.referrer) return null;
      var host = new URL(document.referrer).hostname;
      return host === location.hostname ? null : host;
    } catch {
      return null;
    }
  }

  send({ type: 'pageview', path: location.pathname, referrer: referrerHost() });

  document.addEventListener('click', function (evt) {
    var anchor = evt.target && evt.target.closest ? evt.target.closest('a[href]') : null;
    if (!anchor) return;
    var href = anchor.getAttribute('href') || '';
    var type = null;
    if (href.indexOf('/app/login') === 0) type = 'signup_click';
    else if (href.indexOf('/samples/') === 0) type = 'sample_packet_click';
    if (type) send({ type: type, path: location.pathname, href: href });
  });
})();

// XBAR first-party site script (marketing pages only).
//
// CSP-safe (script-src 'self'), zero-dependency enhancements:
//   1. Deferred homepage artwork and native navigation dismissal. Content
//      remains readable without JavaScript; homepage motion is separate.
//   2. Anonymous analytics beacon: pageviews and the two CTA clicks that
//      matter, reported to our own /api/metrics. No cookies, no identifiers,
//      honors Do Not Track / Global Privacy Control.
/* global document, location, window */
(function () {
  'use strict';

  var doc = typeof document === 'undefined' ? null : document;
  if (!doc) return;
  doc.documentElement.classList.add('js');

  // Only the homepage has these inert templates. This loader is independent
  // of motion, so a blocked animation bundle never hides the artwork.
  var deferredImages = doc.querySelectorAll('[data-landing-image]');
  var hydrateImage = function (container) {
    var template = container.querySelector('template');
    if (!template) return;
    container.appendChild(template.content.cloneNode(true));
    template.remove();
  };
  if (deferredImages.length && 'IntersectionObserver' in window) {
    var imageObserver = new window.IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          hydrateImage(entry.target);
          imageObserver.unobserve(entry.target);
        });
      },
      { rootMargin: '200px' },
    );
    deferredImages.forEach(function (container) {
      imageObserver.observe(container);
    });
  } else {
    deferredImages.forEach(hydrateImage);
  }

  // Native disclosure remains the baseline for mouse, keyboard, touch, and no-JS.
  function setUpNavDropdowns() {
    var dropdowns = Array.prototype.slice.call(doc.querySelectorAll('.nav-dd, .landing-mobile-nav'));
    function closeAll(except) {
      dropdowns.forEach(function (dropdown) {
        if (dropdown !== except) dropdown.removeAttribute('open');
      });
    }
    dropdowns.forEach(function (dropdown) {
      dropdown.addEventListener('toggle', function () {
        if (dropdown.open) closeAll(dropdown);
      });
    });
    doc.addEventListener('click', function (evt) {
      if (!evt.target || !evt.target.closest || !evt.target.closest('.nav-dd, .landing-mobile-nav')) closeAll(null);
    });
    doc.addEventListener('keydown', function (evt) {
      if (evt.key !== 'Escape') return;
      var active = dropdowns.find(function (dropdown) {
        return dropdown.open && dropdown.contains(doc.activeElement);
      });
      closeAll(null);
      if (active) active.querySelector('summary').focus();
    });
  }

  try {
    setUpNavDropdowns();
  } catch {
    /* Enhancements must never break native navigation. */
  }

  /* --------------------------------------------------------- analytics */
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

// XBAR first-party site script (marketing pages only).
//
// Two jobs, both CSP-safe (script-src 'self') and zero-dependency:
//   1. Progressive motion: one-shot, preference-aware section entrances.
//      Everything is additive — without JS (or with reduced motion) the page
//      is fully visible and static.
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

  /* ------------------------------------------------------------ motion */
  function setUpMotion() {
    // Native progressive enhancement: content is never hidden by a CSS class.
    // Unsupported browsers retain the complete static page and every action.
    if (!window.matchMedia || !('IntersectionObserver' in window) || !doc.body.animate) return;
    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    var connection = window.navigator && window.navigator.connection;
    var controls = new Map();
    var seen = new Set();
    var staggerByParent = new Map();
    function motionOff() {
      return reduced.matches || doc.hidden || (connection && connection.saveData);
    }
    function stopMotion() {
      controls.forEach(function (animation) {
        animation.cancel();
      });
      controls.clear();
    }
    var observer = new window.IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting || seen.has(entry.target)) return;
          var el = entry.target;
          seen.add(el);
          observer.unobserve(el);
          if (motionOff() || el.contains(doc.activeElement)) return;
          var animation = el.animate(
            [
              { opacity: 0, transform: 'translateY(14px)' },
              { opacity: 1, transform: 'translateY(0)' },
            ],
            {
              duration: 650,
              delay: Number(el.dataset.revealDelay || 0),
              easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
              fill: 'backwards',
            },
          );
          controls.set(el, animation);
          animation.onfinish = function () {
            controls.delete(el);
          };
        });
      },
      { threshold: 0.12 },
    );
    doc
      .querySelectorAll(
        '.hero > div, .section .card, .steps li, .plan, .faq details, .section h2, .section .intro, .section .shot, .cta .wrap',
      )
      .forEach(function (el) {
        var n = staggerByParent.get(el.parentElement) || 0;
        staggerByParent.set(el.parentElement, n + 1);
        el.dataset.revealDelay = String(Math.min(n * 60, 180));
        observer.observe(el);
      });
    // No replay when preferences change, a tab returns, or the user revisits a section.
    function syncMotion() {
      if (motionOff()) stopMotion();
    }
    if (reduced.addEventListener) reduced.addEventListener('change', syncMotion);
    else if (reduced.addListener) reduced.addListener(syncMotion);
    if (connection && connection.addEventListener) connection.addEventListener('change', syncMotion);
    doc.addEventListener('visibilitychange', syncMotion);
    window.addEventListener('pagehide', stopMotion);
    doc.addEventListener('focusin', function (event) {
      controls.forEach(function (animation, el) {
        if (el.contains(event.target)) {
          animation.cancel();
          controls.delete(el);
        }
      });
    });
  }

  // Progressive enhancement for the native <details> nav dropdowns: on
  // hover-capable pointers open on hover; always keep one open at a time and
  // close on outside-click or Escape. Keyboard toggle (Enter/Space) is
  // preserved — only real mouse clicks are intercepted to avoid closing a
  // hover-opened menu.
  function setUpNavDropdowns() {
    var dropdowns = Array.prototype.slice.call(doc.querySelectorAll('.nav-dd, .landing-mobile-nav'));
    if (!dropdowns.length) return;
    var hoverable = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

    function closeAll(except) {
      dropdowns.forEach(function (d) {
        if (d !== except) d.removeAttribute('open');
      });
    }

    dropdowns.forEach(function (dd) {
      dd.addEventListener('toggle', function () {
        if (dd.open) closeAll(dd);
      });
      if (hoverable && dd.classList.contains('nav-dd')) {
        // pointerenter/leave ignore moves within the subtree, so the
        // absolutely-positioned menu (a DOM child) stays "inside" the dd.
        dd.addEventListener('pointerenter', function () {
          closeAll(dd);
          dd.setAttribute('open', '');
        });
        dd.addEventListener('pointerleave', function () {
          dd.removeAttribute('open');
        });
        var summary = dd.querySelector('summary');
        if (summary) {
          summary.addEventListener('click', function (evt) {
            if (evt.detail !== 0) evt.preventDefault(); // mouse click only; keep keyboard toggle
          });
        }
      }
    });

    doc.addEventListener('click', function (evt) {
      if (!evt.target || !evt.target.closest || !evt.target.closest('.nav-dd, .landing-mobile-nav')) closeAll(null);
    });
    doc.addEventListener('keydown', function (evt) {
      if (evt.key === 'Escape') {
        var open = dropdowns.find(function (dd) {
          return dd.open && dd.contains(doc.activeElement);
        });
        closeAll(null);
        if (open) open.querySelector('summary').focus();
      }
    });
  }

  try {
    // The homepage pilot owns its motion and pause/reduced-motion lifecycle.
    // Navigation and analytics below still run unchanged on every page.
    if (!doc.body.classList.contains('landing-page')) setUpMotion();
    setUpNavDropdowns();
  } catch {
    /* motion must never break the page */
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

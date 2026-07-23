// XBAR first-party site script (marketing pages only).
//
// Two jobs, both CSP-safe (script-src 'self') and zero-dependency:
//   1. Progressive motion: scroll-reveal, header state, and card spotlight.
//      Everything is additive — without JS (or with reduced motion) the page
//      is fully visible and static. CSS gates on the html.js class set here.
//   2. Anonymous analytics beacon: pageviews and the two CTA clicks that
//      matter, reported to our own /api/metrics. No cookies, no identifiers,
//      honors Do Not Track / Global Privacy Control.
/* global document, location, window */
(function () {
  'use strict';

  var doc = typeof document === 'undefined' ? null : document;
  if (!doc) return;
  doc.documentElement.classList.add('js');

  var reduceMotion =
    typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------------------------------------ motion */
  function setUpMotion() {
    var header = doc.querySelector('.site-header');
    if (header) {
      var onScroll = function () {
        header.classList.toggle('scrolled', window.scrollY > 8);
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      onScroll();
    }

    // Cursor spotlight on glass cards (hover-only; irrelevant on touch).
    doc.addEventListener('pointermove', function (evt) {
      var card = evt.target && evt.target.closest ? evt.target.closest('.card, .plan') : null;
      if (!card) return;
      var rect = card.getBoundingClientRect();
      card.style.setProperty('--mx', ((evt.clientX - rect.left) / rect.width) * 100 + '%');
      card.style.setProperty('--my', ((evt.clientY - rect.top) / rect.height) * 100 + '%');
    });

    if (reduceMotion) return;

    // Scroll reveal: only elements below the initial viewport, so first paint
    // never flashes. A deterministic position sweep (rAF-throttled on scroll,
    // plus a short interval until done) is used instead of
    // IntersectionObserver: the sweep cannot miss elements when rendering
    // frames are throttled (battery saver, prerender, headless).
    var pending = [];
    var staggerByParent = new Map();
    doc
      .querySelectorAll(
        '.section .card, .steps li, .plan, .faq details, .section h2, .section .intro, .section .shot, .cta .wrap',
      )
      .forEach(function (el) {
        if (el.getBoundingClientRect().top < window.innerHeight * 0.92) return; // already visible
        var n = (staggerByParent.get(el.parentElement) || 0) + 1;
        staggerByParent.set(el.parentElement, n);
        el.style.setProperty('--rd', Math.min((n - 1) * 70, 350) + 'ms');
        el.classList.add('reveal');
        pending.push(el);
      });
    if (!pending.length) return;

    var ticking = false;
    var sweep = function () {
      ticking = false;
      var line = window.innerHeight * 0.94;
      pending = pending.filter(function (el) {
        if (el.getBoundingClientRect().top > line) return true;
        el.classList.add('in');
        return false;
      });
      if (!pending.length) {
        window.removeEventListener('scroll', onScrollReveal);
        window.clearInterval(sweepTimer);
      }
    };
    var onScrollReveal = function () {
      if (ticking) return;
      ticking = true;
      (window.requestAnimationFrame || window.setTimeout)(sweep);
    };
    window.addEventListener('scroll', onScrollReveal, { passive: true });
    // Interval safety net: catches resizes, anchor jumps, and frame-starved
    // environments where scroll events outpace rendering.
    var sweepTimer = window.setInterval(sweep, 300);
  }

  // Progressive enhancement for the native <details> nav dropdowns: on
  // hover-capable pointers open on hover; always keep one open at a time and
  // close on outside-click or Escape. Keyboard toggle (Enter/Space) is
  // preserved — only real mouse clicks are intercepted to avoid closing a
  // hover-opened menu.
  function setUpNavDropdowns() {
    var dropdowns = Array.prototype.slice.call(doc.querySelectorAll('.nav-dd'));
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
      if (hoverable) {
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
      if (!evt.target || !evt.target.closest || !evt.target.closest('.nav-dd')) closeAll(null);
    });
    doc.addEventListener('keydown', function (evt) {
      if (evt.key === 'Escape') closeAll(null);
    });
  }

  try {
    setUpMotion();
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

/* ============================================================================
   XBAR scroll motion engine — restrained, premium, dependency-free.
   - Scroll-triggered reveals + staggering via IntersectionObserver
   - Subtle parallax on [data-parallax] elements (rAF-throttled)
   - Auto-observes nodes added by client-side route changes (MutationObserver)
   - Fully disabled under prefers-reduced-motion
   Usage: add class "xb-reveal" (optionally style --xb-reveal-index for stagger)
   or data-parallax="0.06" to any element. Call initScrollReveal() once.
   ========================================================================== */

const REVEAL_SELECTOR = '.xb-reveal:not(.is-visible)';
const PARALLAX_SELECTOR = '[data-parallax]';

let started = false;
let io: IntersectionObserver | null = null;
let rescanScheduled = false;

function prefersReduced(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function revealNow(el: Element) {
  el.classList.add('is-visible');
}

function scanReveals() {
  if (!io) return;
  document.querySelectorAll(REVEAL_SELECTOR).forEach((el) => io!.observe(el));
}

function scheduleRescan() {
  if (rescanScheduled) return;
  rescanScheduled = true;
  requestAnimationFrame(() => {
    rescanScheduled = false;
    scanReveals();
  });
}

function initParallax() {
  let ticking = false;
  const update = () => {
    ticking = false;
    const vh = window.innerHeight || 1;
    document.querySelectorAll<HTMLElement>(PARALLAX_SELECTOR).forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.bottom < -200 || rect.top > vh + 200) return;
      const center = rect.top + rect.height / 2;
      const progress = (center - vh / 2) / vh; // roughly -1 .. 1 across viewport
      const speed = Number.parseFloat(el.dataset.parallax || '0.06') || 0.06;
      el.style.transform = `translate3d(0, ${(-progress * speed * 100).toFixed(2)}px, 0)`;
    });
  };
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  update();
}

/** Initialise the engine once. Safe to call repeatedly (re-scans on later calls). */
export function initScrollReveal() {
  if (typeof window === 'undefined') return;

  // Reduced motion: reveal everything immediately, keep new nodes visible too.
  if (prefersReduced()) {
    const markAll = () => document.querySelectorAll(REVEAL_SELECTOR).forEach(revealNow);
    markAll();
    if (!started) {
      started = true;
      new MutationObserver(markAll).observe(document.body, { childList: true, subtree: true });
    }
    return;
  }

  if (started) {
    scheduleRescan();
    return;
  }
  started = true;

  io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          revealNow(entry.target);
          io!.unobserve(entry.target);
        }
      });
    },
    { rootMargin: '0px 0px -7% 0px', threshold: 0.06 },
  );

  scanReveals();
  new MutationObserver(scheduleRescan).observe(document.body, { childList: true, subtree: true });

  initParallax();
}

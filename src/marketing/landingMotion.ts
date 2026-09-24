// Progressive enhancement for the static homepage only. No React/app runtime,
// session, account, or workspace code is imported into this entry point.
import { animate } from 'framer-motion/dom';

const page = document.body;
const toggle = document.querySelector<HTMLButtonElement>('.landing-motion-toggle');
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
const finePointer = window.matchMedia('(hover: hover) and (pointer: fine) and (min-width: 1024px)');
const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
let paused = saveData;
let firstEntrance = true;
let cleanup: (() => void) | undefined;
// Persist for this document: pause/resume, visibility and preference changes
// must not hide already-read content. Interrupted reveals become static in cleanup.
const seen = new Set<Element>();

function startMotion() {
  const controls: { cancel: () => void }[] = [];
  const disposals: (() => void)[] = [];
  const animated = new Set<HTMLElement>();
  const hero = document.querySelector<HTMLElement>('.landing-hero');

  function reveal(el: HTMLElement, delay = 0) {
    animated.add(el);
    const entrance = animate(
      el,
      { opacity: [0, 1], transform: ['translateY(14px)', 'translateY(0)'] },
      {
        duration: 0.65,
        delay,
        ease: [0.22, 1, 0.36, 1],
      },
    );
    controls.push(entrance);
  }

  if (firstEntrance && window.scrollY < 80) {
    const sweep = document.querySelector<HTMLElement>('.landing-light-sweep');
    if (sweep) {
      animated.add(sweep);
      controls.push(
        animate(sweep, { opacity: [0, 0.8, 0], transform: ['translateX(-60%)', 'translateX(65%)'] }, { duration: 1.2 }),
      );
    }
    document.querySelectorAll<HTMLElement>('[data-hero-reveal]').forEach((el, i) => reveal(el, 0.25 + i * 0.09));
  }
  firstEntrance = false;

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting || seen.has(entry.target)) continue;
        seen.add(entry.target);
        observer.unobserve(entry.target);
        const el = entry.target as HTMLElement;
        if (el.dataset.landingCount) {
          const end = Number(el.dataset.landingCount);
          controls.push(
            animate(0, end, {
              duration: 0.8,
              ease: 'easeOut',
              onUpdate: (value) => {
                el.textContent = String(Math.round(value));
              },
            }),
          );
        } else reveal(el);
      }
    },
    { threshold: 0.12 },
  );
  document
    .querySelectorAll<HTMLElement>('[data-landing-reveal], [data-landing-count]')
    .forEach((el) => observer.observe(el));
  disposals.push(() => observer.disconnect());

  // Ambient work is enabled only while the hero is visible, and stops when
  // this tab is hidden. These effects don't drive application state.
  const visibility = new IntersectionObserver((entries) => {
    page.dataset.landingAmbient = entries[0]?.isIntersecting ? 'running' : 'resting';
  });
  if (hero) visibility.observe(hero);
  disposals.push(() => visibility.disconnect());

  function addPointerMotion(surface: HTMLElement, ink: HTMLElement, distance: number) {
    let rect: DOMRect | undefined;
    let frame = 0;
    let x = 0;
    let y = 0;
    const reset = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      rect = undefined;
      ink.style.removeProperty('transform');
    };
    const enter = () => {
      rect = surface.getBoundingClientRect();
    };
    const move = (event: PointerEvent) => {
      if (!rect || event.pointerType !== 'mouse') return;
      x = Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width) * 2 - 1)) * distance;
      y = Math.max(-1, Math.min(1, ((event.clientY - rect.top) / rect.height) * 2 - 1)) * distance;
      if (!frame)
        frame = requestAnimationFrame(() => {
          ink.style.transform = `translate3d(${x}px, ${y}px, 0)`;
          frame = 0;
        });
    };
    surface.addEventListener('pointerenter', enter);
    surface.addEventListener('pointermove', move);
    surface.addEventListener('pointerleave', reset);
    surface.addEventListener('focusin', reset);
    window.addEventListener('resize', reset);
    window.addEventListener('scroll', reset, { passive: true });
    disposals.push(() => {
      reset();
      surface.removeEventListener('pointerenter', enter);
      surface.removeEventListener('pointermove', move);
      surface.removeEventListener('pointerleave', reset);
      surface.removeEventListener('focusin', reset);
      window.removeEventListener('resize', reset);
      window.removeEventListener('scroll', reset);
    });
  }

  if (finePointer.matches) {
    const art = document.querySelector<HTMLElement>('[data-parallax]');
    const plane = art?.querySelector<HTMLElement>('.landing-art-plane');
    if (art && plane) addPointerMotion(art, plane, 6);
    const cta = document.querySelector<HTMLElement>('[data-magnetic]');
    const label = cta?.querySelector<HTMLElement>('span');
    // Only the label shifts. The target stays still under the pointer.
    if (cta && label) addPointerMotion(cta, label, 3);
  }

  const finishFocused = (event: FocusEvent) => {
    if (!(event.target instanceof HTMLElement)) return;
    const parent = event.target.closest<HTMLElement>('[data-landing-reveal], [data-hero-reveal]');
    if (!parent) return;
    parent.getAnimations().forEach((animation) => animation.finish());
  };
  page.addEventListener('focusin', finishFocused);
  disposals.push(() => page.removeEventListener('focusin', finishFocused));

  return () => {
    disposals.forEach((dispose) => dispose());
    // Cancel instead of complete: completion schedules a final inline-style
    // write after this cleanup, which would override the static CSS state.
    controls.forEach((control) => control.cancel());
    animated.forEach((el) => {
      el.style.removeProperty('opacity');
      el.style.removeProperty('transform');
    });
    document.querySelectorAll<HTMLElement>('[data-landing-count]').forEach((el) => {
      el.textContent = el.dataset.landingCount ?? '';
    });
    page.dataset.landingMotion = 'off';
  };
}

function syncMotion() {
  cleanup?.();
  cleanup = undefined;
  const off = reduced.matches || paused || document.hidden;
  page.dataset.landingMotion = off ? 'off' : 'running';
  if (toggle) {
    toggle.hidden = false;
    toggle.disabled = reduced.matches;
    toggle.textContent = reduced.matches ? 'Reduced motion on' : paused ? 'Play motion' : 'Pause motion';
    toggle.setAttribute('aria-pressed', String(paused || reduced.matches));
  }
  if (!off) cleanup = startMotion();
}

if (page.classList.contains('landing-page')) {
  toggle?.addEventListener('click', () => {
    paused = !paused;
    syncMotion();
  });
  reduced.addEventListener('change', syncMotion);
  finePointer.addEventListener('change', syncMotion);
  document.addEventListener('visibilitychange', syncMotion);
  window.addEventListener('pagehide', () => {
    cleanup?.();
    cleanup = undefined;
    page.dataset.landingMotion = 'off';
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) syncMotion();
  });
  syncMotion();
}

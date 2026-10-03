/** One finite highlight over the supplied horse paths. The static mark never depends on JS. */
export const SIGNATURE_DURATION_MS = 1500;

export function installSignatureMotion(svg: SVGSVGElement, isPaused: () => boolean = () => false) {
  const doc = svg.ownerDocument;
  const win = doc.defaultView;
  const controls = new Set<Animation>();
  const noop = { play: () => false, cancel: () => {}, dispose: () => {} };
  if (!win?.matchMedia || typeof svg.animate !== 'function') return noop;
  const reduced = win.matchMedia('(prefers-reduced-motion: reduce)');
  const pointer = win.matchMedia('(hover: hover) and (pointer: fine)');
  const connection = (
    win.navigator as Navigator & {
      connection?: {
        saveData?: boolean;
        addEventListener?: EventTarget['addEventListener'];
        removeEventListener?: EventTarget['removeEventListener'];
      };
    }
  ).connection;
  let disposed = false;
  const cancel = () => {
    controls.forEach((animation) => animation.cancel());
    controls.clear();
    svg.removeAttribute('data-tracing');
  };
  const off = () => disposed || reduced.matches || doc.hidden || connection?.saveData === true || isPaused();
  const play = () => {
    cancel();
    if (off()) return false;
    const paths = Array.from(svg.querySelectorAll<SVGPathElement>('.xbar-signature__trace'));
    let lengths: number[];
    try {
      lengths = paths.map((path) => path.getTotalLength());
    } catch {
      return false; // A static signature is the supported fallback for missing SVG geometry APIs.
    }
    const total = lengths.reduce((sum, length) => sum + length, 0);
    if (!Number.isFinite(total) || total <= 0) return false;
    let delay = 0;
    svg.setAttribute('data-tracing', 'true');
    paths.forEach((path, index) => {
      const duration = (lengths[index] / total) * SIGNATURE_DURATION_MS;
      const animation = path.animate(
        [
          { strokeDashoffset: '0.18', opacity: 0 },
          { strokeDashoffset: '0.0856', opacity: 1, offset: 0.08 },
          { strokeDashoffset: '-0.9056', opacity: 1, offset: 0.92 },
          { strokeDashoffset: '-1', opacity: 0 },
        ],
        { duration, delay, easing: 'linear', fill: 'backwards' },
      );
      delay += duration;
      controls.add(animation);
      animation.onfinish = () => {
        controls.delete(animation);
        if (!controls.size) svg.removeAttribute('data-tracing');
      };
    });
    return true;
  };
  const sync = () => {
    if (off()) cancel();
  };
  const hover = (event: PointerEvent) => {
    if (event.pointerType === 'mouse' && pointer.matches) play();
  };
  const hoverTarget = svg.closest('a, button, .landing-art-plane') ?? svg;
  hoverTarget.addEventListener('pointerenter', hover as EventListener);
  doc.addEventListener('visibilitychange', sync);
  win.addEventListener('pagehide', cancel);
  if (reduced.addEventListener) reduced.addEventListener('change', sync);
  else reduced.addListener(sync);
  connection?.addEventListener?.('change', sync);
  const frame = win.requestAnimationFrame(play);
  return {
    play,
    cancel,
    dispose: () => {
      disposed = true;
      win.cancelAnimationFrame(frame);
      cancel();
      hoverTarget.removeEventListener('pointerenter', hover as EventListener);
      doc.removeEventListener('visibilitychange', sync);
      win.removeEventListener('pagehide', cancel);
      if (reduced.removeEventListener) reduced.removeEventListener('change', sync);
      else reduced.removeListener(sync);
      connection?.removeEventListener?.('change', sync);
    },
  };
}

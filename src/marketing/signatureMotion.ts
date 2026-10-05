import { installSignatureMotion } from '../lib/signatureMotion';

const controllers = Array.from(document.querySelectorAll<SVGSVGElement>('[data-xbar-signature]')).map((svg) =>
  installSignatureMotion(svg, () => document.body.dataset.landingMotion === 'off'),
);
// The existing homepage pause button also stops the signature highlight.
const observer = new MutationObserver(() => {
  if (document.body.dataset.landingMotion === 'off') controllers.forEach((control) => control.cancel());
});
observer.observe(document.body, { attributes: true, attributeFilter: ['data-landing-motion'] });
window.addEventListener('pagehide', () => controllers.forEach((control) => control.cancel()));

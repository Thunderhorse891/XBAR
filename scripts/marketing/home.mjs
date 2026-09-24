import { esc, APP_SIGNUP, SITE_ORIGIN } from './render.mjs';

const stages = [
  ['Bring the papers', 'Upload registration papers, transfer forms, and care records.'],
  ['Read the details', 'OCR helps extract the information from your documents.'],
  ['Check the facts', 'Review the extracted details against the original before saving.'],
  ['Connect the record', 'Keep the source documents with the horse and its ownership history.'],
  ['Prepare to share', 'Build a watermarked buyer packet from the records you approve.'],
];

export function cinematicHome(plans) {
  return {
    path: '/',
    title: 'XBAR — Horse Records, Ownership Integrity & Sale-Ready Buyer Packets',
    description:
      'Bring your horse records into focus with XBAR: documents, ownership, care, expenses, and watermarked buyer packets in one connected workspace.',
    changefreq: 'weekly',
    priority: '1.0',
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: 'XBAR',
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        url: `${SITE_ORIGIN}/`,
        publisher: { '@id': `${SITE_ORIGIN}/#organization` },
        offers: plans.map((plan) => ({
          '@type': 'Offer',
          name: plan.tier,
          price: String(plan.monthlyRate),
          priceCurrency: 'USD',
          category: 'subscription',
          url: `${SITE_ORIGIN}/pricing`,
        })),
      },
    ],
    body: `
<section class="landing-hero" aria-labelledby="landing-title">
  <div class="landing-atmosphere" aria-hidden="true"><i class="landing-glow"></i><i class="landing-grain"></i></div>
  <div class="wrap landing-hero-grid">
    <div class="landing-hero-copy">
      <p class="landing-eyebrow" data-hero-reveal>For the business of horses</p>
      <h1 id="landing-title"><span data-hero-reveal>Every horse.</span> <span data-hero-reveal>One clear picture.</span></h1>
      <p class="landing-lead" data-hero-reveal>Your horses, paperwork, and next decisions. Bring them together in a workspace built around the way you run your operation.</p>
      <div class="landing-actions" data-hero-reveal>
        <a class="btn btn--primary landing-primary" href="${APP_SIGNUP}" rel="nofollow" data-magnetic><span>Create your workspace</span></a>
        <a class="landing-text-link" href="#inside-xbar">Explore XBAR <span aria-hidden="true">↘</span></a>
      </div>
      <p class="landing-note" data-hero-reveal>Records. Ownership. Care. Sale readiness.</p>
    </div>
    <div class="landing-art" data-parallax>
      <div class="landing-art-plane">
        <picture><source srcset="/brand/xbar-report-horse-landing.webp" type="image/webp" /><img class="landing-horse" src="/brand/xbar-report-horse.png" width="1672" height="941" alt="XBAR's metallic horse and wordmark, edged in electric blue" fetchpriority="high" decoding="async" /></picture>
        <i class="landing-light-sweep" aria-hidden="true"></i>
      </div>
      <div class="landing-art-caption"><span class="landing-rim" aria-hidden="true"></span><span>A record worth standing behind.</span></div>
    </div>
  </div>
  <div class="wrap landing-hero-foot">
    <a href="#inside-xbar">Meet your workspace <span aria-hidden="true">↓</span></a>
    <button class="landing-motion-toggle" type="button" aria-pressed="false" hidden>Pause motion</button>
  </div>
</section>

<section class="landing-section wrap" id="inside-xbar" aria-labelledby="inside-title">
  <div class="landing-section-heading" data-landing-reveal>
    <div><p class="landing-eyebrow">From the barn to the buyer</p><h2 id="inside-title">The whole story.<br />Right where you need it.</h2></div>
    <p>Know what you have, find what’s missing, and see what needs attention. Keep the details with the horse, from the first paper to the next handoff.</p>
  </div>
  <figure class="landing-product" data-landing-reveal>
    <div class="landing-product-bar"><span><i aria-hidden="true"></i> Your horse’s record</span><a href="/demo">View the product tour</a></div>
    <img src="/brand/screenshots/app-horse-record.jpg" width="1440" height="900" loading="lazy" alt="XBAR horse profile with identity, ownership, care details, and next steps" />
    <figcaption>Actual XBAR interface, shown with example data.</figcaption>
  </figure>
  <div class="landing-capabilities">
    <article data-landing-reveal><svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M9 4h10l6 6v18H9zM19 4v7h6M13 16h8M13 21h8" /></svg><h3>A home for every paper</h3><p>Registration, ownership, and care documents stay connected to the horse they describe.</p><a href="/features">Explore document tools</a></article>
    <article data-landing-reveal><svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="m11 20-2 2a5 5 0 0 1-7-7l6-6a5 5 0 0 1 7 0m6 3 2-2a5 5 0 0 1 7 7l-6 6a5 5 0 0 1-7 0M11 21l10-10" /></svg><h3>Keep ownership connected</h3><p>Follow ownership history and transfer details alongside the source records.</p><a href="/resources/equine-ownership-transfer-checklist">See the transfer checklist</a></article>
    <article data-landing-reveal><svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M6 7h20v22H6zM11 3v8M21 3v8M6 14h20m-15 7 3 3 7-7" /></svg><h3>See the next decision</h3><p>Bring care dates, expenses, and sale preparation into your daily working view.</p><a href="/solutions/ranch-operations">Explore ranch operations</a></article>
  </div>
</section>

<section class="landing-workflow" aria-labelledby="workflow-title">
  <div class="wrap landing-workflow-grid">
    <div data-landing-reveal><p class="landing-eyebrow">Your papers. Your judgment.</p><h2 id="workflow-title">Less searching.<br />More knowing.</h2><p>Let document intake help with the reading. Keep a person in charge of the facts.</p><div class="landing-stage-count"><span aria-hidden="true" data-landing-count="${stages.length}">${stages.length}</span><span><span class="landing-sr-only">${stages.length} </span>connected stages.<br />One horse record.</span></div></div>
    <ol class="landing-stages">${stages.map(([title, text], i) => `<li data-landing-reveal><span class="landing-stage-index" aria-hidden="true">0${i + 1}</span><div><h3>${title}</h3><p>${text}</p></div></li>`).join('')}</ol>
  </div>
</section>

<section class="landing-section wrap landing-sharing" aria-labelledby="sharing-title">
  <div class="landing-x-art" data-landing-reveal><picture><source srcset="/brand/xbar-report-mark-landing.webp" type="image/webp" /><img src="/brand/xbar-report-mark.png" width="1254" height="1254" loading="lazy" alt="XBAR's original metallic X mark" /></picture></div>
  <div data-landing-reveal><p class="landing-eyebrow">Put your records to work</p><h2 id="sharing-title">Make the next<br />handoff count.</h2><p class="landing-lead">Give a buyer a clearer view of the horse. Bring identity, source documents, and ownership details together in a watermarked sale packet.</p><a class="btn" href="/samples/sample-sale-packet.html">Open a sample packet <span aria-hidden="true">↗</span></a><p class="landing-note">Sample packet uses fictional data.</p></div>
</section>

<section class="landing-section landing-plans-section" aria-labelledby="plans-title">
  <div class="wrap"><div class="landing-section-heading" data-landing-reveal><div><p class="landing-eyebrow">Room for your operation</p><h2 id="plans-title">Start with your horses.<br />Grow from there.</h2></div><p>Choose the capacity and tools your operation needs. <a href="/pricing">Compare all plan details</a>.</p></div>
  <div class="landing-plans">${plans.map((plan) => `<a class="landing-plan" href="/pricing" data-landing-reveal><h3>${esc(plan.tier)}</h3><p class="landing-plan-price">$${plan.monthlyRate}<span>/month</span></p><p>${esc(plan.fit)}</p><span class="landing-plan-link">View plan <span aria-hidden="true">↗</span></span></a>`).join('')}</div></div>
</section>

<section class="landing-close wrap" aria-labelledby="close-title" data-landing-reveal><div><p class="landing-eyebrow">Keep the story with the horse</p><h2 id="close-title">Your next chapter<br />starts with a clear record.</h2></div><div><a class="btn btn--primary" href="${APP_SIGNUP}" rel="nofollow">Create your workspace</a><a class="landing-text-link" href="/demo">Take the product tour <span aria-hidden="true">↗</span></a></div></section>`,
  };
}

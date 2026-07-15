// Content for every public marketing page. All claims here are grounded in
// shipped product behavior (see src/) or the published tier configuration —
// no invented customers, testimonials, or statistics. Product imagery is real:
// screenshots captured from the shipped app by capture-product-screenshots.mjs.

import { esc, APP_LOGIN, APP_SIGNUP, SITE_ORIGIN } from './render.mjs';
import { marketingPlans } from './pricing-data.mjs';

export const CONTENT_UPDATED = '2026-07-13';

const signup = (plan) => `${APP_SIGNUP}${plan ? `&plan=${encodeURIComponent(plan)}` : ''}`;

/* --------------------------------------------------------------- shared */

function ctaBlock(heading, copy) {
  return `<section class="cta">
  <div class="wrap">
    <h2>${esc(heading)}</h2>
    <p class="intro" style="margin-inline:auto">${esc(copy)}</p>
    <div class="hero-actions">
      <a class="btn btn--primary" href="${signup('Professional')}" rel="nofollow">Create your workspace</a>
      <a class="btn" href="/demo">Take the product tour</a>
    </div>
  </div>
</section>`;
}

// Real product imagery: screenshots captured from the shipped application by
// scripts/capture-product-screenshots.mjs (a scripted run of the actual
// local-first workflow with example data). Never replace these with mockups.
function productShot(file, alt, caption, { eager = false } = {}) {
  return `<figure class="shot">
  <img src="/brand/screenshots/${file}" alt="${esc(alt)}" width="1440" height="900" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} />
  <figcaption>${caption}</figcaption>
</figure>`;
}

function recordShot(eager = false) {
  return productShot(
    'app-horse-record.jpg',
    'Screenshot of a horse record in XBAR showing identity details, ownership, care signals, and suggested next steps for a newly added mare',
    'The real product: a horse record captured from a live XBAR workspace with example data — <a href="/demo">see the full tour</a>.',
    { eager },
  );
}

function pipelineSteps() {
  return `<ol class="steps">
  <li><strong>Upload</strong>Bring in registration papers, transfer forms, vet records, and media.</li>
  <li><strong>Local OCR</strong>Documents are read on-device so intake keeps pace with real record volume.</li>
  <li><strong>Human review</strong>Nothing becomes part of the record until a person verifies it.</li>
  <li><strong>Ownership link</strong>Approved documents attach to each horse’s ownership record.</li>
  <li><strong>Watermarked sharing</strong>Approved records bundle into watermarked sale packets for buyers.</li>
</ol>`;
}

function articleShell({ title, updated, minutes, body }) {
  return `<article class="article">
  <p class="kicker">Resources</p>
  <h1>${esc(title)}</h1>
  <p class="article-meta">By the XBAR team · Updated ${esc(updated)} · ${minutes} minute read</p>
  ${body}
  <div class="callout">This guide is operational guidance from the team that builds XBAR’s record workflows. It is not legal, veterinary, registry, or tax advice — confirm requirements with your registry, veterinarian, and counsel.</div>
</article>`;
}

function articleJsonLd({ path, title, description }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: title,
    description,
    url: `${SITE_ORIGIN}${path}`,
    dateModified: CONTENT_UPDATED,
    author: { '@type': 'Organization', name: 'XBAR', url: `${SITE_ORIGIN}/` },
    publisher: { '@id': `${SITE_ORIGIN}/#organization` },
  };
}

function breadcrumbJsonLd(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map(([name, path], index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name,
      item: `${SITE_ORIGIN}${path}`,
    })),
  };
}

/* ----------------------------------------------------------------- home */

const home = {
  path: '/',
  title: 'XBAR — Horse Records, Ownership Integrity & Sale-Ready Buyer Packets',
  description:
    'XBAR turns scattered horse paperwork into trusted digital records: OCR-assisted document intake, verified ownership and transfer status, compliance deadlines, and watermarked sale packets buyers can rely on.',
  changefreq: 'weekly',
  priority: '1.0',
  jsonLd: [
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'XBAR',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web, iOS, Android',
      description:
        'Turn scattered horse paperwork into trusted, buyer-ready digital records with OCR-assisted intake, ownership integrity, compliance deadlines, and watermarked sale packets.',
      url: `${SITE_ORIGIN}/`,
      publisher: { '@id': `${SITE_ORIGIN}/#organization` },
      offers: marketingPlans.map((plan) => ({
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
<section class="hero wrap section--flush">
  <div>
    <p class="kicker">Horse records, ownership &amp; sale readiness</p>
    <h1>Give every horse a record buyers can trust.</h1>
    <p class="lead">One trusted operational record for every horse, document, buyer, and transfer. XBAR turns scattered paperwork into verified, sale-ready proof your team can actually operate from.</p>
    <div class="hero-actions">
      <a class="btn btn--primary" href="${signup('Professional')}" rel="nofollow">Create your workspace</a>
      <a class="btn" href="/demo">See how it works</a>
    </div>
    <ul class="proof-line">
      <li>Ownership chain per horse</li>
      <li>Watermarked sale packets</li>
      <li>Human-verified records</li>
    </ul>
  </div>
  ${recordShot(true)}
</section>

<section class="section">
  <div class="wrap">
    <p class="kicker">One path for every document</p>
    <h2>From loose paperwork to ready records, in five steps.</h2>
    <p class="intro">Every file moves through one pipeline: upload, on-device OCR, human review, ownership linking, then watermarked sharing. No shortcuts, no untracked copies.</p>
    ${pipelineSteps()}
  </div>
</section>

<section class="section">
  <div class="wrap">
    <p class="kicker">What operations get</p>
    <h2>Built around the workflows that cost horse businesses time and money.</h2>
    <div class="grid grid--2" style="margin-top:26px">
      <div class="card"><h3>Records you can trust</h3><p>Replace scattered files, folders, and spreadsheets with one clean digital record per horse — identity, care, documents, and history stay attached to the animal.</p><ul><li>Source documents stay attached</li><li>Gaps are visible, not hidden</li><li>History remains usable years later</li></ul></div>
      <div class="card"><h3>Ownership integrity</h3><p>Track legal owner, co-owner structure, transfer status, and compliance deadlines before missing documents block a sale.</p><ul><li>Ownership documents per horse</li><li>Transfer status and deadlines surfaced</li><li>Every change lands in the audit log</li></ul></div>
      <div class="card"><h3>Faster sale readiness</h3><p>Bundle each horse’s approved documents into a watermarked sale packet and share buyer-ready profiles built only from verified records.</p><ul><li>Watermarked buyer packets</li><li>Buyer profiles from approved records only</li><li>Internal notes stay internal</li></ul></div>
      <div class="card"><h3>OCR-assisted intake</h3><p>High-volume document intake runs through on-device OCR and a review queue, so large archives move into XBAR without sacrificing accuracy.</p><ul><li>On-device OCR extraction</li><li>Review before anything is final</li><li>Match documents to the right horse</li></ul></div>
    </div>
  </div>
</section>

<section class="section">
  <div class="wrap">
    <p class="kicker">Trust is a product feature</p>
    <h2>Designed for records people rely on.</h2>
    <div class="grid grid--3" style="margin-top:26px">
      <div class="card"><h3>Source-record discipline</h3><p>Unknown data stays unknown until a person verifies it. XBAR is built to support decisions, not invent certainty.</p></div>
      <div class="card"><h3>Audit-logged operations</h3><p>Document links, verifications, and status changes are recorded, so your team always knows who changed what and when.</p></div>
      <div class="card"><h3>Controlled buyer access</h3><p>Shared profiles and sale packets are built from approved records, so the public view never becomes the internal workspace.</p></div>
    </div>
  </div>
</section>

<section class="section">
  <div class="wrap">
    <p class="kicker">Who it’s for</p>
    <h2>Built for operations where documents decide the deal.</h2>
    <div class="grid grid--4" style="margin-top:26px">
      <div class="card"><h3><a href="/solutions/breeding-programs">Breeding programs</a></h3><p>Registration papers, foaling history, and ownership structure attached to every horse.</p></div>
      <div class="card"><h3><a href="/solutions/sale-barns">Sale barns &amp; consignors</a></h3><p>Watermarked, buyer-ready packets and shared profiles from approved records.</p></div>
      <div class="card"><h3><a href="/solutions/trainers">Trainers &amp; show barns</a></h3><p>Care status, documents, and owner communication for every horse in the barn.</p></div>
      <div class="card"><h3><a href="/solutions/ranch-operations">Ranch operations</a></h3><p>Herd groups, pastures, feed, equipment, and expenses beside the horse records.</p></div>
    </div>
  </div>
</section>

<section class="section">
  <div class="wrap">
    <p class="kicker">Pricing</p>
    <h2>Plans that match the operation, from first horse to full remuda.</h2>
    <p class="intro">Every plan protects the core horse record. Higher tiers add collaboration, buyer sharing, and substantially more document and storage capacity. <a href="/pricing">See full pricing and plan limits →</a></p>
    <div class="grid grid--4">
      ${marketingPlans
        .map(
          (plan) =>
            `<div class="card"><h3>${esc(plan.tier)}</h3><p class="plan__price">$${plan.monthlyRate}<small>/month</small></p><p>${esc(plan.fit)}</p></div>`,
        )
        .join('\n      ')}
    </div>
  </div>
</section>
${ctaBlock('Start with the records you already have.', 'XBAR shows what is complete, what needs verification, and what is ready to share — beginning with your first upload.')}`,
};

/* ------------------------------------------------------------- features */

const features = {
  path: '/features',
  title: 'XBAR Features — Document Intake, Ownership Tracking, Sale Packets & Ranch Operations',
  description:
    'Explore XBAR features: OCR document intake with human review, per-horse ownership and transfer tracking, watermarked sale packets, buyer follow-up, care boards, expenses, and ranch asset management.',
  changefreq: 'monthly',
  priority: '0.9',
  body: `
<section class="hero hero--solo wrap section--flush">
  <div>
    <p class="kicker">Features</p>
    <h1>Every module answers a real operating question.</h1>
    <p class="lead">XBAR is organized around the moments that decide whether a horse can be trusted, transferred, shown, or sold — not around generic dashboards.</p>
  </div>
</section>

<section class="section">
  <div class="wrap">
    <h2>Documents &amp; OCR intake</h2>
    <p class="intro">Can I find and prove this record when it matters?</p>
    <div class="grid grid--3">
      <div class="card"><h3>On-device OCR</h3><p>Uploads are read locally in your browser — registration papers, Coggins, vet records, and bills of sale become searchable text without your files leaving the device for extraction.</p></div>
      <div class="card"><h3>Review queue</h3><p>Extracted details land in a review queue. A person confirms the document type, the horse it belongs to, and the extracted facts before anything joins the permanent record.</p></div>
      <div class="card"><h3>Duplicate &amp; gap detection</h3><p>XBAR flags likely duplicates on intake and shows which required documents are missing per horse, so gaps are visible instead of discovered mid-sale.</p></div>
    </div>
  </div>
</section>

<section class="section">
  <div class="wrap">
    <h2>Ownership &amp; transfer integrity</h2>
    <p class="intro">Who legally owns this horse, and is anything blocking a transfer?</p>
    <div class="grid grid--3">
      <div class="card"><h3>Ownership record per horse</h3><p>Legal owner, co-owner stakes, and owner entity stay attached to the horse, with the source documents linked as proof.</p></div>
      <div class="card"><h3>Transfer status &amp; deadlines</h3><p>Track transfer posture — clear, pending signatures, registry review, or attention required — plus compliance deadlines before they block a sale.</p></div>
      <div class="card"><h3>Audit log</h3><p>Proof links, verifications, and status changes are recorded with who and when, so the ownership story holds up under buyer scrutiny.</p></div>
    </div>
  </div>
</section>

<section class="section">
  <div class="wrap">
    <h2>Sale readiness &amp; buyer workflow</h2>
    <p class="intro">Can I hand a serious buyer trustworthy documentation today?</p>
    <div class="grid grid--3">
      <div class="card"><h3>Watermarked sale packets</h3><p>Bundle a horse’s approved documents into a print-ready, watermarked buyer packet with identity, ownership, care disclosures, and a release-gate summary. <a href="/samples/sample-sale-packet.html">See a sample packet →</a></p></div>
      <div class="card"><h3>Release gate</h3><p>Packets are scored before release: hard blockers (like unresolved transfers) and warnings are listed explicitly instead of silently shipped to a buyer.</p></div>
      <div class="card"><h3>Buyer follow-up &amp; shared profiles</h3><p>Track inquiries, offers, and follow-ups per buyer, and share buyer-facing horse profiles built only from approved records — internal notes never leak into the public view.</p></div>
    </div>
  </div>
</section>

<section class="section">
  <div class="wrap">
    <h2>Care &amp; daily operations</h2>
    <p class="intro">What needs attention today, and what does this horse cost to keep?</p>
    <div class="grid grid--3">
      <div class="card"><h3>Care board</h3><p>Coggins, vaccination, deworming, dental, and farrier signals per horse — due, watch, or current — computed from the records themselves.</p></div>
      <div class="card"><h3>Health &amp; breeding records</h3><p>Log vet visits, treatments, and breeding events against each horse, with reminders derived from what is actually recorded.</p></div>
      <div class="card"><h3>Expenses &amp; receipts</h3><p>Receipt intake with cost categories per horse and ranch level, so the operating ledger reflects what the operation really spends.</p></div>
    </div>
  </div>
</section>

<section class="section">
  <div class="wrap">
    <h2>Ranch &amp; team</h2>
    <p class="intro">Can the whole team work from one system?</p>
    <div class="grid grid--3">
      <div class="card"><h3>Herds, pastures &amp; feed</h3><p>Herd groups, pasture assignments, and feed &amp; supply tracking sit beside the horse records they support.</p></div>
      <div class="card"><h3>Equipment &amp; assets</h3><p>Trucks, trailers, tack, and tools with condition and service tracking.</p></div>
      <div class="card"><h3>Roles &amp; invitations</h3><p>Invite team members with scoped roles, and give buyers controlled access to shared records — never the internal workspace.</p></div>
    </div>
  </div>
</section>

<section class="section">
  <div class="wrap">
    <h2>Platform</h2>
    <div class="grid grid--3">
      <div class="card"><h3>Local-first</h3><p>XBAR starts as a local-first workspace in your browser — evaluate the full system before enabling cloud services.</p></div>
      <div class="card"><h3>Cloud sync &amp; mobile</h3><p>Optional cloud authentication, workspace sync, and document storage, with iOS and Android apps built from the same product.</p></div>
      <div class="card"><h3>Security posture</h3><p>Strict content-security policy, rate-limited APIs, workspace-scoped row-level security, and idempotent billing webhooks.</p></div>
    </div>
  </div>
</section>
${ctaBlock('See the workflow end to end.', 'The product tour walks the document pipeline from upload to watermarked buyer packet.')}`,
};

/* -------------------------------------------------------------- pricing */

const pricing = {
  path: '/pricing',
  title: 'XBAR Pricing — Starter $29, Professional $79, Ranch Ops $199, Enterprise $499',
  description:
    'Transparent XBAR pricing. Starter $29/mo, Professional $79/mo, Ranch Ops $199/mo, Enterprise $499/mo — with published horse, seat, document, sale-packet, and storage limits for every plan.',
  changefreq: 'monthly',
  priority: '0.9',
  jsonLd: [
    {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: 'XBAR',
      description: 'Horse records, ownership integrity, and sale-readiness software.',
      brand: { '@type': 'Brand', name: 'XBAR' },
      offers: marketingPlans.map((plan) => ({
        '@type': 'Offer',
        name: plan.tier,
        price: String(plan.monthlyRate),
        priceCurrency: 'USD',
        url: `${SITE_ORIGIN}/pricing`,
        availability: 'https://schema.org/InStock',
      })),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: [
        {
          '@type': 'Question',
          name: 'Can I start before cloud sync is configured?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Yes. XBAR has a local-first workspace, so you can evaluate the system and begin organizing records before enabling cloud services.',
          },
        },
        {
          '@type': 'Question',
          name: 'What happens to my records if I change plans?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Your records stay intact. Plans change capacity and collaboration access; they do not erase the operating history you built.',
          },
        },
        {
          '@type': 'Question',
          name: 'How does checkout work?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'A workspace owner reviews the plan inside XBAR and completes the plan change through secure Stripe checkout.',
          },
        },
      ],
    },
  ],
  body: `
<section class="hero hero--solo wrap section--flush">
  <div>
    <p class="kicker">Pricing</p>
    <h1>Simple plans. Published limits. No hidden capacity math.</h1>
    <p class="lead">Every plan protects the core horse record. Higher tiers add collaboration, buyer sharing, and more document and storage capacity — and the limits below are the same ones the application enforces.</p>
  </div>
</section>

<section class="section section--flush">
  <div class="wrap">
    <div class="plans">
      ${marketingPlans
        .map(
          (plan) => `<article class="plan${plan.featured ? ' plan--featured' : ''}">
        ${plan.featured ? '<span class="plan__badge">Most chosen</span>' : ''}
        <h2 style="font-family:var(--font-ui);font-size:20px">${esc(plan.tier)}</h2>
        <p class="plan__fit">${esc(plan.fit)}</p>
        <p class="plan__price">$${plan.monthlyRate}<small>/month</small></p>
        <ul>${plan.features.map((feature) => `<li>${esc(feature)}</li>`).join('')}</ul>
        <a class="btn${plan.featured ? ' btn--primary' : ''}" href="${signup(plan.tier)}" rel="nofollow">Choose ${esc(plan.tier)}</a>
      </article>`,
        )
        .join('\n      ')}
    </div>
  </div>
</section>

<section class="section">
  <div class="wrap">
    <h2>Plan limits, side by side</h2>
    <div class="table-scroll">
      <table class="limits">
        <caption>These limits are enforced by the application — the same numbers appear in your workspace usage meter.</caption>
        <thead><tr><th scope="col">Capacity</th>${marketingPlans.map((plan) => `<th scope="col">${esc(plan.tier)}</th>`).join('')}</tr></thead>
        <tbody>
          <tr><th scope="row">Monthly price</th>${marketingPlans.map((plan) => `<td>$${plan.monthlyRate}</td>`).join('')}</tr>
          <tr><th scope="row">Horses</th>${marketingPlans.map((plan) => `<td>${plan.limits.horseLimit.toLocaleString('en-US')}</td>`).join('')}</tr>
          <tr><th scope="row">Team seats</th>${marketingPlans.map((plan) => `<td>${plan.limits.seatLimit}</td>`).join('')}</tr>
          <tr><th scope="row">Buyer seats</th>${marketingPlans.map((plan) => `<td>${plan.limits.sharedAccessSeatLimit}</td>`).join('')}</tr>
          <tr><th scope="row">Documents</th>${marketingPlans.map((plan) => `<td>${plan.limits.documentLimit.toLocaleString('en-US')}</td>`).join('')}</tr>
          <tr><th scope="row">Sale packets</th>${marketingPlans.map((plan) => `<td>${plan.limits.salePacketLimit.toLocaleString('en-US')}</td>`).join('')}</tr>
          <tr><th scope="row">Storage</th>${marketingPlans.map((plan) => `<td>${plan.limits.storageLimitGb.toLocaleString('en-US')} GB</td>`).join('')}</tr>
        </tbody>
      </table>
    </div>
  </div>
</section>

<section class="section">
  <div class="wrap">
    <h2>Pricing questions</h2>
    <div class="faq" style="margin-top:22px">
      <details><summary>Can I start before cloud sync is configured?</summary><p>Yes. XBAR has a local-first workspace, so you can evaluate the system and begin organizing records before enabling cloud services.</p></details>
      <details><summary>What happens to my records if I change plans?</summary><p>Your records stay intact. Plans change capacity and collaboration access; they do not erase the operating history you built.</p></details>
      <details><summary>Is XBAR only for large operations?</summary><p>No. Starter is designed for a smaller records-driven operation. Professional and Ranch Ops add the collaboration, sale-readiness, and capacity larger programs need.</p></details>
      <details><summary>How does checkout work?</summary><p>A workspace owner reviews the plan inside XBAR and completes the plan change through secure Stripe checkout.</p></details>
    </div>
  </div>
</section>
${ctaBlock('Try it with your own records.', 'Create a workspace, upload a few documents, and see the review pipeline work before you pick a plan.')}`,
};

/* ------------------------------------------------------------ solutions */

function solutionPage({ path, slug, title, description, h1, lead, sections, faq }) {
  return {
    path,
    title,
    description,
    changefreq: 'monthly',
    priority: '0.7',
    jsonLd: [
      breadcrumbJsonLd([
        ['Solutions', '/solutions'],
        [slug, path],
      ]),
    ],
    body: `
<section class="hero hero--solo wrap section--flush">
  <div>
    <p class="kicker">Solutions · ${esc(slug)}</p>
    <h1>${esc(h1)}</h1>
    <p class="lead">${esc(lead)}</p>
    <div class="hero-actions">
      <a class="btn btn--primary" href="${signup('Professional')}" rel="nofollow">Create your workspace</a>
      <a class="btn" href="/demo">Take the product tour</a>
    </div>
  </div>
</section>
${sections
  .map(
    (section) => `<section class="section">
  <div class="wrap">
    <h2>${esc(section.heading)}</h2>
    <p class="intro">${section.copy}</p>
    <div class="grid grid--3">
      ${section.cards.map((card) => `<div class="card"><h3>${esc(card[0])}</h3><p>${card[1]}</p></div>`).join('\n      ')}
    </div>
  </div>
</section>`,
  )
  .join('\n')}
${
  faq
    ? `<section class="section"><div class="wrap"><h2>Common questions</h2><div class="faq" style="margin-top:22px">${faq
        .map((item) => `<details><summary>${esc(item[0])}</summary><p>${item[1]}</p></details>`)
        .join('')}</div></div></section>`
    : ''
}
${ctaBlock('One record per horse. One system for the operation.', 'Start local-first with the records you already have — XBAR shows what is complete and what needs attention.')}`,
  };
}

const solutionsIndex = {
  path: '/solutions',
  title: 'XBAR Solutions — Breeding Programs, Sale Barns, Trainers & Ranch Operations',
  description:
    'How breeding programs, sale barns and consignors, trainers and show barns, and working ranch operations use XBAR for horse records, ownership integrity, and sale-ready documentation.',
  changefreq: 'monthly',
  priority: '0.8',
  body: `
<section class="hero hero--solo wrap section--flush">
  <div>
    <p class="kicker">Solutions</p>
    <h1>Built for the operations where documents decide the deal.</h1>
    <p class="lead">From a single broodmare program to a multi-rider barn, XBAR gives every horse one record your team and your buyers can trust. Pick the path that matches your operation.</p>
  </div>
</section>
<section class="section section--flush">
  <div class="wrap">
    <div class="grid grid--2">
      <div class="card"><h3><a href="/solutions/breeding-programs">Breeding &amp; broodmare programs</a></h3><p>Registration papers, foaling history, breeding events, and ownership structure attached to each horse — so breeding decisions and transfers never stall on missing documents.</p></div>
      <div class="card"><h3><a href="/solutions/sale-barns">Sale barns &amp; consignors</a></h3><p>Turn approved records into watermarked, buyer-ready sale packets and shared profiles — documentation that closes faster and protects your reputation.</p></div>
      <div class="card"><h3><a href="/solutions/trainers">Trainers &amp; show barns</a></h3><p>Care status, documents, expenses, and owner-ready records for every horse in the barn, without folders and group texts.</p></div>
      <div class="card"><h3><a href="/solutions/ranch-operations">Ranch operations</a></h3><p>Herd groups, pastures, feed, equipment, and the operating ledger beside trusted horse records — one system for the whole outfit.</p></div>
    </div>
  </div>
</section>
${ctaBlock('Not sure which fits?', 'Start with a local-first workspace and organize a handful of records — the right plan becomes obvious from your own volume.')}`,
};

const solutionBreeders = solutionPage({
  path: '/solutions/breeding-programs',
  slug: 'Breeding programs',
  title: 'Horse Breeding Program Software — Records, Foaling & Ownership | XBAR',
  description:
    'XBAR for breeding and broodmare programs: registration papers, breeding and foaling events, co-owner structures, and transfer-ready documentation for every mare, stallion, and foal.',
  h1: 'Breeding records that hold up from cover to transfer.',
  lead: 'A breeding program lives and dies on documentation: papers, breeding dates, foaling outcomes, and clean transfers. XBAR keeps all of it attached to the horse it belongs to.',
  sections: [
    {
      heading: 'The record follows the horse — including the foal',
      copy: 'Every mare, stallion, and foal gets its own record with identity, registry details, and linked source documents.',
      cards: [
        [
          'Registration &amp; identity',
          'Registry, registration numbers, markings, and papers stay linked to each animal, with OCR-extracted details verified by a person.',
        ],
        [
          'Breeding events',
          'Log covers, checks, and foaling milestones per horse so the season’s history is queryable instead of remembered.',
        ],
        [
          'Foal-ready structure',
          'New foals start with a clean record from day one — segment, ownership, and documents — instead of inheriting a folder mess.',
        ],
      ],
    },
    {
      heading: 'Ownership structure without spreadsheet archaeology',
      copy: 'Syndicates, partnerships, and co-owned mares are normal in breeding — and they are where paperwork breaks down first.',
      cards: [
        [
          'Co-owner stakes',
          'Record each owner’s stake on the horse itself, with the supporting documents linked as proof.',
        ],
        [
          'Transfer posture',
          'See at a glance which horses are clear to transfer and which are pending signatures or registry review.',
        ],
        [
          'Compliance deadlines',
          'Renewal and registration deadlines surface before they block a sale or a breeding decision.',
        ],
      ],
    },
  ],
  faq: [
    [
      'Can I track a horse before its papers arrive?',
      'Yes. Records can start with the horse’s known identity, and registration documents attach when they arrive — the gap stays visible until they do.',
    ],
    [
      'Does XBAR replace my registry?',
      'No. XBAR organizes and proves your side of the paperwork; registries remain the system of record for registration itself.',
    ],
  ],
});

const solutionSaleBarns = solutionPage({
  path: '/solutions/sale-barns',
  slug: 'Sale barns & consignors',
  title: 'Sale Barn & Consignment Software — Buyer-Ready Horse Packets | XBAR',
  description:
    'XBAR for sale barns and consignors: watermarked sale packets from verified records, release gates that catch missing documents, buyer follow-up tracking, and shared profiles that protect internal notes.',
  h1: 'Documentation that closes sales — and protects your name.',
  lead: 'Serious buyers ask for proof. XBAR turns each consignment’s verified records into a watermarked, buyer-ready packet, and flags what is missing before the buyer finds it.',
  sections: [
    {
      heading: 'From intake to buyer packet in one pipeline',
      copy: 'Consignment paperwork arrives messy. XBAR gives it one path: upload, OCR, human review, then buyer-safe release.',
      cards: [
        [
          'Fast intake at volume',
          'Bulk document intake with on-device OCR keeps up when a consignment arrives as a box of paper.',
        ],
        [
          'Release gate',
          'Packets are scored before release — unresolved transfers and missing documents are hard blockers, listed explicitly. <a href="/samples/sample-sale-packet.html">See a sample packet</a>.',
        ],
        [
          'Watermarked output',
          'Every packet is watermarked and print-formatted, with identity, ownership, disclosures, and included proof documents.',
        ],
      ],
    },
    {
      heading: 'Buyer movement without the group text',
      copy: 'Track every inquiry against the horse it concerns, and answer with records instead of promises.',
      cards: [
        ['Buyer follow-up', 'Inquiries, offers, counter-offers, and deposits tracked per buyer and per horse.'],
        [
          'Shared profiles',
          'Buyer-facing profiles are built only from approved records — internal notes, cost basis, and medical details never leak.',
        ],
        ['Audit trail', 'Releases and shares are logged, so you can show exactly what a buyer received and when.'],
      ],
    },
  ],
  faq: [
    [
      'Can a buyer see my internal workspace?',
      'No. Buyer-facing shares are a separate, sanitized view built from approved records only — internal fields are stripped by design.',
    ],
    [
      'What if a horse isn’t ready to share?',
      'The release gate blocks the packet and tells you why — missing Coggins, unresolved transfer, or unreviewed documents — so nothing ships incomplete.',
    ],
  ],
});

const solutionTrainers = solutionPage({
  path: '/solutions/trainers',
  slug: 'Trainers & show barns',
  title: 'Trainer & Show Barn Software — Care, Records & Owner Reporting | XBAR',
  description:
    'XBAR for trainers and show barns: care boards for every horse in the barn, health and farrier records, expense tracking per horse, and clean documentation when a client horse sells.',
  h1: 'Every horse in the barn, one trustworthy record.',
  lead: 'Client horses arrive with partial paperwork and leave with your reputation attached. XBAR keeps care, documents, and costs straight for every stall.',
  sections: [
    {
      heading: 'Daily care you can defend',
      copy: 'The care board reads the records and tells you what is due — instead of relying on whiteboards and memory.',
      cards: [
        [
          'Care signals',
          'Coggins, vaccination, deworming, dental, and farrier status per horse — due, watch, or current.',
        ],
        [
          'Health records',
          'Vet visits, treatments, and medication notes logged against the horse, ready when the owner or a vet asks.',
        ],
        ['Task queue', 'A daily work view built from real record state, so the barn crew works the same list.'],
      ],
    },
    {
      heading: 'Owner trust, documented',
      copy: 'When a client horse sells or moves, the difference between a folder and a record is your professionalism.',
      cards: [
        [
          'Expenses per horse',
          'Feed, vet, farrier, and hauling receipts categorized per horse — billing conversations get simple.',
        ],
        [
          'Sale-ready handoff',
          'When a client sells, the horse’s verified documents bundle into a watermarked packet in minutes.',
        ],
        ['Scoped team roles', 'Invite barn staff with the access they need and nothing more.'],
      ],
    },
  ],
  faq: [
    [
      'Do I need the owner’s permission to share records?',
      'Sharing is always an explicit action in XBAR. Nothing is public by default, and buyer-facing views only ever contain approved records.',
    ],
    [
      'Can I run multiple owners’ horses in one workspace?',
      'Yes. Each horse carries its own owner and ownership record, so a mixed barn stays organized without separate systems.',
    ],
  ],
});

const solutionRanch = solutionPage({
  path: '/solutions/ranch-operations',
  slug: 'Ranch operations',
  title: 'Ranch Management Software — Horses, Herds, Pastures & Ledger | XBAR',
  description:
    'XBAR for working ranch operations: herd groups, pasture assignments, feed and supply tracking, equipment condition, expense ledger, and trusted per-horse records in one system.',
  h1: 'Run the outfit from one system, not five.',
  lead: 'Horses, herds, pastures, feed, equipment, and money — XBAR keeps the operating picture beside the horse records instead of scattered across apps.',
  sections: [
    {
      heading: 'The operating picture',
      copy: 'Group-level views built from the same records the horses carry individually.',
      cards: [
        [
          'Herd groups &amp; pastures',
          'Organize horses into working groups and pasture assignments, and move them with a record of the move.',
        ],
        ['Feed &amp; supplies', 'Track feed and supply inventory beside the horses consuming it.'],
        ['Equipment &amp; assets', 'Trucks, trailers, tack, and tools with condition and service status.'],
      ],
    },
    {
      heading: 'The money picture',
      copy: 'Receipts become an operating ledger with horse-level and ranch-level visibility.',
      cards: [
        ['Receipt intake', 'Photograph or upload receipts; they land in the ledger with category and vendor.'],
        ['Cost per horse', 'Allocate costs to horses to see what each head actually costs to keep.'],
        ['Reports', 'Operating summaries built from real recorded data — not estimates.'],
      ],
    },
  ],
  faq: [
    [
      'Does XBAR work offline?',
      'XBAR is local-first: the workspace runs in your browser and keeps working with spotty connectivity; cloud sync is optional and additive.',
    ],
    [
      'Is there a mobile app?',
      'Yes — iOS and Android apps are built from the same product, so the barn phone sees the same records as the office.',
    ],
  ],
});

/* ------------------------------------------------------------ resources */

const resourcesIndex = {
  path: '/resources',
  title: 'Horse Records & Sale Readiness Resources | XBAR',
  description:
    'Practical guides from the XBAR team: what belongs in a complete horse record, how to prepare sale-ready documentation buyers trust, and how to run a clean equine ownership transfer.',
  changefreq: 'weekly',
  priority: '0.8',
  body: `
<section class="hero hero--solo wrap section--flush">
  <div>
    <p class="kicker">Resources</p>
    <h1>Operational guides for horse records and sale readiness.</h1>
    <p class="lead">Written by the team that builds XBAR’s record workflows. Practical, checklist-driven, and honest about what software can and cannot verify for you.</p>
  </div>
</section>
<section class="section section--flush">
  <div class="wrap">
    <div class="grid grid--3">
      <div class="card"><h3><a href="/resources/horse-records-checklist">The complete horse records checklist</a></h3><p>Every document a well-run operation keeps per horse — identity, health, ownership, and financial — and why each one matters when it’s missing.</p></div>
      <div class="card"><h3><a href="/resources/sale-ready-horse-documentation">Sale-ready documentation buyers trust</a></h3><p>What serious buyers ask for, the order they ask in, and how to assemble a packet that answers before they ask.</p></div>
      <div class="card"><h3><a href="/resources/equine-ownership-transfer-checklist">The equine ownership transfer checklist</a></h3><p>A step-by-step walkthrough of a clean transfer: bill of sale, registry transfer, health papers, and the records both sides should keep.</p></div>
    </div>
  </div>
</section>
${ctaBlock('Put the checklists to work.', 'XBAR turns these checklists into live record status per horse — complete, missing, or due.')}`,
};

const recordsChecklist = {
  path: '/resources/horse-records-checklist',
  title: 'The Complete Horse Records Checklist — What to Keep for Every Horse | XBAR',
  description:
    'A practical checklist of the records every horse operation should keep per horse: identity and registration, health and Coggins, ownership and transfer, and financial documents — plus how long to keep them.',
  changefreq: 'monthly',
  priority: '0.7',
  ogType: 'article',
  jsonLd: [
    articleJsonLd({
      path: '/resources/horse-records-checklist',
      title: 'The Complete Horse Records Checklist',
      description: 'Every document a well-run horse operation keeps per horse, and why each matters.',
    }),
    breadcrumbJsonLd([
      ['Resources', '/resources'],
      ['Horse records checklist', '/resources/horse-records-checklist'],
    ]),
  ],
  body: articleShell({
    title: 'The complete horse records checklist',
    updated: 'July 13, 2026',
    minutes: 8,
    body: `
<p>Most horse operations don’t lose money because they lack records — they lose it because the records exist somewhere: a truck glovebox, an old email thread, a photo on a former employee’s phone. The cost shows up at the worst moment, when a buyer, veterinarian, insurer, or registry asks for proof on a deadline.</p>
<p>This checklist covers the four record categories a well-run operation keeps <em>per horse</em>, why each matters, and what “complete” looks like.</p>

<h2>1. Identity and registration</h2>
<p>Everything that proves this horse is the horse you say it is.</p>
<ul class="checklist">
  <li><strong>Registration papers</strong> — the registry certificate (AQHA, APHA, Jockey Club, or breed registry) with the registration number recorded where you can find it without the paper.</li>
  <li><strong>Photos and markings</strong> — current conformation photos plus close-ups of markings, brands, scars, and whorls. These settle identity questions faster than any document.</li>
  <li><strong>Microchip number</strong> — if chipped, keep the number with the record, not just in the registry database.</li>
  <li><strong>Pedigree documentation</strong> — especially for breeding stock, where the pedigree is part of the horse’s value.</li>
</ul>
<div class="callout">Missing identity documents don’t block daily care — they block <em>sales and transfers</em>, usually on a timeline you don’t control. Track the gap explicitly instead of discovering it during a deal.</div>

<h2>2. Health and veterinary</h2>
<ul class="checklist">
  <li><strong>Current negative Coggins</strong> — required for most interstate travel, shows, and sales in the U.S.; typically valid 6–12 months depending on state and event. This is the most commonly expired document in any barn.</li>
  <li><strong>Vaccination history</strong> — dates, products, and who administered them.</li>
  <li><strong>Deworming and dental records</strong> — with dates, so “due” is a fact instead of a guess.</li>
  <li><strong>Vet visit and treatment notes</strong> — diagnoses, treatments, medications, and withdrawal periods.</li>
  <li><strong>Health certificates (CVIs)</strong> — kept after travel; they document the horse’s health status on specific dates.</li>
</ul>

<h2>3. Ownership and transfer</h2>
<p>The chain of title — the records that prove who owns the horse and that every past change of hands was clean.</p>
<ul class="checklist">
  <li><strong>Bill of sale</strong> — for your purchase of the horse, and every prior one you can obtain.</li>
  <li><strong>Registry transfer report</strong> — the registry’s record showing ownership transferred to you.</li>
  <li><strong>Co-ownership or syndicate agreements</strong> — in writing, with each party’s percentage.</li>
  <li><strong>Lease agreements</strong> — current and historical.</li>
  <li><strong>Brand inspection certificates</strong> — where your state requires them.</li>
  <li><strong>Lien releases</strong> — if the horse was ever financed or subject to an agister’s lien.</li>
</ul>

<h2>4. Financial and operational</h2>
<ul class="checklist">
  <li><strong>Purchase price documentation</strong> — establishes cost basis for taxes and insurance.</li>
  <li><strong>Insurance policies</strong> — mortality, major medical, loss-of-use — with current values.</li>
  <li><strong>Expense receipts per horse</strong> — feed, vet, farrier, hauling, training. What a horse costs to keep is a fact you can only know if you record it.</li>
  <li><strong>Board, training, and breeding contracts</strong> — signed copies, both directions.</li>
</ul>

<h2>How long to keep records</h2>
<p>Keep identity and ownership records for the life of the horse <em>plus</em> as long as any claim could surface — many operations simply never discard them. Health records: at minimum several years, and permanently for anything relating to a sale disclosure. Financial records: follow your accountant’s retention guidance (commonly seven years in the U.S.).</p>

<h2>Making the checklist operational</h2>
<p>A checklist on paper degrades the day you print it. What keeps records complete is <em>visible status</em>: for each horse, which documents exist, which are missing, and which expire soon. That is exactly the model XBAR uses — each horse record shows its documentation gaps, and expirations surface as deadlines instead of surprises. <a href="/features">See how the record works →</a></p>`,
  }),
};

const saleReadyGuide = {
  path: '/resources/sale-ready-horse-documentation',
  title: 'Sale-Ready Horse Documentation — What Buyers Ask For | XBAR',
  description:
    'How to prepare horse sale documentation buyers trust: the documents serious buyers request, the order they ask in, disclosure practices that protect sellers, and how to assemble a complete buyer packet.',
  changefreq: 'monthly',
  priority: '0.7',
  ogType: 'article',
  jsonLd: [
    articleJsonLd({
      path: '/resources/sale-ready-horse-documentation',
      title: 'Sale-Ready Horse Documentation — What Buyers Ask For',
      description: 'The documents serious buyers request and how to assemble a complete buyer packet.',
    }),
    breadcrumbJsonLd([
      ['Resources', '/resources'],
      ['Sale-ready documentation', '/resources/sale-ready-horse-documentation'],
    ]),
  ],
  body: articleShell({
    title: 'Sale-ready documentation buyers trust',
    updated: 'July 13, 2026',
    minutes: 7,
    body: `
<p>When a serious buyer moves from “nice horse” to “let’s talk,” the conversation becomes a documentation exercise. The seller who answers document requests in minutes — with organized, consistent records — closes faster and defends a better price. The seller who says “let me look for that” introduces doubt that discounts the horse.</p>

<h2>What buyers actually ask for, in order</h2>
<ol>
  <li><strong>Identity confirmation.</strong> Registration papers matching the horse in front of them — name, markings, registration number.</li>
  <li><strong>Current negative Coggins.</strong> Often the first hard document request, because travel depends on it.</li>
  <li><strong>Ownership proof.</strong> Evidence you can legally sell: registry transfer showing you as owner, or authority to sell on the owner’s behalf.</li>
  <li><strong>Health history.</strong> Vaccination and deworming currency, known conditions, treatment history. Buyers planning a pre-purchase exam want the vet to see this.</li>
  <li><strong>Performance or breeding records</strong> where relevant to the horse’s job.</li>
</ol>

<h2>The disclosure posture that protects sellers</h2>
<p>Disclose known material conditions in writing, in the packet. It feels counterintuitive, but written disclosure is the seller’s protection: the buyer cannot later claim concealment of something the packet stated plainly. The riskiest sale is one where health history traveled by text message and memory.</p>
<div class="callout">A documentation packet is not a warranty. State what the records show, attribute documents to their sources (this vet, this date), and let verified paperwork — not adjectives — carry the trust.</div>

<h2>Assembling the buyer packet</h2>
<p>A complete buyer packet contains:</p>
<ul class="checklist">
  <li>Horse identity summary — registered name, barn name, breed, sex, foal date, registry and number</li>
  <li>Current negative Coggins and recent health certificate if available</li>
  <li>Vaccination, deworming, dental, and farrier currency</li>
  <li>Ownership and transfer status — who legally owns the horse and that transfer is unencumbered</li>
  <li>Known conditions and treatment history, disclosed in writing</li>
  <li>Asking price and sale terms</li>
  <li>The proof documents themselves — not just claims about them</li>
</ul>
<p>Watermark anything you send before a deposit. A watermark doesn’t prevent misuse, but it marks the packet as pre-purchase review material and identifies its source.</p>

<h2>The release-gate habit</h2>
<p>Before any packet leaves the barn, run one check: <em>is anything in here unverified, expired, or missing?</em> An expired Coggins or an unresolved transfer discovered by the buyer costs more than the delay of fixing it first. This is the model XBAR enforces in software — packets are scored against the horse’s actual records, hard blockers are listed explicitly, and the packet ships watermarked with its included proof. <a href="/samples/sample-sale-packet.html">See what a generated packet looks like →</a></p>`,
  }),
};

const transferChecklist = {
  path: '/resources/equine-ownership-transfer-checklist',
  title: 'Equine Ownership Transfer Checklist — Clean Horse Sales Step by Step | XBAR',
  description:
    'A step-by-step equine ownership transfer checklist: bill of sale essentials, registry transfer, brand inspection, health papers for transport, payment protection, and the records both parties should keep.',
  changefreq: 'monthly',
  priority: '0.7',
  ogType: 'article',
  jsonLd: [
    articleJsonLd({
      path: '/resources/equine-ownership-transfer-checklist',
      title: 'Equine Ownership Transfer Checklist',
      description: 'A step-by-step walkthrough of a clean horse ownership transfer.',
    }),
    breadcrumbJsonLd([
      ['Resources', '/resources'],
      ['Ownership transfer checklist', '/resources/equine-ownership-transfer-checklist'],
    ]),
  ],
  body: articleShell({
    title: 'The equine ownership transfer checklist',
    updated: 'July 13, 2026',
    minutes: 8,
    body: `
<p>Most horse-sale disputes aren’t about the horse — they’re about paperwork that was never finished. The registry still shows the old owner. The bill of sale is missing a term someone remembers differently. Nobody kept the transport health certificate. A clean transfer is a checklist, executed in order, with both parties keeping copies of everything.</p>

<h2>Before the sale</h2>
<ul class="checklist">
  <li><strong>Confirm authority to sell.</strong> The seller should be the registered owner or hold written authority from every owner — including all co-owners and any syndicate members.</li>
  <li><strong>Resolve encumbrances.</strong> Board bills, breeding fees, or liens against the horse should be settled or disclosed before terms are agreed.</li>
  <li><strong>Assemble the documentation packet.</strong> Identity, Coggins, health history, ownership proof — see the <a href="/resources/sale-ready-horse-documentation">sale-ready documentation guide</a>.</li>
  <li><strong>Pre-purchase exam.</strong> Typically arranged and paid by the buyer, with a veterinarian of the buyer’s choosing.</li>
</ul>

<h2>The bill of sale</h2>
<p>The core transfer document. At minimum it should state:</p>
<ul class="checklist">
  <li>Full legal names and addresses of buyer and seller</li>
  <li>The horse’s identity — registered name, registration number, breed, sex, foal date, markings</li>
  <li>Purchase price and payment terms, including any deposit already paid</li>
  <li>Sale condition — “as-is” or with stated warranties, and any written disclosures</li>
  <li>When risk of loss passes from seller to buyer</li>
  <li>Signatures and dates from all parties — every co-owner signs</li>
</ul>
<div class="callout">Some states have specific requirements for livestock sales, and some require brand inspection before a horse changes hands or leaves the state. Check your state’s rules — a missed brand inspection can unwind an otherwise clean sale.</div>

<h2>Completing the transfer</h2>
<ul class="checklist">
  <li><strong>Payment clears before the horse or papers move.</strong> For remote sales, escrow-style arrangements protect both sides.</li>
  <li><strong>Sign and submit the registry transfer report</strong> with the registration certificate and transfer fee. Until the registry processes it, the record still shows the seller.</li>
  <li><strong>Health papers for transport</strong> — current Coggins and, for interstate movement, a certificate of veterinary inspection (CVI) dated within the required window.</li>
  <li><strong>Deliver the records with the horse:</strong> health history, feeding notes, and copies of the packet the buyer reviewed.</li>
</ul>

<h2>After the transfer — both parties keep</h2>
<ul class="checklist">
  <li>Signed bill of sale (original for the buyer, copy for the seller)</li>
  <li>Proof of payment</li>
  <li>Registry transfer confirmation once processed</li>
  <li>The disclosure documents exactly as shared during the sale</li>
</ul>
<p>The seller’s file on a sold horse is not dead weight — it is the defense if a dispute surfaces later. In XBAR, a sold horse’s record, its audit log, and the exact packets shared with the buyer remain in the workspace history. <a href="/features">See how ownership tracking works →</a></p>`,
  }),
};

/* ----------------------------------------------------------------- demo */

const demo = {
  path: '/demo',
  title: 'XBAR Product Tour — See the Record, Pipeline & Sale Packet | XBAR',
  description:
    'Walk through XBAR before you register: the horse record layout, the five-step document pipeline, the ownership view, and a real sample of the watermarked buyer sale packet XBAR generates.',
  changefreq: 'monthly',
  priority: '0.8',
  body: `
<section class="hero hero--solo wrap section--flush">
  <div>
    <p class="kicker">Product tour</p>
    <h1>Inspect the product before you register.</h1>
    <p class="lead">No form, no email gate. This page walks the core workflow — and because XBAR is local-first, creating a workspace to try it with your own documents costs nothing and requires no cloud account.</p>
    <div class="hero-actions">
      <a class="btn btn--primary" href="${APP_SIGNUP}" rel="nofollow">Open a local-first workspace</a>
      <a class="btn" href="/samples/sample-sale-packet.html">View the sample sale packet</a>
    </div>
  </div>
</section>

<section class="section">
  <div class="wrap">
    <h2>1 · The horse record</h2>
    <p class="intro">Every horse resolves to one record: identity, ownership, care signals, documents, and sale readiness. This is a real screenshot of the shipped product, captured from a live workspace with example data.</p>
    ${recordShot()}
  </div>
</section>

<section class="section">
  <div class="wrap">
    <h2>2 · The document pipeline</h2>
    <p class="intro">Documents follow one path. OCR runs on your device; a person approves everything before it becomes part of the record.</p>
    ${pipelineSteps()}
    ${productShot(
      'app-documents.jpg',
      'Screenshot of the XBAR documents page showing the five-stage pipeline: upload, OCR processing, review, ownership, and share',
      'The documents pipeline as it ships — upload through buyer-safe share.',
    )}
  </div>
</section>

<section class="section">
  <div class="wrap">
    <h2>Real screens, start to finish</h2>
    <p class="intro">Every image on this page is a screenshot of the shipped application, captured by scripting the real workflow — workspace setup, the global Create flow, and the resulting records.</p>
    <div class="grid grid--2">
      ${productShot('app-workspace-setup.jpg', 'Screenshot of the XBAR workspace setup form with business, ranch, owner, and location fields', 'Local-first workspace setup — no cloud account required to start.')}
      ${productShot('app-quick-create-horse.jpg', 'Screenshot of the XBAR global Create drawer adding a horse named Example Doc Bar', 'The global Create flow — every action persists to the real record store.')}
      ${productShot('app-dashboard.jpg', 'Screenshot of the XBAR dashboard after workspace setup showing ranch status and getting-started guidance', 'The dashboard reflecting real workspace state.')}
      ${productShot('app-login.jpg', 'Screenshot of the XBAR sign-in screen with local-first workspace option', 'Sign-in — cloud sync is optional and additive.')}
    </div>
  </div>
</section>

<section class="section">
  <div class="wrap">
    <h2>3 · The sale packet — a real sample</h2>
    <p class="intro">This is not a mock-up: the sample below is generated in the same print-ready format the application produces, using a clearly-labeled fictional horse. Identity, ownership posture, care disclosures, release-gate results, and included proof documents — watermarked, with the buyer-verification notice XBAR stamps on every packet.</p>
    <div class="hero-actions">
      <a class="btn btn--primary" href="/samples/sample-sale-packet.html">Open the sample sale packet</a>
    </div>
  </div>
</section>

<section class="section">
  <div class="wrap">
    <h2>4 · Then try it with your own records</h2>
    <p class="intro">XBAR starts as a local-first workspace in your browser: create it, add a horse, upload a document, and watch the review pipeline work — before any plan decision or cloud configuration.</p>
    <div class="grid grid--3">
      <div class="card"><h3>Create a workspace</h3><p>One click, runs in your browser, no credit card.</p></div>
      <div class="card"><h3>Add a horse &amp; upload a document</h3><p>Watch OCR extract details and the review queue ask for your confirmation.</p></div>
      <div class="card"><h3>Check the record</h3><p>See gaps, care signals, and sale-readiness computed from what you actually added.</p></div>
    </div>
  </div>
</section>
${ctaBlock('The tour is the product.', 'Everything shown here is shipped behavior — open a workspace and verify it yourself.')}`,
};

/* ------------------------------------------------------------- legal */

export function legalPage(doc, path) {
  return {
    path,
    title: `${doc.shortTitle} | XBAR`,
    description: doc.purpose,
    changefreq: 'yearly',
    priority: '0.3',
    body: `
<article class="article">
  <p class="kicker">Legal</p>
  <h1>${esc(doc.title)}</h1>
  <p class="article-meta">Last updated ${esc(doc.lastUpdated)}</p>
  <div class="callout">${esc(doc.notice)}</div>
  ${doc.sections
    .map(
      (section, index) =>
        `<h2>${String(index + 1).padStart(2, '0')}. ${esc(section.title)}</h2>\n${section.body.map((paragraph) => `<p>${esc(paragraph)}</p>`).join('\n')}`,
    )
    .join('\n')}
</article>`,
  };
}

/* ----------------------------------------------------------------- 404 */

export const notFoundPage = {
  path: '/404.html',
  title: 'Page not found | XBAR',
  description: 'The page you are looking for does not exist.',
  noindex: true,
  body: `
<section class="hero hero--solo wrap section--flush">
  <div>
    <p class="kicker">404</p>
    <h1>That page doesn’t exist.</h1>
    <p class="lead">The link may be old or mistyped. The pages below cover most of what visitors are looking for.</p>
    <div class="hero-actions">
      <a class="btn btn--primary" href="/">Go to the homepage</a>
      <a class="btn" href="/pricing">Pricing</a>
      <a class="btn" href="${APP_LOGIN}" rel="nofollow">Sign in to the app</a>
    </div>
  </div>
</section>`,
};

export const marketingPages = [
  home,
  features,
  pricing,
  solutionsIndex,
  solutionBreeders,
  solutionSaleBarns,
  solutionTrainers,
  solutionRanch,
  resourcesIndex,
  recordsChecklist,
  saleReadyGuide,
  transferChecklist,
  demo,
];

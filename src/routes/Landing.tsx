import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { XbarMark } from '@/components/BrandMark';
import { productEvent, productEventNames } from '@/lib/productEvents';
import { trackRuntimeEvent } from '@/lib/runtimeEvents';
import { subscriptionPlans } from '@/lib/subscriptionPlans';
import { useCloudStore } from '@/store/useCloudStore';
import type { SubscriptionTier } from '@/types/xbar';
import './landingExperience.css';

const tiers: SubscriptionTier[] = ['Starter', 'Professional', 'Ranch Ops', 'Enterprise'];

const planFit: Record<SubscriptionTier, string> = {
  Starter: 'For smaller records-driven operations getting out of spreadsheets.',
  Professional: 'For active breeding and sale businesses that need stronger workflows.',
  'Ranch Ops': 'For multi-user operations with significant record volume.',
  Enterprise: 'For larger businesses that need the highest operating capacity.',
};

const pipeline = [
  { step: 'Upload', copy: 'Bring in registration papers, transfer forms, vet records, and media.' },
  { step: 'Local OCR', copy: 'Documents are read on-device so intake keeps pace with real paperwork volume.' },
  { step: 'Human review', copy: 'Nothing becomes part of the record until a person verifies it.' },
  { step: 'Ownership proof', copy: 'Approved documents link into each horse’s ownership proof chain.' },
  { step: 'Watermarked sharing', copy: 'Approved records bundle into watermarked sale packets for buyers.' },
];

const pillars = [
  {
    title: 'Records you can trust',
    copy: 'Replace scattered files, folders, and spreadsheets with one clean digital record per horse — identity, care, documents, and history stay attached to the animal.',
    details: ['Source documents stay attached', 'Gaps are visible, not hidden', 'History remains usable years later'],
  },
  {
    title: 'Ownership integrity',
    copy: 'Track legal owner, co-owner structure, transfer status, and compliance deadlines before paperwork blocks a sale.',
    details: ['Ownership proof chain per horse', 'Transfer status and deadlines surfaced', 'Every change lands in the audit log'],
  },
  {
    title: 'Faster sale readiness',
    copy: 'Bundle each horse’s approved documents into a watermarked sale packet and present buyer-ready profiles built only from verified records.',
    details: ['One-click watermarked packets', 'Buyer profiles from approved records', 'Internal notes stay internal'],
  },
  {
    title: 'OCR-assisted intake',
    copy: 'High-volume document intake runs through local OCR and a review queue, so large archives move into XBAR without sacrificing accuracy.',
    details: ['On-device OCR extraction', 'Review before anything is final', 'Match documents to the right horse'],
  },
];

const painPoints = [
  'Buyer packets take too long to assemble',
  'Ownership and transfer paperwork gets messy',
  'Horse documents live in too many places',
  'Medical and sale records are hard to trust quickly',
  'Internal handoffs create delays and risk',
];

const trustPoints = [
  {
    title: 'Source-record discipline',
    copy: 'Unknown data stays unknown until a person verifies it. XBAR is built to support decisions, not invent certainty.',
  },
  {
    title: 'Audit-logged operations',
    copy: 'Proof links, verifications, and status changes are recorded, so your team always knows who changed what and when.',
  },
  {
    title: 'Controlled buyer access',
    copy: 'Shared profiles and sale packets are built from approved records, so the public view never becomes the internal workspace.',
  },
];

const questions = [
  {
    question: 'Can I start before cloud sync is configured?',
    answer: 'Yes. XBAR has a local-first workspace, so you can evaluate the system and begin organizing records before enabling cloud services.',
  },
  {
    question: 'What happens to my records if I change plans?',
    answer: 'Your records stay intact. Plans change capacity and collaboration access; they do not erase the operating history you built.',
  },
  {
    question: 'Is XBAR only for large operations?',
    answer: 'No. Starter is designed for a smaller records-driven operation. Professional and Ranch Ops add the collaboration, sale-readiness, and capacity larger programs need.',
  },
  {
    question: 'How does checkout work?',
    answer: 'A workspace owner reviews the plan inside XBAR and completes the plan change through secure Stripe checkout when billing is configured.',
  },
];

const signupPath = (plan?: SubscriptionTier) => `/login?mode=signup${plan ? `&plan=${encodeURIComponent(plan)}` : ''}`;

function Wordmark() {
  return (
    <span className="xbar-wordmark">
      <span className="xbar-wordmark__mark" aria-hidden="true"><XbarMark tone="mono" /></span>
      <span className="xbar-wordmark__copy">
        <strong>XBAR</strong>
        <span>Records &amp; sale readiness</span>
      </span>
    </span>
  );
}

function CommandPreview() {
  return (
    <figure className="command-brief revenue-console" aria-label="Example XBAR horse record showing verified ownership, a compliance deadline, document review status, and sale packet readiness">
      <div className="revenue-console__top">
        <span className="revenue-console__mark" aria-hidden="true">
          <XbarMark tone="mono" />
        </span>
        <div className="revenue-console__head">
          <p className="revenue-kicker">Operational record</p>
          <strong>Smart Lena Bar &middot; 2019 mare</strong>
        </div>
        <span className="revenue-chip revenue-chip--blue">Proof chain complete</span>
      </div>
      <dl className="revenue-console__rows">
        <div className="revenue-console__row">
          <dt>Ownership</dt>
          <dd>Legal owner verified &middot; 2 co-owners on record</dd>
          <span className="revenue-chip revenue-chip--blue">Verified</span>
        </div>
        <div className="revenue-console__row">
          <dt>Transfer status</dt>
          <dd>Clear &middot; no open transfer paperwork</dd>
          <span className="revenue-chip revenue-chip--blue">Clear</span>
        </div>
        <div className="revenue-console__row">
          <dt>Compliance</dt>
          <dd>Registration renewal deadline in 12 days</dd>
          <span className="revenue-chip revenue-chip--amber">Due soon</span>
        </div>
        <div className="revenue-console__row">
          <dt>Documents</dt>
          <dd>14 approved &middot; 2 awaiting OCR review</dd>
          <span className="revenue-chip revenue-chip--neutral">In review</span>
        </div>
        <div className="revenue-console__row">
          <dt>Sale packet</dt>
          <dd>Approved documents bundled &middot; watermark applied</dd>
          <span className="revenue-chip revenue-chip--blue">Ready</span>
        </div>
      </dl>
      <figcaption className="revenue-console__audit">
        <span className="revenue-console__audit-label">Audit log</span>
        Ownership verification recorded by R. Calloway &middot; 2 min ago
      </figcaption>
    </figure>
  );
}

export default function Landing() {
  const navigate = useNavigate();
  const session = useCloudStore((state) => state.session);

  useEffect(() => {
    if (session) navigate('/', { replace: true });
  }, [session, navigate]);

  const trackCta = (placement: string, destination: string) => {
    void trackRuntimeEvent(productEvent(productEventNames.landingCtaClicked, { placement, destination }));
  };
  const trackPlan = (tier: SubscriptionTier) => {
    void trackRuntimeEvent(productEvent(productEventNames.landingPlanSelected, { tier, source: 'landing' }));
  };

  return (
    <main className="revenue-landing">
      <header className="revenue-nav">
        <Link to="/landing" aria-label="XBAR home" className="revenue-nav__home">
          <Wordmark />
        </Link>
        <nav className="revenue-nav__actions" aria-label="Account">
          <Link className="public-action public-action--quiet" to="/login" onClick={() => trackCta('navigation', '/login')}>
            Sign in
          </Link>
          <Link className="public-action public-action--primary" to={signupPath('Professional')} onClick={() => trackPlan('Professional')}>
            Create your workspace
          </Link>
        </nav>
      </header>

      <section className="revenue-hero" aria-labelledby="hero-heading">
        <div className="revenue-hero__copy">
          <p className="revenue-kicker">Built for performance horse operations</p>
          <h1 id="hero-heading">Clean records. Ownership integrity. Faster sale readiness.</h1>
          <p className="revenue-hero__lead">
            XBAR turns scattered paperwork, ownership details, and horse documentation into trusted, buyer-ready digital records &mdash; with OCR-assisted intake, compliance deadlines, and watermarked sale packets in one system.
          </p>
          <div className="revenue-hero__actions">
            <Link className="public-action public-action--primary" to={signupPath('Professional')} onClick={() => trackPlan('Professional')}>
              Create your workspace
            </Link>
            <Link className="public-action" to="/login" onClick={() => trackCta('hero', '/login')}>
              Sign in
            </Link>
          </div>
          <ul className="revenue-proof-line">
            <li>Local-first workspace</li>
            <li>Human review before records are final</li>
            <li>Records stay intact across plans</li>
          </ul>
        </div>
        <CommandPreview />
      </section>

      <section className="revenue-section" aria-labelledby="pipeline-heading">
        <div className="revenue-section__header">
          <div>
            <p className="revenue-kicker">One path for every document</p>
            <h2 id="pipeline-heading">From paperwork to proof, in five steps.</h2>
          </div>
          <p>Every file moves through one pipeline: upload, local OCR, human review, ownership proof, then watermarked sharing. No shortcuts, no untracked copies.</p>
        </div>
        <ol className="revenue-pipeline">
          {pipeline.map((item, index) => (
            <li className="revenue-pipeline__step" key={item.step}>
              <span className="revenue-pipeline__index">{String(index + 1).padStart(2, '0')}</span>
              <strong>{item.step}</strong>
              <p>{item.copy}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="revenue-section revenue-section--bordered" aria-labelledby="pillars-heading">
        <div className="revenue-section__inner">
          <div className="revenue-section__header">
            <div>
              <p className="revenue-kicker">What operators pay for</p>
              <h2 id="pillars-heading">Built around the workflows that cost horse businesses time and money.</h2>
            </div>
            <p>XBAR is not trying to be every kind of horse software. It is designed to solve the record, paperwork, and buyer-confidence problems that directly affect operations and sales.</p>
          </div>
          <div className="revenue-pillars">
            {pillars.map((pillar) => (
              <article className="revenue-pillar" key={pillar.title}>
                <h3>{pillar.title}</h3>
                <p>{pillar.copy}</p>
                <ul>
                  {pillar.details.map((detail) => (
                    <li key={detail}>{detail}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="revenue-section" aria-labelledby="pain-heading">
        <div className="revenue-pain">
          <div className="revenue-pain__copy">
            <p className="revenue-kicker">Why now</p>
            <h2 id="pain-heading">Most horse businesses still run critical records through email, folders, binders, and memory.</h2>
            <p>That works until a buyer asks for documentation, ownership details need to be verified, or transfer paperwork slows down a sale. XBAR reduces that chaos and gives your team one trusted operational record for every horse.</p>
          </div>
          <ul className="revenue-pain__list">
            {painPoints.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="revenue-section revenue-section--bordered" aria-labelledby="trust-heading">
        <div className="revenue-section__inner">
          <div className="revenue-section__header">
            <div>
              <p className="revenue-kicker">Trust is a product feature</p>
              <h2 id="trust-heading">Designed for records people rely on.</h2>
            </div>
            <p>Horse operations need software that is clear about what is known, what is missing, and what can safely be shared.</p>
          </div>
          <div className="revenue-trust-grid">
            {trustPoints.map((point) => (
              <article className="revenue-trust-card" key={point.title}>
                <h3>{point.title}</h3>
                <p>{point.copy}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="revenue-section" aria-labelledby="pricing-heading">
        <div className="revenue-section__header">
          <div>
            <p className="revenue-kicker">Pricing</p>
            <h2 id="pricing-heading">Built for operations where paperwork has real financial consequences.</h2>
          </div>
          <p>Every plan protects the core horse record. Higher levels add collaboration, shared access, and substantially more document and storage capacity.</p>
        </div>
        <div className="revenue-plan-grid">
          {tiers.map((tier) => {
            const plan = subscriptionPlans[tier];
            const featured = tier === 'Professional';
            return (
              <article className={`revenue-plan${featured ? ' revenue-plan--featured' : ''}`} key={tier}>
                {featured && <span className="revenue-plan__badge">Most chosen</span>}
                <h3>{tier}</h3>
                <p className="revenue-plan__fit">{planFit[tier]}</p>
                <p className="revenue-plan__price">
                  ${plan.monthlyRate}
                  <span className="revenue-plan__cadence">/month</span>
                </p>
                <ul>
                  {plan.featureFlags.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
                <Link
                  className={`public-action${featured ? ' public-action--primary' : ''}`}
                  to={signupPath(tier)}
                  onClick={() => trackPlan(tier)}
                >
                  Choose {tier}
                </Link>
              </article>
            );
          })}
        </div>
      </section>

      <section className="revenue-section revenue-section--bordered" aria-labelledby="faq-heading">
        <div className="revenue-section__inner">
          <div className="revenue-section__header">
            <div>
              <p className="revenue-kicker">Before you commit</p>
              <h2 id="faq-heading">Clear answers for an essential workspace.</h2>
            </div>
          </div>
          <div className="revenue-faq-grid">
            {questions.map((item) => (
              <article className="revenue-faq" key={item.question}>
                <h3>{item.question}</h3>
                <p>{item.answer}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="revenue-cta" aria-labelledby="cta-heading">
        <p className="revenue-kicker">See whether XBAR fits your operation</p>
        <h2 id="cta-heading">Give every horse a record buyers can trust.</h2>
        <p>Start with the records you already have. XBAR shows what is complete, what needs verification, and what is ready to share.</p>
        <div className="revenue-cta__actions">
          <Link className="public-action public-action--primary" to={signupPath('Professional')} onClick={() => trackPlan('Professional')}>
            Create your workspace
          </Link>
          <Link className="public-action" to="/login" onClick={() => trackCta('closing', '/login')}>
            Sign in
          </Link>
        </div>
      </section>

      <footer className="revenue-footer">
        <p>XBAR &middot; Records, ownership, and sale readiness for performance horse operations.</p>
        <nav aria-label="Legal">
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
        </nav>
      </footer>
    </main>
  );
}

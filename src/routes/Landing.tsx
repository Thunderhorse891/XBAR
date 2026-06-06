import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { productEvent, productEventNames } from '@/lib/productEvents';
import { trackRuntimeEvent } from '@/lib/runtimeEvents';
import { subscriptionPlans } from '@/lib/subscriptionPlans';
import { useCloudStore } from '@/store/useCloudStore';
import type { SubscriptionTier } from '@/types/xbar';
import './authExperience.css';
import './landingExperience.css';

const tiers: SubscriptionTier[] = ['Starter', 'Professional', 'Ranch Ops', 'Enterprise'];
const planFit: Record<SubscriptionTier, string> = {
  Starter: 'For an owner creating one dependable source of truth.',
  Professional: 'For programs coordinating buyers, listings, and a small team.',
  'Ranch Ops': 'For working operations managing care, breeding, assets, and spend.',
  Enterprise: 'For larger groups that need substantially more operating capacity.',
};
const outcomes = [
  { number: '01', title: 'Build a defensible horse record', copy: 'Identity, ownership, care, documents, and history stay connected to the horse instead of scattered across phones and folders.', details: ['See what is missing', 'Keep source documents attached', 'Preserve a usable history'] },
  { number: '02', title: 'Know what needs action', copy: 'XBAR turns dates, transfer gaps, document review, and follow-ups into a visible operating queue.', details: ['Surface due care', 'Flag ownership risk', 'Keep buyer follow-ups moving'] },
  { number: '03', title: 'Share without oversharing', copy: 'Prepare buyer-ready horse profiles from approved information while protecting internal records and operating notes.', details: ['Approve before sharing', 'Create sale-ready profiles', 'Keep internal files private'] },
];
const trustPoints = [
  { title: 'Source-record discipline', copy: 'Unknown data stays unknown until a person verifies it. XBAR is designed to support decisions, not invent certainty.' },
  { title: 'Local-first continuity', copy: 'The workspace remains useful in the browser, with backup and restore controls for operational resilience.' },
  { title: 'Controlled buyer access', copy: 'Shared profiles are built from approved records so the public view does not become the internal workspace.' },
];
const questions = [
  { question: 'Can I start before cloud sync is configured?', answer: 'Yes. XBAR has a local-first workspace so you can evaluate the operating system and begin organizing records before enabling cloud services.' },
  { question: 'What happens to my records if I change plans?', answer: 'Your records stay intact. Plans change capacity and collaboration access; they do not erase the operating history you built.' },
  { question: 'Is XBAR only for large ranches?', answer: 'No. Starter is designed for an independent owner. Professional and Ranch Ops add the collaboration, sale-readiness, and operating capacity larger programs need.' },
  { question: 'How does checkout work?', answer: 'A workspace owner reviews the plan inside XBAR and completes the plan change through secure Stripe checkout when billing is configured.' },
];

const signupPath = (plan?: SubscriptionTier) => `/login?mode=signup${plan ? `&plan=${encodeURIComponent(plan)}` : ''}`;

function Wordmark() {
  return <span className="xbar-wordmark"><span className="xbar-wordmark__mark">X</span><span className="xbar-wordmark__copy"><strong>XBAR</strong><span>Ranch operations</span></span></span>;
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

  return <main className="revenue-landing">
    <nav className="revenue-nav">
      <Link to="/landing" aria-label="XBAR home"><Wordmark /></Link>
      <div className="revenue-nav__actions">
        <Link className="public-action public-action--quiet" to="/login" onClick={() => trackCta('navigation', '/login')}>Sign in</Link>
        <Link className="public-action public-action--primary" to={signupPath('Ranch Ops')} onClick={() => trackPlan('Ranch Ops')}>Build your workspace</Link>
      </div>
    </nav>

    <section className="revenue-hero">
      <div className="revenue-hero__copy">
        <p className="revenue-kicker">The operating system for modern horse operations</p>
        <h1>Run the ranch from proof, not memory.</h1>
        <p className="revenue-hero__lead">XBAR connects every horse, source document, care obligation, ownership record, expense, and buyer-ready detail in one command center.</p>
        <div className="revenue-hero__actions">
          <Link className="public-action public-action--primary" to={signupPath('Ranch Ops')} onClick={() => trackPlan('Ranch Ops')}>Build your operation</Link>
          <Link className="public-action" to="/login" onClick={() => trackCta('hero', '/login')}>Open the command center</Link>
        </div>
        <div className="revenue-proof-line"><span>Local-first workspace</span><span>Secure plan checkout</span><span>Records remain intact across plans</span></div>
      </div>
      <div className="revenue-hero__visual" aria-label="XBAR metallic X brand mark">
        <div className="revenue-hero__status"><p className="revenue-kicker">Command principle</p><strong>One horse. One defensible record.</strong><span>See the documents, obligations, ownership, spend, and next action around the animal.</span></div>
      </div>
    </section>

    <section className="revenue-strip" aria-label="XBAR operating outcomes">
      <div><strong>Horse records</strong><span>Identity and history organized around the animal.</span></div>
      <div><strong>Document trust</strong><span>Source files attached, reviewed, and ready when needed.</span></div>
      <div><strong>Operational control</strong><span>Care, ownership, expenses, assets, and reminders visible.</span></div>
      <div><strong>Buyer readiness</strong><span>Approved records prepared for controlled sharing.</span></div>
    </section>

    <section className="revenue-section">
      <div className="revenue-section__header"><div><p className="revenue-kicker">From scattered work to operating control</p><h2>Built around the decisions that cost real time.</h2></div><p>XBAR is not another place to type data. It is the working record that helps an operation see risk, prepare proof, and move the next decision forward.</p></div>
      <div className="revenue-outcomes">{outcomes.map((outcome) => <article className="revenue-outcome" key={outcome.number}><span className="revenue-outcome__number">{outcome.number}</span><h3>{outcome.title}</h3><p>{outcome.copy}</p><ul>{outcome.details.map((detail) => <li key={detail}>{detail}</li>)}</ul></article>)}</div>
    </section>

    <section className="revenue-section revenue-section--bordered"><div className="revenue-section__inner">
      <div className="revenue-section__header"><div><p className="revenue-kicker">Trust is a product feature</p><h2>Designed for records people rely on.</h2></div><p>Horse operations need software that is clear about what is known, what is missing, and what can safely be shared.</p></div>
      <div className="revenue-trust-grid">{trustPoints.map((point) => <article className="revenue-trust-card" key={point.title}><strong>{point.title}</strong><span>{point.copy}</span></article>)}</div>
    </div></section>

    <section className="revenue-section">
      <div className="revenue-section__header"><div><p className="revenue-kicker">Choose the operating capacity</p><h2>Start where the operation is. Grow without rebuilding it.</h2></div><p>Every plan protects the core horse record. Higher levels add collaboration, sale-readiness, and substantially more capacity.</p></div>
      <div className="revenue-plan-grid">{tiers.map((tier) => { const plan = subscriptionPlans[tier]; const featured = tier === 'Ranch Ops'; return <article className={`revenue-plan${featured ? ' revenue-plan--featured' : ''}`} key={tier}>{featured && <span className="revenue-plan__badge">Working ranch choice</span>}<h3>{tier}</h3><p className="revenue-plan__fit">{planFit[tier]}</p><div className="revenue-plan__price">${plan.monthlyRate}<small>/month</small></div><ul>{plan.featureFlags.map((feature) => <li key={feature}>{feature}</li>)}</ul><Link className={`public-action${featured ? ' public-action--primary' : ''}`} to={signupPath(tier)} onClick={() => trackPlan(tier)}>Choose {tier}</Link></article>; })}</div>
    </section>

    <section className="revenue-section revenue-section--bordered"><div className="revenue-section__inner">
      <div className="revenue-section__header"><div><p className="revenue-kicker">Before you commit</p><h2>Clear answers for an essential workspace.</h2></div></div>
      <div className="revenue-faq-grid">{questions.map((item) => <article className="revenue-faq" key={item.question}><strong>{item.question}</strong><p>{item.answer}</p></article>)}</div>
    </div></section>

    <section className="revenue-cta"><p className="revenue-kicker">Build the operating record</p><h2>Give every horse a command file.</h2><p>Start with the records you already have. XBAR will show what is complete, what needs attention, and what is ready to move.</p><Link className="public-action public-action--primary" to={signupPath('Ranch Ops')} onClick={() => trackPlan('Ranch Ops')}>Build your XBAR workspace</Link></section>
    <footer className="revenue-footer">XBAR · Horse Management. Reimagined.</footer>
  </main>;
}

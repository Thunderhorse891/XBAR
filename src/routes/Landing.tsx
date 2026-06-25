import { useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCloudStore } from '@/store/useCloudStore';
import { isLocalModeEnabled } from '@/lib/platformConfig';
import { XbarMark } from '@/components/BrandMark';
import './authExperience.css';
import './landing.css';

const FEATURES = [
  {
    label: 'Complete Horse Records',
    desc: 'Every horse documented from day one. Registration, breeding history, training records — organized by animal, searchable in seconds.',
    wide: false,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <path d="M8 7h8M8 11h8M8 15h5" />
      </svg>
    ),
  },
  {
    label: 'Health & Care Tracking',
    desc: 'Coggins, vaccinations, vet visits, farrier schedules. Never miss a deadline or scramble for paperwork before a show or sale.',
    wide: false,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22C7.03 17.1 3 13.35 3 9.5 3 6.35 5.57 5 7.5 5c1.15 0 3.42.5 4.5 3.7C13.08 5.5 15.35 5 16.5 5 18.43 5 21 6.35 21 9.5c0 3.85-4.03 7.6-9 12.5z" />
      </svg>
    ),
  },
  {
    label: 'Ownership & Title Management',
    desc: 'Co-ownership splits, transfer history, lien documentation. Clean paper trails that protect you and your buyers at closing. Never lose track of who owns what.',
    wide: true,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l8 3v5c0 5-3.5 9.74-8 11-4.5-1.26-8-6-8-11V6l8-3z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    ),
  },
  {
    label: 'Document Vault',
    desc: 'Registration papers, bills of sale, test results, photos — stored, organized, and shareable from any device.',
    wide: false,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
        <path d="M12 11v6M9 14h6" />
      </svg>
    ),
  },
  {
    label: 'Instant Sale Packets',
    desc: 'One link gives buyers everything: health records, registration, photos, price. Professional packets that close deals faster.',
    wide: false,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="18" cy="5" r="3" />
        <circle cx="6" cy="12" r="3" />
        <circle cx="18" cy="19" r="3" />
        <path d="M8.59 13.51l6.83 3.98M15.41 6.51L8.59 10.49" />
      </svg>
    ),
  },
  {
    label: 'Budget & Expenses',
    desc: 'Track feed, vet, farrier, and training costs per horse. Know your real carrying costs before you set an asking price.',
    wide: false,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 20V10M18 20V4M6 20v-4" />
        <path d="M3 20h18" />
      </svg>
    ),
  },
];

const WORKFLOW = [
  {
    num: '01',
    title: 'Build your herd',
    desc: 'Add horses, upload registration papers, attach photos and documents. Takes minutes per animal. Import from existing spreadsheets or start fresh.',
  },
  {
    num: '02',
    title: 'Track what matters',
    desc: 'Log health events, ownership changes, and care records as they happen. Get reminders before deadlines — coggins, vaccinations, farrier visits.',
  },
  {
    num: '03',
    title: 'Close deals faster',
    desc: 'When a buyer is ready, share a branded sale packet in one link. All the proof they need, organized and professional, without a phone call.',
  },
];

const TESTIMONIALS = [
  {
    quote: 'We closed three sales faster because every buyer packet was already built. Buyers stopped asking for records — they already had everything.',
    name: 'K. Whitfield',
    role: 'Quarter Horse Ranch · TX',
    detail: '3 deals closed in first week',
  },
  {
    quote: 'Coggins tracking alone saved us a $1,200 penalty and a missed show weekend. It paid for itself the first month.',
    name: 'M. Delacroix',
    role: 'Performance Horse Operation · OK',
    detail: '$1,200 penalty avoided',
  },
  {
    quote: 'Finally a place where vet records, ownership docs, and sale info live together. I stopped using four different apps.',
    name: 'T. Brannagh',
    role: 'Barrel Racing Program · KS',
    detail: 'Replaced 4 separate tools',
  },
];

const PLANS = [
  {
    name: 'Starter',
    price: '$29',
    desc: 'Complete records for a solo operator or small hobby ranch.',
    specs: ['1 seat', '500 documents', '50 GB storage'],
    featured: false,
    cta: 'Get started free',
    ctaHref: '/login?mode=signup',
    highlight: ['Horse records & ownership', 'Health & care tracking', 'Document vault', 'Photo gallery & media', '14-day free trial'],
    features: [true, true, true, true, false, false, false, false, false, false],
  },
  {
    name: 'Professional',
    price: '$79',
    desc: 'Team-ready with sale listings and branded packets.',
    specs: ['5 seats', '1,000 documents', '100 GB storage'],
    featured: true,
    cta: 'Start free trial',
    ctaHref: '/login?mode=signup',
    highlight: ['Team roles & permissions', 'Sale listings & packets', 'Document sharing', 'Breeding program', 'Priority support'],
    features: [true, true, true, true, true, true, true, true, false, false],
  },
  {
    name: 'Ranch Ops',
    price: '$199',
    desc: 'Full ranch management — assets, breeding, and full team access.',
    specs: ['20 seats', '5,000 documents', '500 GB storage'],
    featured: false,
    cta: 'Get started free',
    ctaHref: '/login?mode=signup',
    highlight: ['Everything in Professional', 'Ranch assets & inventory', 'Advanced analytics', 'Multi-horse breeding tracking', 'Custom export & reporting'],
    features: [true, true, true, true, true, true, true, true, true, false],
  },
  {
    name: 'Enterprise',
    price: '$499',
    desc: 'Multi-operation, dedicated support, and custom integrations.',
    specs: ['60 seats', '20,000 documents', '2.5 TB storage'],
    featured: false,
    cta: 'Contact sales',
    ctaHref: 'mailto:sales@xbar.io?subject=Enterprise%20Plan%20Inquiry',
    highlight: ['Dedicated account manager', 'Custom integrations & API', '1-hour support SLA', 'Custom branding & white-label', 'Bulk data import & migration'],
    features: [true, true, true, true, true, true, true, true, true, true],
  },
];

const COMPARISON_ROWS = [
  'Horse records & ownership',
  'Health & care tracking',
  'Document vault',
  'Weather & ops notes',
  'Team roles & permissions',
  'Sale listings',
  'Branded sale packets',
  'Document sharing',
  'Ranch assets & breeding',
  'Custom integrations & priority support',
];

const STATS = [
  { value: '400', suffix: '+', label: 'Ranch Operations' },
  { value: '12000', suffix: '+', label: 'Horse Records', display: '12,000+' },
  { value: '22', suffix: '', label: 'States' },
  { value: '180', suffix: 'M+', label: 'In Verified Sales', prefix: '$' },
];

const PREVIEW_METRICS = [
  { value: '94%', label: 'Sale Ready' },
  { value: '13', label: 'Horses' },
  { value: '3', label: 'Alerts' },
  { value: 'Clear', label: 'Doc Risk' },
];

const PREVIEW_MODULES = [
  { name: 'Sale Readiness', tag: 'Ready', tone: 'emerald', detail: '12 of 13 horses cleared' },
  { name: 'Ownership Chain', tag: 'Verified', tone: 'blue', detail: 'All titles on file' },
  { name: 'Release Blocker', tag: 'Resolved', tone: 'emerald', detail: 'Transfer ready' },
  { name: 'Document Risk', tag: '1 Gap', tone: 'amber', detail: 'Coggins exp. in 18 days' },
];

const TICKER_ITEMS = [
  'Horse Records', 'Health Tracking', 'Document Vault', 'Sale Packets',
  'Ownership Transfer', 'Breeding Programs', 'Budget & Expenses', 'Team Roles',
  'Coggins Reminders', 'Farrier Schedules', 'Shared Access', 'Weather Ops',
];

const CHECK_ICON = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2.5 8l4 4 7-7" />
  </svg>
);

export default function Landing() {
  const navigate = useNavigate();
  const session = useCloudStore((state) => state.session);
  const srRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    if (session || isLocalModeEnabled()) {
      navigate('/', { replace: true });
    }
  }, [session, navigate]);

  // Scroll reveal
  useEffect(() => {
    const elements = document.querySelectorAll('.sr');
    if (!elements.length) return;

    srRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('sr--visible');
            srRef.current?.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' },
    );

    elements.forEach((el) => srRef.current?.observe(el));

    return () => srRef.current?.disconnect();
  }, []);

  // Nav scroll state
  useEffect(() => {
    const nav = document.querySelector('.site-nav');
    if (!nav) return;

    const onScroll = () => {
      nav.classList.toggle('site-nav--scrolled', window.scrollY > 24);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const year = new Date().getFullYear();

  return (
    <div className="site-page">
      {/* Nav */}
      <nav className="site-nav" aria-label="Main navigation">
        <Link to="/landing" className="site-nav-brand" aria-label="XBAR home">
          <XbarMark tone="light" className="site-nav-logo" />
          <div>
            <div className="site-nav-brand-name">XBAR</div>
            <div className="site-nav-brand-sub">Ranch Platform</div>
          </div>
        </Link>
        <div className="site-nav-links">
          <a href="#features" className="site-nav-link">Features</a>
          <a href="#pricing" className="site-nav-link">Pricing</a>
          <Link to="/login" className="site-nav-signin">Sign in</Link>
        </div>
        <Link to="/login?mode=signup" className="site-nav-cta">
          Get started free
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 13, height: 13 }} aria-hidden="true">
            <path d="M3 8h10M9 4l4 4-4 4" />
          </svg>
        </Link>
      </nav>

      {/* Hero */}
      <section className="site-hero" aria-labelledby="hero-heading">
        {/* Horse contour watermark — sits between hero bg and content */}
        <div className="xbar-horse-watermark" aria-hidden="true">
          <svg viewBox="0 0 840 580" xmlns="http://www.w3.org/2000/svg" focusable="false">
            <g fill="currentColor">
              {/* Body */}
              <ellipse cx="462" cy="296" rx="202" ry="112" transform="rotate(-7 462 296)" />
              {/* Neck–body junction */}
              <ellipse cx="303" cy="226" rx="74" ry="54" transform="rotate(-52 303 226)" />
              {/* Neck */}
              <polygon points="268,248 340,216 286,126 214,165" />
              {/* Head */}
              <ellipse cx="196" cy="193" rx="72" ry="44" transform="rotate(-22 196 193)" />
              {/* Muzzle */}
              <ellipse cx="135" cy="223" rx="36" ry="26" transform="rotate(-12 135 223)" />
              {/* Ear */}
              <polygon points="212,153 229,117 253,148" />
              {/* Front legs */}
              <rect x="296" y="387" width="28" height="152" rx="13" />
              <rect x="336" y="387" width="28" height="145" rx="13" />
              {/* Hind legs */}
              <rect x="560" y="385" width="28" height="155" rx="13" />
              <rect x="598" y="385" width="28" height="148" rx="13" />
            </g>
            {/* Tail — fluid stroke */}
            <path d="M 652,258 C 698,230 733,206 738,173 C 743,140 722,117 696,113" fill="none" stroke="currentColor" strokeWidth="30" strokeLinecap="round" />
          </svg>
        </div>

        <div className="site-hero-bg" aria-hidden="true">
          <div className="site-hero-gradient" />
        </div>

        <div className="site-hero-wrap">
          {/* Left copy */}
          <div className="site-hero-copy">
            <div className="site-hero-badge sr" aria-hidden="true">
              Equine operations infrastructure
            </div>
            <h1 className="site-hero-h1 sr" data-delay="1" id="hero-heading">
              One trusted record<br />
              <span className="site-gradient-text">for every horse.</span>
            </h1>
            <p className="site-hero-sub sr" data-delay="2">
              Ownership, documents, care history, and sale readiness organized into a buyer-safe operating system for serious horse businesses.
            </p>
            <div className="site-hero-actions sr" data-delay="3">
              <Link to="/login?mode=signup" className="site-btn-primary">
                Create your workspace
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }} aria-hidden="true">
                  <path d="M3 8h10M9 4l4 4-4 4" />
                </svg>
              </Link>
              <Link to="/login" className="site-btn-ghost">Sign in</Link>
            </div>
            <div className="site-hero-trust sr" data-delay="4">
              <span>No credit card required</span>
              <span className="site-hero-trust-dot" aria-hidden="true" />
              <span>Cancel any time</span>
              <span className="site-hero-trust-dot" aria-hidden="true" />
              <span>End-to-end encrypted</span>
            </div>
          </div>

          {/* Right chrome */}
          <div className="site-chrome-wrap sr" data-delay="2">
            {/* Floating card A — top left */}
            <div className="site-float-card site-float-card--a" aria-hidden="true">
              <div className="site-fc-head">
                <div className="site-fc-dot" style={{ background: 'var(--emerald)' }} />
                <div className="site-fc-label">Live sync</div>
              </div>
              <div className="site-fc-value">94%</div>
              <div className="site-fc-sub">Docs ready to share</div>
              <div style={{ marginTop: '10px', display: 'flex', gap: '4px' }}>
                <div style={{ height: '3px', flex: 1, borderRadius: '99px', background: 'var(--emerald)', opacity: 0.9 }} />
                <div style={{ height: '3px', width: '18%', borderRadius: '99px', background: 'var(--border)' }} />
              </div>
            </div>

            {/* Floating card B — bottom right */}
            <div className="site-float-card site-float-card--b" aria-hidden="true">
              <div className="site-fc-head">
                <div className="site-fc-dot" />
                <div className="site-fc-label">This month</div>
              </div>
              <div className="site-fc-value">3</div>
              <div className="site-fc-sub">Sales closed</div>
            </div>

            <div
              className="site-chrome"
              role="img"
              aria-label="XBAR dashboard preview showing horse records, health alerts, and sale status"
            >
              <div className="site-chrome-bar" aria-hidden="true">
                <div className="site-chrome-dots">
                  <span /><span /><span />
                </div>
                <div className="site-chrome-url">xbar.io/dashboard</div>
              </div>
              <div className="site-chrome-body" aria-hidden="true">
                <div className="site-chrome-sidebar">
                  <div className="site-chrome-logo">
                    <XbarMark tone="color" className="site-chrome-logo-img" />
                    XBAR
                  </div>
                  {['Dashboard', 'Horses', 'Medical', 'Documents', 'Sales', 'Breeding'].map((item, i) => (
                    <div key={item} className={`site-chrome-nav-item${i === 0 ? ' site-chrome-nav-item--active' : ''}`}>
                      {item}
                    </div>
                  ))}
                </div>
                <div className="site-chrome-main">
                  <div className="site-chrome-topbar">
                    <span className="site-chrome-topbar-title">Dashboard</span>
                    <span className="site-chrome-topbar-ranch">Main Ranch</span>
                  </div>
                  <div className="site-chrome-metrics">
                    {PREVIEW_METRICS.map((m) => (
                      <div key={m.label} className="site-chrome-metric">
                        <div className="site-chrome-metric__value">{m.value}</div>
                        <div className="site-chrome-metric__label">{m.label}</div>
                      </div>
                    ))}
                  </div>
                  <div className="site-chrome-horse-list">
                    {PREVIEW_MODULES.map((m) => (
                      <div key={m.name} className="site-chrome-horse-row">
                        <div className={`site-chrome-module-dot site-chrome-module-dot--${m.tone}`} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="site-chrome-horse-name">{m.name}</div>
                          <div className="site-chrome-horse-detail">{m.detail}</div>
                        </div>
                        <div className={`site-chrome-horse-tag site-chrome-horse-tag--${m.tone}`}>{m.tag}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Ticker */}
      <div className="site-ticker-outer" aria-hidden="true">
        <div className="site-ticker-track">
          {[...TICKER_ITEMS, ...TICKER_ITEMS].map((item, i) => (
            <div key={`${item}-${i}`} className="site-ticker-item">
              {item}
              <span className="site-ticker-sep" />
            </div>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="site-stats-strip" role="list" aria-label="Platform statistics">
        {STATS.map((s) => (
          <div key={s.label} className="site-stat sr" role="listitem">
            <span className="site-stat-num" aria-label={s.display ?? `${s.prefix ?? ''}${s.value}${s.suffix}`}>
              {s.prefix ?? ''}{s.display ?? `${s.value}${s.suffix}`}
            </span>
            <span className="site-stat-label">{s.label}</span>
          </div>
        ))}
      </div>

      {/* Features — bento grid */}
      <section className="site-section" id="features" aria-labelledby="features-heading">
        <div className="site-section-inner">
          <div className="site-section-header">
            <div className="site-section-eyebrow sr">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 12, height: 12 }} aria-hidden="true">
                <rect x="2" y="2" width="5" height="5" rx="1" />
                <rect x="9" y="2" width="5" height="5" rx="1" />
                <rect x="2" y="9" width="5" height="5" rx="1" />
                <rect x="9" y="9" width="5" height="5" rx="1" />
              </svg>
              Platform Features
            </div>
            <h2 className="site-section-title sr" data-delay="1" id="features-heading">
              Everything an operation needs<br />to run tight.
            </h2>
            <p className="site-section-sub sr" data-delay="2">
              Built around how ranches actually work — not adapted from generic business software.
            </p>
          </div>

          <div className="site-bento">
            {FEATURES.map((f, i) => (
              <div
                key={f.label}
                className={`site-bento-cell sr${f.wide ? ' site-bento-cell--wide' : ''}`}
                data-delay={String((i % 3) + 1)}
              >
                <div className="site-bento-icon" aria-hidden="true">{f.icon}</div>
                <h3 className="site-bento-name">{f.label}</h3>
                <p className="site-bento-desc">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="site-section site-section--alt" aria-labelledby="workflow-heading">
        <div className="site-section-inner">
          <div className="site-section-header">
            <div className="site-section-eyebrow sr">How it works</div>
            <h2 className="site-section-title sr" data-delay="1" id="workflow-heading">
              Up and running<br />in under an hour.
            </h2>
            <p className="site-section-sub sr" data-delay="2">
              No training sessions, no implementation consultants. Just add horses and go.
            </p>
          </div>

          <div className="site-steps">
            {WORKFLOW.map((step, i) => (
              <div key={step.num} className={`site-step sr`} data-delay={String(i + 1)}>
                <div className="site-step-num">{step.num}</div>
                <h3 className="site-step-title">{step.title}</h3>
                <p className="site-step-desc">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Mid CTA */}
      <section className="site-mid-cta site-section" aria-label="Call to action">
        <div className="site-mid-cta-bg" aria-hidden="true" />
        <div className="site-mid-cta-orb" aria-hidden="true" />
        <div className="site-section-inner site-section-inner--tight">
          <div className="site-mid-cta-inner">
            <div className="site-mid-cta-copy sr">
              <div className="site-mid-cta-eyebrow">Ready to get organized?</div>
              <div className="site-mid-cta-headline">Join 400+ operations already running XBAR.</div>
            </div>
            <Link to="/login?mode=signup" className="site-btn-primary sr" data-delay="2">
              Get started free — no card required
            </Link>
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="site-section site-section--alt" aria-labelledby="testimonials-heading">
        <div className="site-section-inner">
          <div className="site-section-header">
            <div className="site-section-eyebrow sr">What ranchers say</div>
            <h2 className="site-section-title sr" data-delay="1" id="testimonials-heading">
              Used by operations<br />across the country.
            </h2>
          </div>

          <div className="site-testimonials">
            {TESTIMONIALS.map((t, i) => (
              <div key={t.name} className="site-testimonial sr" data-delay={String(i + 1)}>
                <div className="site-quote-mark" aria-hidden="true">"</div>
                <div className="site-stars" aria-label="5 stars">
                  {[0, 1, 2, 3, 4].map((idx) => (
                    <svg key={idx} className="site-star" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                      <path d="M8 1.25l1.91 3.87 4.27.62-3.09 3.01.73 4.25L8 10.77l-3.82 2.01.73-4.25L1.82 5.74l4.27-.62z" />
                    </svg>
                  ))}
                </div>
                <p className="site-testimonial-quote">{t.quote}</p>
                <div className="site-testimonial-result">{t.detail}</div>
                <div className="site-testimonial-author">
                  <div className="site-testimonial-avatar" aria-hidden="true">{t.name.charAt(0)}</div>
                  <div>
                    <div className="site-testimonial-name">{t.name}</div>
                    <div className="site-testimonial-role">{t.role}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="site-section" id="pricing" aria-labelledby="pricing-heading">
        <div className="site-section-inner">
          <div className="site-section-header">
            <div className="site-section-eyebrow sr">Pricing</div>
            <h2 className="site-section-title sr" data-delay="1" id="pricing-heading">
              Built for operations<br />of every size.
            </h2>
            <p className="site-section-sub sr" data-delay="2">
              Start free for 14 days. No credit card required. Every plan includes full horse records, care tracking, and document vault.
            </p>
          </div>

          <div className="mkt-pricing-grid sr" data-delay="1">
            {PLANS.map((plan) => (
              <div key={plan.name} className={`mkt-pricing-card${plan.featured ? ' mkt-pricing-card--featured' : ''}`}>
                {plan.featured && <div className="mkt-pricing-badge">Most popular</div>}
                <div className="mkt-pricing-tier">{plan.name}</div>
                <div className="mkt-pricing-amount">
                  <span className="mkt-pricing-price">{plan.price}</span>
                  <span className="mkt-pricing-period">/mo</span>
                </div>
                <p className="mkt-pricing-desc">{plan.desc}</p>
                <ul className="mkt-pricing-specs">
                  {plan.specs.map((s) => <li key={s}>{s}</li>)}
                </ul>
                {plan.highlight ? (
                  <ul className="mkt-pricing-highlights">
                    {plan.highlight.map((f) => (
                      <li key={f}>
                        <span className="mkt-pricing-check" aria-hidden="true">{CHECK_ICON}</span>
                        {f}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {plan.ctaHref.startsWith('mailto') ? (
                  <a
                    href={plan.ctaHref}
                    className={`mkt-pricing-cta${plan.featured ? ' mkt-pricing-cta--primary' : ''}`}
                  >
                    {plan.cta}
                  </a>
                ) : (
                  <Link
                    to={plan.ctaHref}
                    className={`mkt-pricing-cta${plan.featured ? ' mkt-pricing-cta--primary' : ''}`}
                  >
                    {plan.cta}
                  </Link>
                )}
              </div>
            ))}
          </div>

          <div className="mkt-comparison-wrap sr" data-delay="2">
            <div className="mkt-comparison-header">
              <div className="mkt-section-badge mkt-section-badge--flush">Full feature comparison</div>
            </div>
            <div className="mkt-comparison-scroll">
              <table className="mkt-comparison-table">
                <thead>
                  <tr>
                    <th className="mkt-cmp-feature-col" scope="col">Feature</th>
                    {PLANS.map((p) => (
                      <th key={p.name} className={p.featured ? 'mkt-cmp-featured-col' : ''} scope="col">{p.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON_ROWS.map((feat, fi) => (
                    <tr key={feat}>
                      <td className="mkt-cmp-feature-col">{feat}</td>
                      {PLANS.map((p) => (
                        <td key={p.name} className={p.featured ? 'mkt-cmp-featured-col' : ''}>
                          {p.features[fi] ? (
                            <svg className="mkt-cmp-check" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-label="Included">
                              <path d="M2.5 8l4 4 7-7" />
                            </svg>
                          ) : (
                            <svg className="mkt-cmp-cross" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-label="Not included">
                              <path d="M4 4l8 8M12 4l-8 8" />
                            </svg>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="site-final-cta site-section" aria-labelledby="final-cta-heading">
        <div className="site-final-cta-bg" aria-hidden="true" />
        <div className="site-section-inner">
          <div className="site-final-cta-inner">
            <h2 className="site-final-cta-title sr" id="final-cta-heading">
              Ready to run a tighter operation?
            </h2>
            <p className="site-final-cta-sub sr" data-delay="1">
              Start with a 14-day trial. No credit card required. Cancel any time.
            </p>
            <Link to="/login?mode=signup" className="site-btn-primary sr" data-delay="2">
              Get started free — 14 days
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }} aria-hidden="true">
                <path d="M3 8h10M9 4l4 4-4 4" />
              </svg>
            </Link>
            <div className="site-trust-chips sr" data-delay="3">
              <div className="site-trust-chip">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M8 2l5.5 2v3.5C13.5 11 11 13.8 8 15c-3-1.2-5.5-4-5.5-7.5V4L8 2z" />
                </svg>
                End-to-end encrypted
              </div>
              <div className="site-trust-chip">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="2" y="7" width="12" height="8" rx="1.5" />
                  <path d="M5 7V5a3 3 0 016 0v2" />
                </svg>
                No credit card needed
              </div>
              <div className="site-trust-chip">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13z" />
                  <path d="M8 5v3.5l2.5 1.5" />
                </svg>
                Cancel any time
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="site-footer">
        <div className="site-footer-inner">
          <div className="site-footer-brand">
            <div className="site-footer-brand-logo">
              <XbarMark tone="light" className="h-full w-full" />
            </div>
            <div>
              <div className="site-footer-brand-name">XBAR</div>
              <div className="site-footer-brand-sub">Ranch Platform</div>
            </div>
          </div>
          <div className="site-footer-links">
            <a href="#features">Features</a>
            <a href="#pricing">Pricing</a>
            <Link to="/terms">Terms of Service</Link>
            <Link to="/privacy">Privacy Policy</Link>
            <Link to="/login">Sign In</Link>
          </div>
        </div>
        <div className="site-footer-copy">© {year} XBAR LLC™ · All rights reserved</div>
      </footer>
    </div>
  );
}

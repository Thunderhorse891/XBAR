import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCloudStore } from '@/store/useCloudStore';
import { isLocalModeEnabled } from '@/lib/platformConfig';
import './authExperience.css';

const FEATURES = [
  {
    label: 'Complete Horse Records',
    desc: 'Every horse documented from day one. Registration, breeding history, training records — organized by animal, searchable in seconds.',
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
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22C7.03 17.1 3 13.35 3 9.5 3 6.35 5.57 5 7.5 5c1.15 0 3.42.5 4.5 3.7C13.08 5.5 15.35 5 16.5 5 18.43 5 21 6.35 21 9.5c0 3.85-4.03 7.6-9 12.5z" />
      </svg>
    ),
  },
  {
    label: 'Ownership & Title',
    desc: 'Co-ownership splits, transfer history, lien documentation. Clean paper trails that protect you and your buyers at closing.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l8 3v5c0 5-3.5 9.74-8 11-4.5-1.26-8-6-8-11V6l8-3z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    ),
  },
  {
    label: 'Document Vault',
    desc: 'Registration papers, bills of sale, test results, photos — stored, organized, and shareable from any device in seconds.',
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
  },
  {
    quote: 'Coggins tracking alone saved us a $1,200 penalty and a missed show weekend. It paid for itself the first month.',
    name: 'M. Delacroix',
    role: 'Performance Horse Operation · OK',
  },
  {
    quote: 'Finally a place where vet records, ownership docs, and sale info live together. I stopped using four different apps.',
    name: 'T. Brannagh',
    role: 'Barrel Racing Program · KS',
  },
];

const PLANS = [
  {
    name: 'Starter',
    price: '$29',
    desc: 'One operator, complete records.',
    specs: ['1 seat', '250 documents', '25 GB storage'],
    featured: false,
    cta: 'Get started',
    features: [true, true, true, true, false, false, false, false, false, false],
  },
  {
    name: 'Professional',
    price: '$79',
    desc: 'Team-ready with sale listings.',
    specs: ['5 seats', '1,000 documents', '100 GB storage'],
    featured: true,
    cta: 'Start free trial',
    features: [true, true, true, true, true, true, true, true, false, false],
  },
  {
    name: 'Ranch Ops',
    price: '$199',
    desc: 'Full ranch management suite.',
    specs: ['20 seats', '5,000 documents', '500 GB storage'],
    featured: false,
    cta: 'Get started',
    features: [true, true, true, true, true, true, true, true, true, false],
  },
  {
    name: 'Enterprise',
    price: '$499',
    desc: 'Multi-operation, custom integrations.',
    specs: ['60 seats', '20,000 documents', '2.5 TB storage'],
    featured: false,
    cta: 'Contact us',
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
  { value: '400+', label: 'Ranch Operations' },
  { value: '12,000+', label: 'Horse Records' },
  { value: '22', label: 'States' },
  { value: '$180M+', label: 'In Verified Sales' },
];

export default function Landing() {
  const navigate = useNavigate();
  const session = useCloudStore((state) => state.session);

  useEffect(() => {
    if (session || isLocalModeEnabled()) {
      navigate('/', { replace: true });
    }
  }, [session, navigate]);

  const year = new Date().getFullYear();

  return (
    <div className="mkt-page">
      {/* Nav */}
      <nav className="mkt-nav">
        <div className="mkt-nav-brand">
          <div className="lp-tagline">
            <strong>XBAR</strong>
            <span>Ranch Platform</span>
          </div>
        </div>
        <div className="mkt-nav-actions">
          <Link to="/login" className="mkt-nav-signin">Sign in</Link>
          <Link to="/login?mode=signup" className="mkt-nav-cta">Get started free</Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="mkt-hero">
        <div className="mkt-hero-badge">Purpose-built for working ranches</div>
        <h1 className="mkt-hero-h1">Horse records that<br />close deals.</h1>
        <p className="mkt-hero-sub">
          XBAR keeps ownership, health records, documents, and sale packets organized by horse — not by filing cabinet. When a buyer asks for proof, you're already ready.
        </p>
        <div className="mkt-hero-actions">
          <Link to="/login?mode=signup" className="mkt-hero-primary">Start your 14-day trial</Link>
          <Link to="/login" className="mkt-hero-ghost">Sign in to existing workspace</Link>
        </div>
        <div className="mkt-stats-bar">
          {STATS.map((s) => (
            <div key={s.label} className="mkt-stat">
              <strong className="mkt-stat-value">{s.value}</strong>
              <span className="mkt-stat-label">{s.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="mkt-section mkt-section--alt">
        <div className="mkt-section-inner">
          <div className="mkt-section-header">
            <div className="mkt-section-badge">Features</div>
            <h2 className="mkt-section-title">Everything an operation needs to run tight.</h2>
            <p className="mkt-section-sub">Built around how ranches actually work — not adapted from generic business software.</p>
          </div>
          <div className="mkt-features-grid">
            {FEATURES.map((f) => (
              <div key={f.label} className="mkt-feature-card">
                <div className="mkt-feature-icon">{f.icon}</div>
                <h3 className="mkt-feature-name">{f.label}</h3>
                <p className="mkt-feature-desc">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="mkt-section">
        <div className="mkt-section-inner">
          <div className="mkt-section-header">
            <div className="mkt-section-badge">How it works</div>
            <h2 className="mkt-section-title">Up and running in under an hour.</h2>
            <p className="mkt-section-sub">No training sessions, no implementation consultants. Just add horses and go.</p>
          </div>
          <div className="mkt-workflow-steps">
            {WORKFLOW.map((step) => (
              <div key={step.num} className="mkt-step">
                <div className="mkt-step-num">{step.num}</div>
                <h3 className="mkt-step-name">{step.title}</h3>
                <p className="mkt-step-desc">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="mkt-section mkt-section--alt">
        <div className="mkt-section-inner">
          <div className="mkt-section-header">
            <div className="mkt-section-badge">What ranchers say</div>
            <h2 className="mkt-section-title">Used by operations across the country.</h2>
          </div>
          <div className="mkt-testimonials-grid">
            {TESTIMONIALS.map((t) => (
              <div key={t.name} className="mkt-testimonial-card">
                <div className="mkt-testimonial-stars">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <svg key={i} className="mkt-star" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M8 1.25l1.91 3.87 4.27.62-3.09 3.01.73 4.25L8 10.77l-3.82 2.01.73-4.25L1.82 5.74l4.27-.62z" />
                    </svg>
                  ))}
                </div>
                <p className="mkt-testimonial-quote">"{t.quote}"</p>
                <div className="mkt-testimonial-author">
                  <div className="mkt-testimonial-avatar">{t.name.charAt(0)}</div>
                  <div>
                    <div className="mkt-testimonial-name">{t.name}</div>
                    <div className="mkt-testimonial-role">{t.role}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="mkt-section" id="pricing">
        <div className="mkt-section-inner">
          <div className="mkt-section-header">
            <div className="mkt-section-badge">Pricing</div>
            <h2 className="mkt-section-title">Built for operations of every size.</h2>
            <p className="mkt-section-sub">Start free for 14 days. No credit card required. Every plan includes full horse records, care tracking, and document vault.</p>
          </div>

          <div className="mkt-pricing-grid">
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
                <Link
                  to="/login?mode=signup"
                  className={`mkt-pricing-cta${plan.featured ? ' mkt-pricing-cta--primary' : ''}`}
                >
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>

          <div className="mkt-comparison-wrap">
            <div className="mkt-comparison-header">
              <div className="mkt-section-badge" style={{ margin: 0 }}>Full feature comparison</div>
            </div>
            <div className="mkt-comparison-scroll">
              <table className="mkt-comparison-table">
                <thead>
                  <tr>
                    <th className="mkt-cmp-feature-col">Feature</th>
                    {PLANS.map((p) => (
                      <th key={p.name} className={p.featured ? 'mkt-cmp-featured-col' : ''}>{p.name}</th>
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
                            <svg className="mkt-cmp-check" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M2.5 8l4 4 7-7" />
                            </svg>
                          ) : (
                            <svg className="mkt-cmp-cross" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
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
      <section className="mkt-cta-section">
        <div className="mkt-section-inner">
          <h2 className="mkt-cta-title">Ready to run a tighter operation?</h2>
          <p className="mkt-cta-sub">Start with a 14-day trial. No credit card required. Cancel any time.</p>
          <Link to="/login?mode=signup" className="mkt-hero-primary" style={{ display: 'inline-flex' }}>
            Start free trial
          </Link>
          <div className="mkt-trust-row">
            <span>End-to-end encrypted</span>
            <span>·</span>
            <span>No credit card needed</span>
            <span>·</span>
            <span>Cancel any time</span>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="mkt-footer">
        <div className="mkt-footer-inner">
          <div className="lp-tagline">
            <strong>XBAR</strong>
            <span>Ranch Platform</span>
          </div>
          <div className="mkt-footer-links">
            <Link to="/terms">Terms of Service</Link>
            <Link to="/privacy">Privacy Policy</Link>
            <Link to="/login">Sign In</Link>
          </div>
        </div>
        <div className="mkt-footer-copy">© {year} XBAR LLC™ · All rights reserved</div>
      </footer>
    </div>
  );
}

import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCloudStore } from '@/store/useCloudStore';
import { isLocalModeEnabled, isSupabaseConfigured } from '@/lib/platformConfig';
import './authExperience.css';

const features = [
  { label: 'Horse Records', icon: '🐴' },
  { label: 'Health & Care', icon: '💉' },
  { label: 'Document Vault', icon: '📄' },
  { label: 'Ownership & Title', icon: '📋' },
  { label: 'Sale Listings', icon: '🔗' },
  { label: 'Budget Ledger', icon: '💰' },
];

const testimonials = [
  { quote: 'We closed three sales faster because every buyer packet was already built.', name: 'K. Whitfield', role: 'Quarter Horse Ranch, TX' },
  { quote: 'Coggins tracking alone saved us a penalty on a show weekend.', name: 'M. Delacroix', role: 'Performance Horse Operation, OK' },
  { quote: 'Finally a place where vet records, ownership docs, and sale info live together.', name: 'T. Brannagh', role: 'Barrel Racing Program, KS' },
];

export default function Landing() {
  const navigate = useNavigate();
  const session = useCloudStore((state) => state.session);

  useEffect(() => {
    if (session || isLocalModeEnabled()) {
      navigate('/', { replace: true });
    }
  }, [session, navigate]);

  if (!isSupabaseConfigured() && !isLocalModeEnabled()) {
    navigate('/login', { replace: true });
    return null;
  }

  return (
    <div className="lp-shell" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 0 }}>
      {/* Nav */}
      <nav style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '0 clamp(16px, 4vw, 48px)',
        height: '60px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(2,4,8,0.9)',
        backdropFilter: 'blur(12px)',
        position: 'sticky',
        top: 0,
        zIndex: 40,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div className="lp-tagline">
            <strong>XBAR</strong>
            <span>Ranch Platform</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <Link to="/login" className="lp-card-sub" style={{ padding: '8px 16px', color: 'rgba(175,200,228,0.65)' }}>Sign in</Link>
          <Link to="/login?mode=signup" style={{
            padding: '8px 18px',
            borderRadius: '6px',
            background: 'rgba(45,111,255,0.85)',
            color: '#fff',
            fontSize: '13px',
            fontWeight: 700,
            letterSpacing: '0.02em',
            border: '1px solid rgba(80,140,255,0.35)',
          }}>
            Get started free
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'clamp(60px,8vw,120px) clamp(16px,4vw,48px)',
        textAlign: 'center',
        background: 'radial-gradient(ellipse 60% 45% at 50% 10%, rgba(12,62,148,0.22) 0, transparent 55%), #020406',
      }}>
        <div className="lp-card-label" style={{ marginBottom: '14px' }}>Built for working ranches</div>
        <h1 style={{
          margin: '0 0 18px',
          fontSize: 'clamp(2rem, 5.5vw, 4rem)',
          fontWeight: 800,
          lineHeight: 1.0,
          letterSpacing: '-0.055em',
          color: '#e8f2ff',
          maxWidth: '14ch',
        }}>
          Horse records that close deals.
        </h1>
        <p style={{
          margin: '0 0 36px',
          fontSize: 'clamp(14px, 1.5vw, 17px)',
          color: 'rgba(155,182,214,0.68)',
          maxWidth: '52ch',
          lineHeight: 1.65,
        }}>
          XBAR tracks ownership, health, documents, and sale packets for every horse in your operation. When a prospect asks for proof, you're already ready.
        </p>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
          <Link to="/login?mode=signup" style={{
            display: 'inline-flex',
            alignItems: 'center',
            height: '46px',
            padding: '0 28px',
            borderRadius: '8px',
            background: 'linear-gradient(180deg, #4880ff 0%, #2D6FFF 100%)',
            color: '#fff',
            fontSize: '15px',
            fontWeight: 700,
            letterSpacing: '0.01em',
            border: '1px solid rgba(80,140,255,0.4)',
            boxShadow: '0 4px 16px rgba(45,111,255,0.35)',
            textDecoration: 'none',
          }}>
            Start your 14-day trial
          </Link>
          <Link to="/login" style={{
            display: 'inline-flex',
            alignItems: 'center',
            height: '46px',
            padding: '0 24px',
            borderRadius: '8px',
            background: 'rgba(255,255,255,0.05)',
            color: 'rgba(175,210,245,0.8)',
            fontSize: '15px',
            fontWeight: 600,
            border: '1px solid rgba(255,255,255,0.09)',
            textDecoration: 'none',
          }}>
            Sign in to existing workspace
          </Link>
        </div>

        {/* Feature grid */}
        <div className="lp-features" style={{ marginTop: '52px', maxWidth: '680px' }}>
          {features.map((f) => (
            <div key={f.label} className="lp-feature">
              <span style={{ fontSize: '20px' }}>{f.icon}</span>
              {f.label}
            </div>
          ))}
        </div>
      </section>

      {/* Social proof */}
      <section style={{
        padding: 'clamp(40px,6vw,80px) clamp(16px,4vw,48px)',
        background: '#03050a',
        borderTop: '1px solid rgba(255,255,255,0.05)',
      }}>
        <div style={{
          maxWidth: '1080px',
          margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: '24px',
        }}>
          {testimonials.map((t) => (
            <div key={t.name} style={{
              padding: '22px 24px',
              borderRadius: '10px',
              border: '1px solid rgba(255,255,255,0.07)',
              background: 'rgba(255,255,255,0.025)',
            }}>
              <p style={{
                margin: '0 0 16px',
                fontSize: '14px',
                color: 'rgba(185,210,238,0.72)',
                lineHeight: 1.6,
                fontStyle: 'italic',
              }}>
                "{t.quote}"
              </p>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 700, color: 'rgba(200,225,255,0.85)' }}>{t.name}</div>
                <div style={{ fontSize: '11px', color: 'rgba(130,165,200,0.5)', marginTop: '2px' }}>{t.role}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section style={{
        padding: 'clamp(48px,7vw,96px) clamp(16px,4vw,48px)',
        background: '#020406',
        borderTop: '1px solid rgba(255,255,255,0.05)',
      }}>
        <div style={{ maxWidth: '1080px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '48px' }}>
            <div className="lp-card-label">Pricing</div>
            <h2 style={{ margin: '8px 0 12px', fontSize: 'clamp(1.6rem,3.5vw,2.4rem)', fontWeight: 800, letterSpacing: '-0.05em', color: '#e8f2ff' }}>
              Built for operations of every size
            </h2>
            <p style={{ color: 'rgba(140,175,210,0.55)', fontSize: '14px', maxWidth: '42ch', margin: '0 auto' }}>
              Start free, scale when your operation grows. Every plan includes full horse records, care tracking, and document vault.
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '16px' }}>
            {[
              { name: 'Starter', price: '$29', period: '/mo', seats: '1 seat', docs: '250 documents', storage: '25 GB', highlight: false, cta: 'Get started' },
              { name: 'Professional', price: '$79', period: '/mo', seats: '5 seats', docs: '1,000 documents', storage: '100 GB', highlight: true, cta: 'Start free trial' },
              { name: 'Ranch Ops', price: '$199', period: '/mo', seats: '20 seats', docs: '5,000 documents', storage: '500 GB', highlight: false, cta: 'Get started' },
              { name: 'Enterprise', price: '$499', period: '/mo', seats: '60 seats', docs: '20,000 documents', storage: '2.5 TB', highlight: false, cta: 'Contact us' },
            ].map((plan) => (
              <div key={plan.name} style={{
                padding: '28px 24px',
                borderRadius: '12px',
                border: plan.highlight ? '1px solid rgba(80,140,255,0.4)' : '1px solid rgba(255,255,255,0.07)',
                background: plan.highlight ? 'rgba(45,111,255,0.12)' : 'rgba(255,255,255,0.025)',
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
              }}>
                {plan.highlight && (
                  <div style={{ position: 'absolute', top: '-12px', left: '50%', transform: 'translateX(-50%)', background: '#2D6FFF', color: '#fff', fontSize: '10px', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', padding: '4px 12px', borderRadius: '20px' }}>
                    Most popular
                  </div>
                )}
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: plan.highlight ? '#4a96ff' : 'rgba(130,165,200,0.6)', marginBottom: '6px' }}>{plan.name}</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '3px' }}>
                    <span style={{ fontSize: 'clamp(1.6rem,3vw,2.2rem)', fontWeight: 800, color: '#e8f2ff', letterSpacing: '-0.04em' }}>{plan.price}</span>
                    <span style={{ fontSize: '13px', color: 'rgba(140,175,210,0.5)' }}>{plan.period}</span>
                  </div>
                </div>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {[plan.seats, plan.docs, plan.storage].map((item) => (
                    <li key={item} style={{ fontSize: '13px', color: 'rgba(175,205,235,0.72)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ color: '#3cb97a', fontSize: '12px' }}>✓</span> {item}
                    </li>
                  ))}
                </ul>
                <Link to="/login?mode=signup" style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '40px',
                  borderRadius: '7px',
                  background: plan.highlight ? 'linear-gradient(180deg, #4880ff 0%, #2D6FFF 100%)' : 'rgba(255,255,255,0.06)',
                  color: plan.highlight ? '#fff' : 'rgba(175,210,245,0.8)',
                  fontSize: '13px',
                  fontWeight: 700,
                  border: plan.highlight ? '1px solid rgba(80,140,255,0.4)' : '1px solid rgba(255,255,255,0.09)',
                  textDecoration: 'none',
                  marginTop: 'auto',
                }}>
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA footer */}
      <section style={{
        padding: 'clamp(40px,6vw,72px) clamp(16px,4vw,48px)',
        textAlign: 'center',
        background: 'linear-gradient(180deg, #03050a 0%, #020406 100%)',
        borderTop: '1px solid rgba(255,255,255,0.05)',
      }}>
        <h2 style={{
          margin: '0 0 12px',
          fontSize: 'clamp(1.5rem, 3vw, 2.2rem)',
          fontWeight: 800,
          letterSpacing: '-0.05em',
          color: '#e8f2ff',
        }}>
          Ready to run a tighter operation?
        </h2>
        <p style={{ margin: '0 0 28px', color: 'rgba(140,175,210,0.55)', fontSize: '14px' }}>
          Start with a 14-day trial. No credit card required.
        </p>
        <Link to="/login?mode=signup" style={{
          display: 'inline-flex',
          alignItems: 'center',
          height: '46px',
          padding: '0 32px',
          borderRadius: '8px',
          background: 'linear-gradient(180deg, #4880ff 0%, #2D6FFF 100%)',
          color: '#fff',
          fontSize: '15px',
          fontWeight: 700,
          border: '1px solid rgba(80,140,255,0.4)',
          boxShadow: '0 4px 16px rgba(45,111,255,0.35)',
          textDecoration: 'none',
        }}>
          Start free trial
        </Link>
        <div style={{ marginTop: '28px', fontSize: '12px', color: 'rgba(100,140,180,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <span>© {new Date().getFullYear()} XBAR LLC™ · All rights reserved</span>
          <span>·</span>
          <Link to="/terms" style={{ color: 'rgba(100,160,255,0.55)', textDecoration: 'none' }}>Terms</Link>
          <span>·</span>
          <Link to="/privacy" style={{ color: 'rgba(100,160,255,0.55)', textDecoration: 'none' }}>Privacy</Link>
        </div>
      </section>
    </div>
  );
}

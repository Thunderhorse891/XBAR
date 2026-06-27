import { useNavigate } from 'react-router-dom';
import { XBAR_MAIN_LOGO_SRC } from '@/components/BrandMark';
import { AnimatedCounter, MiniBars, RadialGauge, Sparkline } from '@/components/dataviz/Charts';
import './firstRun.css';

/*
 * First-run / empty-workspace experience. Instead of a data dashboard full of
 * zeros and red "Hold" chips, a brand-new workspace gets a bold, premium
 * welcome: a dark hero stage, animated preview metrics (clearly sample data),
 * and a single guided path to the first real action. Everything is a real
 * call-to-action — no dead numbers.
 */

const STEPS = [
  {
    index: '01',
    title: 'Add your first horse',
    detail: 'Name, registration, owner of record — the spine every document and sale hangs on.',
    cta: 'Add a horse',
    to: '/horses?new=1',
  },
  {
    index: '02',
    title: 'Upload papers & Coggins',
    detail: 'Drop registration, transfer, and health PDFs. OCR reads them into the record automatically.',
    cta: 'Import documents',
    to: '/documents?upload=1',
  },
  {
    index: '03',
    title: 'Generate a buyer-safe packet',
    detail: 'Bundle proof of ownership, health, and provenance into one watermarked packet a buyer can trust.',
    cta: 'Open sales',
    to: '/sales',
  },
];

const VALUE_PROPS = [
  { k: 'Ownership proof chain', v: 'Every transfer, documented and verifiable.' },
  { k: 'Buyer-safe sale packets', v: 'Release nothing until the paperwork clears.' },
  { k: 'OCR document intake', v: 'Papers become structured records in seconds.' },
  { k: 'Margin intelligence', v: 'See the profit on every horse before you sell.' },
];

export default function FirstRunExperience({ ranchName, roleLabel }: { ranchName: string; roleLabel: string }) {
  const navigate = useNavigate();

  return (
    <section className="xbar-firstrun" aria-labelledby="xbar-firstrun-title">
      <header className="xbar-firstrun__topbar">
        <div className="xbar-firstrun__brand">
          <img src={XBAR_MAIN_LOGO_SRC} alt="XBAR" />
          <div>
            <span>XBAR</span>
            <strong>{ranchName}</strong>
            <em>{roleLabel}</em>
          </div>
        </div>
        <span className="xbar-firstrun__preview-tag">Live preview · sample data</span>
      </header>

      <div className="xbar-firstrun__hero xbar-firstrun__rise" style={{ animationDelay: '40ms' }}>
        <div className="xbar-firstrun__hero-copy">
          <p className="xbar-firstrun__eyebrow">Welcome to your workspace</p>
          <h1 id="xbar-firstrun-title">
            One trusted record<br />for every horse you sell.
          </h1>
          <p className="xbar-firstrun__sub">
            XBAR turns your stack of registration papers, Coggins, and transfer forms into buyer-ready
            horse records — so a sale closes on proof, not promises. Add your first horse to begin.
          </p>
          <div className="xbar-firstrun__hero-actions">
            <button type="button" className="xbar-firstrun__cta" onClick={() => navigate('/horses?new=1')}>
              Add your first horse
            </button>
            <button type="button" className="xbar-firstrun__cta xbar-firstrun__cta--ghost" onClick={() => navigate('/documents?upload=1')}>
              Import documents
            </button>
          </div>
        </div>

        <div className="xbar-firstrun__hero-viz" aria-hidden="true">
          <div className="xbar-firstrun__viz-gauge">
            <RadialGauge value={92} tone="blue" size={150} caption="Packet readiness" centerLabel="92%" />
          </div>
          <div className="xbar-firstrun__viz-spark">
            <span>Sale readiness trend</span>
            <Sparkline data={[38, 49, 57, 61, 70, 78, 86, 92]} tone="emerald" height={64} label="sample readiness trend" />
          </div>
        </div>
      </div>

      <div className="xbar-firstrun__stats">
        {[
          { label: 'Avg. days to buyer-ready', value: 6, suffix: 'd', tone: 'blue' as const, data: [14, 12, 11, 9, 8, 7, 6] },
          { label: 'Paperwork hours saved / mo', value: 18, suffix: 'h', tone: 'emerald' as const, data: [4, 7, 9, 12, 14, 16, 18] },
          { label: 'Sale-margin lift', value: 23, suffix: '%', tone: 'amber' as const, data: [6, 9, 11, 15, 18, 21, 23] },
        ].map((stat, i) => (
          <div className="xbar-firstrun__stat xbar-firstrun__rise" style={{ animationDelay: `${120 + i * 70}ms` }} key={stat.label}>
            <span className="xbar-firstrun__stat-label">{stat.label}</span>
            <strong className="xbar-firstrun__stat-value">
              <AnimatedCounter value={stat.value} />{stat.suffix}
            </strong>
            <Sparkline data={stat.data} tone={stat.tone} height={40} label={stat.label} />
          </div>
        ))}
      </div>

      <div className="xbar-firstrun__grid">
        <section className="xbar-firstrun__steps xbar-firstrun__rise" style={{ animationDelay: '180ms' }} aria-label="Get started">
          <h2>Get to your first buyer-ready horse</h2>
          <ol>
            {STEPS.map((step) => (
              <li key={step.index}>
                <span className="xbar-firstrun__step-index">{step.index}</span>
                <div className="xbar-firstrun__step-body">
                  <strong>{step.title}</strong>
                  <em>{step.detail}</em>
                </div>
                <button type="button" onClick={() => navigate(step.to)}>{step.cta}</button>
              </li>
            ))}
          </ol>
        </section>

        <section className="xbar-firstrun__preview xbar-firstrun__rise" style={{ animationDelay: '240ms' }} aria-label="What a finished record looks like">
          <header>
            <span>What a finished record looks like</span>
            <strong>Sample packet · Smart Lena Bar</strong>
          </header>
          <MiniBars
            label="sample packet completeness"
            data={[
              { label: 'AQHA', value: 100, tone: 'emerald' },
              { label: 'Transfer', value: 100, tone: 'emerald' },
              { label: 'Coggins', value: 100, tone: 'emerald' },
              { label: 'Health', value: 80, tone: 'blue' },
              { label: 'Photos', value: 60, tone: 'amber' },
            ]}
            height={120}
          />
          <ul className="xbar-firstrun__props">
            {VALUE_PROPS.map((prop) => (
              <li key={prop.k}>
                <strong>{prop.k}</strong>
                <em>{prop.v}</em>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </section>
  );
}

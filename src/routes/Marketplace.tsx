import { useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from '@/components/EmptyState';
import { HorseMediaPreview } from '@/components/HorseMediaPreview';
import { MetricCard, Panel, Pill, ProgressBar } from '@/components/app-ui';
import { sanitizeHorseForBuyerView } from '@/lib/publicShare';
import { buildHorsePacketCompleteness } from '@/lib/xbarPhaseTwo';
import { formatCompactCurrency, formatPercent } from '@/lib/format';
import { useUiStore } from '@/store/useUiStore';
import { useCurrentRoleCapability, useXbarStore } from '@/store/useXbarStore';

type SortKey = 'price-asc' | 'price-desc' | 'age-asc' | 'name';
type SexFilter = 'All' | 'Mare' | 'Stallion' | 'Gelding';

export default function Marketplace() {
  const horses = useXbarStore((state) => state.horses);
  const documents = useXbarStore((state) => state.documents);
  const salesLeads = useXbarStore((state) => state.salesLeads);
  const createSalesLead = useXbarStore((state) => state.createSalesLead);
  const pushToast = useUiStore((state) => state.pushToast);
  const canManageSales = useCurrentRoleCapability('manageSales');

  const [sexFilter, setSexFilter] = useState<SexFilter>('All');
  const [breedFilter, setBreedFilter] = useState('');
  const [sort, setSort] = useState<SortKey>('price-asc');
  const [inquiryHorseId, setInquiryHorseId] = useState<string | null>(null);
  const [inquiryName, setInquiryName] = useState('');
  const [inquiryError, setInquiryError] = useState('');

  const marketHorses = horses.filter((h) => h.sale.listingState === 'Market Ready');

  const breeds = [...new Set(marketHorses.map((h) => h.breed).filter(Boolean))].sort();

  const filtered = marketHorses
    .filter((h) => sexFilter === 'All' || h.sex === sexFilter)
    .filter((h) => !breedFilter || h.breed === breedFilter)
    .sort((a, b) => {
      if (sort === 'price-asc') return (a.sale.askPrice || 0) - (b.sale.askPrice || 0);
      if (sort === 'price-desc') return (b.sale.askPrice || 0) - (a.sale.askPrice || 0);
      if (sort === 'age-asc') return (a.age || 0) - (b.age || 0);
      return a.name.localeCompare(b.name);
    });

  const totalValue = marketHorses.reduce((sum, h) => sum + (h.sale.askPrice || 0), 0);
  const readyCount = marketHorses.filter((h) => h.readiness.packetStatus === 'Ready').length;
  const leadsCount = salesLeads.filter(
    (lead) => marketHorses.some((h) => h.id === lead.horseId) && lead.stage !== 'Closed',
  ).length;

  const sexFilters: SexFilter[] = ['All', 'Mare', 'Stallion', 'Gelding'];

  function submitInquiry() {
    if (!inquiryHorseId) return;
    if (!inquiryName.trim()) {
      setInquiryError('Buyer name is required.');
      return;
    }
    const result = createSalesLead({ horseId: inquiryHorseId, name: inquiryName.trim(), channel: 'Site Inquiry' });
    pushToast({
      title: result.ok ? 'Inquiry captured' : 'Could not capture inquiry',
      message: result.ok ? `Lead added for ${inquiryName.trim()}` : result.message,
      tone: result.ok ? 'success' : 'error',
    });
    if (result.ok) {
      setInquiryHorseId(null);
      setInquiryName('');
      setInquiryError('');
    }
  }

  return (
    <>
      <div className="surface-hero surface-hero--dark">
        <div className="surface-hero__top">
          <div>
            <span className="surface-hero__eyebrow">For Sale Board</span>
          </div>
          <div className="surface-hero__stats">
            <div className="surface-hero__stat">
              <span>Listed</span>
              <strong>{marketHorses.length}</strong>
            </div>
            <div className="surface-hero__stat">
              <span>Total ask</span>
              <strong>{formatCompactCurrency(totalValue)}</strong>
            </div>
            <div className="surface-hero__stat">
              <span>Packet ready</span>
              <strong style={{ color: readyCount === marketHorses.length && marketHorses.length > 0 ? 'var(--emerald)' : 'var(--amber)' }}>
                {readyCount}/{marketHorses.length}
              </strong>
            </div>
            <div className="surface-hero__stat">
              <span>Open leads</span>
              <strong>{leadsCount}</strong>
            </div>
          </div>
        </div>
      </div>

      <div className="metric-grid">
        <MetricCard label="Market ready" value={`${marketHorses.length}`} detail="Horses actively listed for sale" />
        <MetricCard label="Ask value" value={formatCompactCurrency(totalValue)} detail="Combined asking price of all listed horses" tone="blue" />
        <MetricCard label="Packet ready" value={`${readyCount}`} detail="Complete sale packets with verified documents" tone="emerald" />
        <MetricCard label="Open leads" value={`${leadsCount}`} detail="Active inquiries across listed horses" tone="amber" />
      </div>

      <Panel eyebrow="Listings" title="For sale">
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '16px', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '6px' }}>
            {sexFilters.map((f) => (
              <button
                key={f}
                className={`button button--ghost button--compact${sexFilter === f ? ' button--ghost--active' : ''}`}
                style={sexFilter === f ? { background: 'var(--blue-soft)', borderColor: 'var(--blue)', color: 'var(--blue)' } : {}}
                type="button"
                onClick={() => setSexFilter(f)}
              >
                {f}
              </button>
            ))}
          </div>
          {breeds.length > 0 && (
            <select
              className="field-input"
              value={breedFilter}
              onChange={(e) => setBreedFilter(e.target.value)}
              style={{ width: 'auto', minWidth: '140px' }}
            >
              <option value="">All breeds</option>
              {breeds.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          )}
          <select
            className="field-input"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            style={{ width: 'auto', minWidth: '160px', marginLeft: 'auto' }}
          >
            <option value="price-asc">Price: low to high</option>
            <option value="price-desc">Price: high to low</option>
            <option value="age-asc">Age: youngest first</option>
            <option value="name">Name A–Z</option>
          </select>
        </div>

        {filtered.length ? (
          <div className="marketplace-grid">
            {filtered.map((horse) => {
              const pub = sanitizeHorseForBuyerView(horse);
              const packet = buildHorsePacketCompleteness(horse, documents.filter((d) => d.horseId === horse.id));
              const openLeads = salesLeads.filter((l) => l.horseId === horse.id && l.stage !== 'Closed').length;
              const isInquiring = inquiryHorseId === horse.id;

              return (
                <div key={horse.id} className="marketplace-card">
                  <div className="marketplace-card__media">
                    <HorseMediaPreview
                      src={pub.profileImage}
                      name={pub.name}
                      imageClassName="marketplace-card__media-img"
                      fallbackClassName="marketplace-card__media-fallback"
                    />
                  </div>

                  <div className="marketplace-card__body">
                    <div className="marketplace-card__head">
                      <div>
                        <div className="marketplace-card__name">{pub.name}</div>
                        <div className="marketplace-card__sub">{pub.barnName ? `"${pub.barnName}" · ` : ''}{pub.breed} · {pub.sex} · {pub.age}y</div>
                      </div>
                      <div className="marketplace-card__price">
                        {pub.sale.askPrice ? formatCompactCurrency(pub.sale.askPrice) : 'Price on request'}
                      </div>
                    </div>

                    <div className="marketplace-card__facts">
                      <span>{pub.color}{pub.markings ? ` · ${pub.markings}` : ''}</span>
                      {pub.registry && <span>{pub.registry}</span>}
                      {pub.aqhaNumber && <span>{pub.aqhaNumber}</span>}
                      {pub.bloodline.sire && <span>By {pub.bloodline.sire}</span>}
                    </div>

                    <div className="marketplace-card__readiness">
                      <div className="marketplace-card__readiness-row">
                        <span>Sale packet</span>
                        <strong>{formatPercent(packet.score)}</strong>
                      </div>
                      <ProgressBar value={packet.score} tone={packet.tone} />
                    </div>

                    <div className="marketplace-card__meta">
                      <Pill tone={horse.readiness.packetStatus === 'Ready' ? 'emerald' : 'amber'}>
                        {horse.readiness.packetStatus}
                      </Pill>
                      {openLeads > 0 && <Pill tone="blue">{openLeads} {openLeads === 1 ? 'lead' : 'leads'}</Pill>}
                      {pub.gallery.length > 0 && <Pill tone="slate">{pub.gallery.length} photos</Pill>}
                    </div>

                    {isInquiring ? (
                      <div className="marketplace-card__inquiry" style={{ marginTop: '12px' }}>
                        <label className="field-stack" style={{ marginBottom: '8px' }}>
                          <span className="field-label">Buyer name</span>
                          <input
                            className="field-input"
                            placeholder="Full name"
                            value={inquiryName}
                            onChange={(e) => { setInquiryName(e.target.value); setInquiryError(''); }}
                            autoFocus
                          />
                          {inquiryError && <span className="field-error">{inquiryError}</span>}
                        </label>
                        <div className="inline-actions">
                          <button className="button button--primary button--compact" type="button" onClick={submitInquiry} disabled={!canManageSales}>
                            Capture inquiry
                          </button>
                          <button className="button button--ghost button--compact" type="button" onClick={() => { setInquiryHorseId(null); setInquiryName(''); setInquiryError(''); }}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="inline-actions" style={{ marginTop: '12px' }}>
                        <button
                          className="button button--primary button--compact"
                          type="button"
                          disabled={!canManageSales}
                          onClick={() => { setInquiryHorseId(horse.id); setInquiryName(''); setInquiryError(''); }}
                        >
                          Log inquiry
                        </button>
                        <Link
                          className="button button--ghost button--compact"
                          to={`/horses/${horse.id}`}
                        >
                          View record
                        </Link>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : marketHorses.length ? (
          <EmptyState compact title="No horses match this filter" description="Adjust the sex or breed filter to see more listings." />
        ) : (
          <EmptyState
            title="No horses listed for sale"
            description="Set a horse's listing state to Market Ready on its profile to show it here."
          />
        )}
      </Panel>

      <div className="dashboard-grid dashboard-grid--primary">
        <Panel eyebrow="Quick add" title="Log an inquiry">
          <p style={{ fontSize: '0.88rem', color: 'var(--muted)', marginBottom: '14px' }}>
            Use this when a buyer calls or walks in and you don't have their profile yet.
          </p>
          <div className="form-grid form-grid--tight">
            <label className="field-stack">
              <span className="field-label">Horse</span>
              <select
                className="field-input"
                value={inquiryHorseId ?? ''}
                onChange={(e) => setInquiryHorseId(e.target.value || null)}
                disabled={!canManageSales}
              >
                <option value="">Select a horse</option>
                {marketHorses.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name} — {h.sale.askPrice ? formatCompactCurrency(h.sale.askPrice) : 'Price TBD'}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-stack">
              <span className="field-label">Buyer name</span>
              <input
                className="field-input"
                placeholder="Full name"
                value={inquiryName}
                onChange={(e) => { setInquiryName(e.target.value); setInquiryError(''); }}
                disabled={!canManageSales}
              />
              {inquiryError && <span className="field-error">{inquiryError}</span>}
            </label>
          </div>
          <div className="inline-actions" style={{ marginTop: '10px' }}>
            <button
              className="button button--primary button--compact"
              type="button"
              disabled={!canManageSales}
              onClick={() => {
                if (!inquiryHorseId) { setInquiryError('Select a horse first.'); return; }
                submitInquiry();
              }}
            >
              Save inquiry
            </button>
          </div>
        </Panel>

        <Panel eyebrow="Pipeline" title="Recent leads">
          {salesLeads.filter((l) => marketHorses.some((h) => h.id === l.horseId)).length ? (
            <div className="stack-list">
              {salesLeads
                .filter((l) => marketHorses.some((h) => h.id === l.horseId))
                .slice(0, 6)
                .map((lead) => {
                  const horse = horses.find((h) => h.id === lead.horseId);
                  return (
                    <div key={lead.id} className="stack-item">
                      <div className="stack-item__top">
                        <div>
                          <div className="stack-item__title">{lead.name}</div>
                          <div className="stack-item__copy">{horse?.name} · {lead.channel}</div>
                        </div>
                        <Pill tone={lead.stage === 'Offer' ? 'emerald' : lead.stage === 'Closed' ? 'slate' : 'blue'}>
                          {lead.stage}
                        </Pill>
                      </div>
                    </div>
                  );
                })}
            </div>
          ) : (
            <EmptyState compact title="No leads yet" description="Inquiries captured here will appear in the pipeline." />
          )}
          <div className="inline-actions" style={{ marginTop: '12px' }}>
            <Link className="button button--ghost button--compact" to="/sales">
              Open full pipeline
            </Link>
          </div>
        </Panel>
      </div>
    </>
  );
}

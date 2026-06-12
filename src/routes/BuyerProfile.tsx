import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { EmptyState } from '@/components/EmptyState';
import { HorseMediaPreview } from '@/components/HorseMediaPreview';
import { SalePacketSlots } from '@/components/SalePacketSlots';
import { KeyValue, MetricCard, Panel, Pill } from '@/components/app-ui';
import { buildPublicShareUrl, openFacebookShareDialog } from '@/lib/facebookSharing';
import { formatCompactCurrency, formatPercent } from '@/lib/format';
import { apiConfig, isPublicShareLocalPreviewEnabled } from '@/lib/platformConfig';
import { loadPublicBuyerProfile, sanitizeDocumentForBuyerView, sanitizeHorseForBuyerView, sanitizeSharedListingForBuyerView, trackPublicBuyerProfileView, type PublicBuyerProfilePayload } from '@/lib/publicShare';
import { hasBuyerShareAccess } from '@/lib/workspaceAccess';
import { buildDocumentTrustProfile, buildHorsePacketCompleteness } from '@/lib/xbarPhaseTwo';
import { useUiStore } from '@/store/useUiStore';
import { useHorseRecord, useXbarStore } from '@/store/useXbarStore';


// Buyer deal-room actions: questions, call requests, and offers flow back to
// the seller — through the public API on real shared links, or straight into
// the workspace deal room during internal/local preview.
function BuyerActionPanel({
  sharePath,
  shareToken,
  source,
  onLocalLog,
}: {
  sharePath: string;
  shareToken: string;
  source: 'rpc' | 'local';
  onLocalLog: (input: { kind: 'question' | 'call-requested' | 'proof-requested' | 'offer'; actor: string; note?: string; amount?: number }) => void;
}) {
  const [mode, setMode] = useState<null | 'question' | 'call-requested' | 'proof-requested' | 'offer'>(null);
  const [buyerName, setBuyerName] = useState('');
  const [buyerEmail, setBuyerEmail] = useState('');
  const [message, setMessage] = useState('');
  const [amount, setAmount] = useState('');
  const [statusText, setStatusText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!mode) return;
    if (!buyerName.trim()) {
      setStatusText('Your name is required so the seller can respond.');
      return;
    }
    const offerAmount = Number(amount);
    if (mode === 'offer' && (!Number.isFinite(offerAmount) || offerAmount <= 0)) {
      setStatusText('Enter your offer amount.');
      return;
    }
    if ((mode === 'question' || mode === 'proof-requested') && !message.trim()) {
      setStatusText(mode === 'proof-requested' ? 'Describe the proof or document you want to review.' : 'Enter your question for the seller.');
      return;
    }
    setSubmitting(true);
    setStatusText('');

    if (source === 'local') {
      onLocalLog({
        kind: mode,
        actor: buyerName.trim(),
        note: [message.trim(), buyerEmail.trim() ? `Contact: ${buyerEmail.trim()}` : ''].filter(Boolean).join(' — ') || undefined,
        amount: mode === 'offer' ? offerAmount : undefined,
      });
      setSubmitting(false);
      setStatusText('Delivered to the seller. They will respond using your contact details.');
      setMode(null);
      return;
    }

    try {
      const base = apiConfig.baseUrl ? apiConfig.baseUrl.replace(/\/$/, '') : '';
      const response = await fetch(`${base}/api/buyer-inquiries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sharePath,
          shareToken,
          kind: mode,
          buyerName: buyerName.trim(),
          buyerEmail: buyerEmail.trim(),
          message: message.trim(),
          amount: mode === 'offer' ? offerAmount : undefined,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      setSubmitting(false);
      if (response.ok && payload.ok) {
        setStatusText(payload.message ?? 'Delivered to the seller.');
        setMode(null);
      } else {
        setStatusText(payload.message ?? 'Your message could not be delivered. Try again.');
      }
    } catch {
      setSubmitting(false);
      setStatusText('Your message could not be delivered. Check your connection and try again.');
    }
  };

  return (
    <Panel eyebrow="Interested?" title="Contact the seller">
      <div className="inline-actions" role="group" aria-label="Buyer actions">
        <button className={`button button--compact ${mode === 'question' ? 'button--primary' : 'button--ghost'}`} type="button" onClick={() => setMode('question')}>
          Ask a question
        </button>
        <button className={`button button--compact ${mode === 'call-requested' ? 'button--primary' : 'button--ghost'}`} type="button" onClick={() => setMode('call-requested')}>
          Request a call
        </button>
        <button className={`button button--compact ${mode === 'proof-requested' ? 'button--primary' : 'button--ghost'}`} type="button" onClick={() => setMode('proof-requested')}>
          Request proof
        </button>
        <button className={`button button--compact ${mode === 'offer' ? 'button--primary' : 'button--ghost'}`} type="button" onClick={() => setMode('offer')}>
          Submit an offer
        </button>
      </div>
      {mode && (
        <div className="form-grid form-grid--tight" style={{ marginTop: 12 }}>
          <label className="field-stack">
            <span className="field-label">Your name</span>
            <input className="field-input" value={buyerName} onChange={(event) => setBuyerName(event.target.value)} placeholder="John Smith" />
          </label>
          <label className="field-stack">
            <span className="field-label">Email or phone</span>
            <input className="field-input" value={buyerEmail} onChange={(event) => setBuyerEmail(event.target.value)} placeholder="you@example.com" />
          </label>
          {mode === 'offer' && (
            <label className="field-stack">
              <span className="field-label">Offer amount (USD)</span>
              <input className="field-input" type="number" min="1" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="15000" />
            </label>
          )}
          <label className="field-stack field-stack--wide">
            <span className="field-label">{mode === 'question' ? 'Your question' : mode === 'proof-requested' ? 'Proof or document requested' : mode === 'offer' ? 'Terms or notes (optional)' : 'Best time to call'}</span>
            <input
              className="field-input"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder={mode === 'question' ? 'Is she up to date on vaccinations?' : mode === 'proof-requested' ? 'Current Coggins and registration certificate' : 'Weekday afternoons'}
            />
          </label>
          <div className="inline-actions" style={{ gridColumn: '1/-1' }}>
            <button className="button button--primary button--compact" type="button" disabled={submitting} onClick={() => void submit()}>
              {submitting ? 'Sending…' : mode === 'offer' ? 'Send offer to seller' : 'Send to seller'}
            </button>
            <button className="button button--ghost button--compact" type="button" onClick={() => setMode(null)}>Cancel</button>
          </div>
        </div>
      )}
      {statusText && <p className="panel__description" role="status" style={{ marginTop: 10 }}>{statusText}</p>}
    </Panel>
  );
}

export default function BuyerProfile() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const localHorse = useHorseRecord(id);
  const pushToast = useUiStore((state) => state.pushToast);
  const documentsInWorkspace = useXbarStore((state) => state.documents);
  const localSharedListing = useXbarStore((state) => state.sharedListings.find((listing) => listing.horseId === id && listing.state !== 'Archived'));
  const logBuyerRoomEvent = useXbarStore((state) => state.logBuyerRoomEvent);
  const shareToken = searchParams.get('t')?.trim() ?? '';
  const localPreviewAllowed = isPublicShareLocalPreviewEnabled() && searchParams.get('preview') === 'local';
  const localAccessAllowed = hasBuyerShareAccess(localSharedListing, shareToken);
  const localDocuments = useMemo(
    () => documentsInWorkspace.filter((document) => document.horseId === id),
    [documentsInWorkspace, id],
  );

  // Sanitized local preview payload — only buyer-safe fields, never raw internal records.
  const localPayload = useMemo(
    () =>
      localPreviewAllowed && localHorse && localAccessAllowed
        ? {
            horse: sanitizeHorseForBuyerView(localHorse),
            documents: localDocuments.map(sanitizeDocumentForBuyerView),
            sharedListing: localSharedListing ? sanitizeSharedListingForBuyerView(localSharedListing) : undefined,
          }
        : undefined,
    [localAccessAllowed, localDocuments, localHorse, localPreviewAllowed, localSharedListing],
  );

  const [remoteState, setRemoteState] = useState<{
    status: 'idle' | 'loading' | 'loaded' | 'error';
    payload?: PublicBuyerProfilePayload;
    message?: string;
    source?: 'rpc' | 'local';
  }>(() => ({
    status: localPayload ? 'loaded' : 'loading',
    payload: localPayload,
    source: localPayload ? 'local' : undefined,
  }));
  const sharePath = useMemo(() => (id ? `/profiles/${id}` : ''), [id]);

  useEffect(() => {
    if (!id) {
      return;
    }

    let disposed = false;
    setRemoteState((current) => ({
      ...current,
      status: 'loading',
      message: undefined,
    }));

    void loadPublicBuyerProfile({
      sharePath,
      shareToken,
    }).then((result) => {
      if (disposed) {
        return;
      }

      if (result.ok) {
        setRemoteState({
          status: 'loaded',
          payload: result.payload,
          source: 'rpc',
        });
        void trackPublicBuyerProfileView({ sharePath, shareToken });
        return;
      }

      // Fall back to local preview only when the user is an internal workspace member
      // viewing their own horse (localPayload is always sanitized).
      if (localPayload) {
        setRemoteState({
          status: 'loaded',
          payload: localPayload,
          source: 'local',
          message: result.message,
        });
        return;
      }

      setRemoteState({
        status: 'error',
        message: result.message,
      });
    });

    return () => {
      disposed = true;
    };
  }, [id, localPayload, sharePath, shareToken]);

  const resolvedPayload = remoteState.payload ?? localPayload;

  const horse = resolvedPayload?.horse;

  // Inject OG meta tags so social previews and link unfurls show horse info.
  useEffect(() => {
    if (!horse) return;
    const title = `${horse.name} — XBAR Horse Profile`;
    const description = [horse.breed, horse.sex, horse.age > 0 ? `${horse.age} yrs` : null, horse.color].filter(Boolean).join(' · ');
    const image = horse.profileImage || horse.gallery?.[0]?.url || '';

    const setMeta = (property: string, content: string) => {
      let el = document.querySelector<HTMLMetaElement>(`meta[property="${property}"]`);
      if (!el) { el = document.createElement('meta'); el.setAttribute('property', property); document.head.appendChild(el); }
      el.setAttribute('content', content);
    };
    const setNameMeta = (name: string, content: string) => {
      let el = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
      if (!el) { el = document.createElement('meta'); el.setAttribute('name', name); document.head.appendChild(el); }
      el.setAttribute('content', content);
    };

    document.title = title;
    setMeta('og:title', title);
    setMeta('og:description', description);
    setMeta('og:type', 'website');
    if (image) setMeta('og:image', image);
    setNameMeta('description', description);
    setNameMeta('twitter:card', 'summary_large_image');
    setNameMeta('twitter:title', title);
    setNameMeta('twitter:description', description);
    if (image) setNameMeta('twitter:image', image);

    return () => { document.title = 'XBAR'; };
  }, [horse]);
  const documents = resolvedPayload?.documents ?? [];
  const sharedListing = resolvedPayload?.sharedListing;

  if (!horse) {
    const title = remoteState.status === 'loading'
      ? 'Loading sale packet'
      : localPreviewAllowed && localHorse && localSharedListing
        ? 'Share link locked'
        : 'Sale profile unavailable';
    const description = remoteState.status === 'loading'
      ? 'Loading listing and packet data.'
      : localPreviewAllowed && localHorse && localSharedListing && !localAccessAllowed
        ? 'This sale packet requires a valid access link from the ranch.'
        : remoteState.message ?? 'Record not found in this workspace.';

    return (
      <main className="buyer-shell">
        <div className="buyer-shell__inner">
          <Panel title={title} description={description}>
            {localPreviewAllowed && localHorse ? (
              <Link className="button button--ghost" to="/horses">
                Back to horses
              </Link>
            ) : null}
          </Panel>
        </div>
      </main>
    );
  }

  // Build packet completeness from the sanitized horse shape.
  // Cast to satisfy the helper signature — only uses the fields present in PublicHorseDTO.
  // Inject empty alerts — PublicHorseDTO omits them intentionally; the packet
  // scorer needs the field but buyers must never see internal alert data.
  const packet = buildHorsePacketCompleteness({ ...horse, alerts: [] } as unknown as Parameters<typeof buildHorsePacketCompleteness>[0], documents as Parameters<typeof buildHorsePacketCompleteness>[1], undefined);
  const publicShareToken = sharedListing?.accessMode === 'Private Token' ? sharedListing.shareToken : undefined;
  const publicShareUrl = buildPublicShareUrl(packet.sharePath, publicShareToken);
  const visibleDocuments = documents
    .map((document) => ({
      document,
      trust: buildDocumentTrustProfile(document as Parameters<typeof buildDocumentTrustProfile>[0], horse ? [horse as Parameters<typeof buildDocumentTrustProfile>[1][0]] : []),
    }))
    .filter(({ trust }) => trust.readyForProfile);
  const salePhotoAssets = horse.gallery.filter(
    (asset) => asset.status === 'Approved' && (asset.kind === 'Hero' || asset.kind === 'Conformation' || asset.kind === 'Sale Still'),
  ).slice(0, 4);

  return (
    <main className="buyer-shell">
      <div className="buyer-shell__inner">
        {localPreviewAllowed && localHorse ? (
          <Link className="inline-link" to={`/horses/${horse.id}`}>
            Back to horse workspace
          </Link>
        ) : null}

        <section className="buyer-hero">
          <div className="buyer-hero__media">
            <HorseMediaPreview
              src={horse.profileImage || horse.gallery[0]?.url}
              name={horse.name}
              imageClassName="buyer-hero__image"
              fallbackClassName="buyer-hero__image-fallback"
              emptyLabel="No media"
            />
          </div>
          <div className="buyer-hero__copy">
            <div className="eyebrow">Sale profile</div>
            <h1 className="page-title">{horse.name}</h1>
            <div className="status-inline">
              <Pill tone={packet.buyerProfileTone}>{packet.buyerProfileStatus}</Pill>
              <Pill tone={packet.tone}>{formatPercent(packet.score)} record complete</Pill>
              <Pill tone="blue">{horse.sale.listingState}</Pill>
              <Pill tone={sharedListing?.accessMode === 'Public Link' ? 'emerald' : 'slate'}>
                {sharedListing?.accessMode ?? 'Private Token'}
              </Pill>
            </div>
            <div className="inline-actions">
              <a className="button button--ghost button--compact" href={publicShareUrl} target="_blank" rel="noreferrer">
                Open public view
              </a>
              <button
                className="button button--primary button--compact"
                type="button"
                onClick={() => {
                  const result = openFacebookShareDialog(packet.sharePath, publicShareToken);
                  pushToast({
                    title: result.ok ? 'Facebook ready' : 'Facebook unavailable',
                    message: result.message,
                    tone: result.ok ? 'success' : 'error',
                  });
                }}
              >
                Post to Facebook
              </button>
            </div>

            {/* Contact / inquiry CTA — visible to buyers on the public profile */}
            <div style={{ marginTop: '4px' }}>
              <a
                className="button button--primary"
                style={{ width: '100%', justifyContent: 'center' }}
                href={`mailto:?subject=Inquiry: ${encodeURIComponent(horse.name)}&body=${encodeURIComponent(`Hi,\n\nI am interested in ${horse.name}. Please contact me to discuss availability and pricing.\n\nProfile: ${publicShareUrl}`)}`}
              >
                Contact seller about {horse.name}
              </a>
            </div>
          </div>
        </section>

        <div className="metric-grid">
          <MetricCard label="Record Complete" value={formatPercent(packet.score)} detail={packet.trustSummary} tone={packet.tone} />
          <MetricCard
            label="Inquiry count"
            value="—"
            detail="Buyer posture not disclosed"
            tone="slate"
          />
          <MetricCard
            label="Verified documents"
            value={`${visibleDocuments.length}`}
            detail="Ready for buyer view"
            tone="emerald"
          />
          <MetricCard
            label="Asking price"
            value={horse.sale.askPrice ? formatCompactCurrency(horse.sale.askPrice) : 'Contact seller'}
            detail="Contact ranch for financing options"
            tone="slate"
          />
        </div>

        <div className="detail-grid">
          <Panel eyebrow="Sale packet" title="Coverage">
            <SalePacketSlots slots={packet.saleSlots} />
          </Panel>

          <Panel eyebrow="Horse profile" title="Profile">
            <div className="key-grid key-grid--wide">
              {horse.registry || horse.registrationNumber ? (
                <KeyValue label="Registry" value={`${horse.registry}${horse.registrationNumber ? ` · ${horse.registrationNumber}` : ''}`} />
              ) : null}
              <KeyValue label="Breed / sex" value={[horse.breed, horse.sex].filter(Boolean).join(' · ') || '—'} />
              {horse.age > 0 ? <KeyValue label="Age" value={`${horse.age}`} /> : null}
              {horse.color ? <KeyValue label="Color" value={horse.color} /> : null}
              {(horse.bloodline.sire || horse.bloodline.dam) ? (
                <KeyValue label="Bloodline" value={`${horse.bloodline.sire || '—'} / ${horse.bloodline.dam || '—'}`} />
              ) : null}
              {horse.bloodline.family ? <KeyValue label="Family" value={horse.bloodline.family} /> : null}
            </div>
          </Panel>
        </div>

        <div className="detail-grid">
          <Panel eyebrow="Verified support" title="Approved docs">
            <div className="stack-list">
              {visibleDocuments.length ? (
                visibleDocuments.map(({ document, trust }) => (
                  <div key={document.id} className="stack-item">
                    <div className="stack-item__top">
                      <div>
                        <div className="stack-item__title">{document.title}</div>
                        <div className="stack-item__copy">{document.type}</div>
                      </div>
                      <Pill tone={trust.tone}>{formatPercent(trust.trustScore)} complete</Pill>
                    </div>
                    <div className="stack-item__copy">{document.summary}</div>
                  </div>
                ))
              ) : (
                <EmptyState compact title="No approved docs" description="No linked files clear the buyer-ready threshold yet." />
              )}
            </div>
          </Panel>

          <Panel eyebrow="AQHA photos" title="Photo set">
            {salePhotoAssets.length ? (
              <div className="media-strip">
                {salePhotoAssets.map((asset) => (
                  <div key={asset.id} className="media-tile">
                    <div className="media-tile__image-shell">
                      <img src={asset.url} alt={asset.label} className="media-tile__image" />
                    </div>
                    <div className="media-tile__label">{asset.label}</div>
                    <div className="media-tile__meta">
                      <span>{asset.kind}</span>
                      <Pill tone="blue">{asset.status}</Pill>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState compact title="No AQHA photos" description="Add approved hero and conformation photos before sharing." />
            )}
          </Panel>
        </div>
      <BuyerActionPanel
        sharePath={sharePath}
        shareToken={shareToken}
        source={remoteState.source ?? 'rpc'}
        onLocalLog={(input) => {
          if (id) {
            logBuyerRoomEvent({ horseId: id, kind: input.kind, actor: input.actor, note: input.note, amount: input.amount });
            pushToast({ title: 'Buyer activity logged', message: 'This inquiry is now in the deal room timeline.', tone: 'success' });
          }
        }}
      />
      <footer style={{ textAlign: 'center', padding: '24px 0 8px', color: 'rgba(100,130,160,0.45)', fontSize: '11px', letterSpacing: '0.06em' }}>
        <p>© {new Date().getFullYear()} XBAR LLC™ · Information provided by seller. Buyer is responsible for independent verification of registration and health status.</p>
        <p style={{ marginTop: '6px' }}><a href='/terms' style={{ color: 'rgba(100,140,180,0.45)', textDecoration: 'none' }}>Terms</a> · <a href='/privacy' style={{ color: 'rgba(100,140,180,0.45)', textDecoration: 'none' }}>Privacy</a></p>
      </footer>
      </div>
    </main>
  );
}

import { useMemo } from 'react';
import { normalizePacketBranding } from '../../api/_lib/packet-branding.js';
import { toPacketDisclosure } from '@/lib/salePacketDisclosure';
import { XbarMark } from './BrandMark';
import type { DocumentRecord, HorseRecord, OwnershipRecord, WorkspaceProfile } from '@/types/xbar';
import './salePacketPreview.css';

/** Review the same allowlisted fields used by the local packet renderer. */
export function SalePacketPreview({
  horse,
  ownership,
  profile,
  documents,
  watermark,
  onBranding,
}: {
  horse: HorseRecord;
  ownership?: OwnershipRecord;
  profile: WorkspaceProfile;
  documents: DocumentRecord[];
  watermark: string;
  onBranding: () => void;
}) {
  const branding = useMemo(() => {
    try {
      return { value: normalizePacketBranding(profile), error: '' };
    } catch (error) {
      return { value: null, error: error instanceof Error ? error.message : 'Ranch branding needs review.' };
    }
  }, [profile]);
  const shown = toPacketDisclosure(horse, ownership, profile);
  return (
    <section className="packet-preview" aria-labelledby="packet-preview-title">
      <div className="packet-preview__masthead">
        {branding.value?.logoDataUrl ? (
          <img src={branding.value.logoDataUrl} alt="Saved ranch logo" />
        ) : (
          <XbarMark title="XBAR" />
        )}
        <div>
          <span>BUYER PACKET PREVIEW</span>
          <h3 id="packet-preview-title">{branding.value?.displayName || 'Ranch name not provided'}</h3>
        </div>
      </div>
      {branding.error ? (
        <p role="alert">{branding.error}</p>
      ) : !branding.value?.logoDataUrl ? (
        <p>No ranch logo saved. The packet uses your ranch name with XBAR attribution.</p>
      ) : null}
      <button className="button button--ghost button--compact" type="button" onClick={onBranding}>
        Edit ranch branding
      </button>
      <h4>{shown.identity.name || 'Unnamed horse'}</h4>
      <dl className="packet-preview__facts">
        <div>
          <dt>Identity</dt>
          <dd>
            {[shown.identity.breed, shown.identity.sex, shown.identity.color].filter(Boolean).join(' / ') ||
              'Not provided'}
          </dd>
        </div>
        <div>
          <dt>Registration</dt>
          <dd>
            {[shown.identity.registry, shown.identity.registrationNumber].filter(Boolean).join(' / ') || 'Not provided'}
          </dd>
        </div>
        <div>
          <dt>Asking price</dt>
          <dd>
            {shown.sale.askPrice > 0
              ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(shown.sale.askPrice)
              : 'Not listed'}
          </dd>
        </div>
        <div>
          <dt>Recorded owner</dt>
          <dd>{shown.ownership.legalOwner || 'Not provided'}</dd>
        </div>
        <div>
          <dt>Seller contact</dt>
          <dd>{[branding.value?.email, branding.value?.phone].filter(Boolean).join(' / ') || 'Not provided'}</dd>
        </div>
        <div>
          <dt>Watermark</dt>
          <dd>{watermark}</dd>
        </div>
      </dl>
      <h4>
        {documents.length} selected approved {documents.length === 1 ? 'record' : 'records'}
      </h4>
      <ul>
        {documents.map((document) => (
          <li key={document.id}>
            <strong>{document.type}</strong>
            <span>{document.title}</span>
          </li>
        ))}
      </ul>
      <p>
        Internal costs, negotiating notes and private document types stay in your workspace. Original files may contain
        personal details; review them before including them. Generation checks which originals can be attached.
      </p>
    </section>
  );
}

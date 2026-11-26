import { documentOverview } from '@/lib/documentOverview';
import type { DocumentRecord, HorseRecord } from '@/types/xbar';
import './documentDossier.css';

export function DocumentDossier({
  horse,
  documents,
  canUpload,
  canReview,
  onUpload,
  onReview,
  onBrowse,
  horses,
  onHorseChange,
}: {
  horse?: HorseRecord;
  documents: DocumentRecord[];
  canUpload: boolean;
  canReview: boolean;
  onUpload: () => void;
  onReview: () => void;
  onBrowse?: () => void;
  horses?: HorseRecord[];
  onHorseChange?: (id: string) => void;
}) {
  const files = documents.filter((doc) => doc.state !== 'Archived' && (!horse || doc.horseId === horse.id));
  const review = files.filter((doc) => doc.state === 'Needs Review' || doc.state === 'Matched').length;
  const groups = documentOverview(documents, horse?.id);
  const action =
    review && canReview
      ? { label: `Review ${review} ${review === 1 ? 'file' : 'files'}`, run: onReview }
      : canUpload
        ? { label: files.length ? 'Add a document' : 'Add the first document', run: onUpload }
        : onBrowse
          ? { label: 'Browse originals', run: onBrowse }
          : null;
  return (
    <section className="document-dossier" aria-label="Document overview">
      <div className="document-dossier__cover">
        <div className="document-dossier__top">
          <span>THE DOCUMENT FILE</span>
          <span>{String(files.length).padStart(2, '0')} ON FILE</span>
        </div>
        <h2>
          <span style={{ color: 'var(--xbar-warm-white)' }}>{horse ? horse.name : 'Your Documents'}</span>
        </h2>
        <p>{horse ? 'Every paper. One horse.' : 'Find the paper behind the record.'}</p>
        {horses?.length && onHorseChange ? (
          <label className="document-dossier__select">
            <span style={{ color: 'var(--xbar-silver)', fontSize: 14 }}>View a horse's file</span>
            <select value={horse?.id ?? ''} onChange={(event) => onHorseChange(event.target.value)}>
              <option value="">All horses</option>
              {horses.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {action ? (
          <button type="button" className="document-dossier__primary" onClick={action.run}>
            {action.label}
            <span aria-hidden="true">↗</span>
          </button>
        ) : (
          <p className="document-dossier__read-only">Read-only access · ask a ranch administrator to add files.</p>
        )}
      </div>
      <div className="document-dossier__inventory" aria-label="Papers on file">
        {groups.map((group, index) => (
          <div
            key={group.label}
            className={`document-dossier__slot${group.count ? '' : ' document-dossier__slot--missing'}`}
          >
            <span className="document-dossier__number">0{index + 1}</span>
            <div>
              <strong>{group.label}</strong>
              <span>{group.status}</span>
            </div>
            <b>{group.count || '—'}</b>
          </div>
        ))}
      </div>
      <p className="document-dossier__note">
        File inventory, not a proof or clearance decision. Originals still need review.
      </p>
    </section>
  );
}

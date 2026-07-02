import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Archive, ArrowUpDown, Check, FileText, FileUp, Link2, ShieldCheck, Upload } from 'lucide-react';
import { ActionButton, Card, PageHead, SlideOverDrawer, StatusChip } from '@/components/saas';
import { useUiStore } from '@/store/useUiStore';
import { useXbarStore } from '@/store/useXbarStore';
import { events, track } from '@/lib/telemetry';
import type { DocumentRecord, ProcessingState } from '@/types/xbar';

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';
const STATE_TONE: Record<ProcessingState, Tone> = {
  Ready: 'success',
  Matched: 'info',
  'Needs Review': 'warning',
  Queued: 'warning',
  Archived: 'neutral',
};
type SortKey = 'name' | 'uploaded' | 'status';

export default function DocumentsVault() {
  const navigate = useNavigate();
  const pushToast = useUiStore((s) => s.pushToast);
  const documents = useXbarStore((s) => s.documents);
  const horses = useXbarStore((s) => s.horses);
  const [filter, setFilter] = useState<string>('All');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'status', dir: 1 });
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [buyerSafe, setBuyerSafe] = useState<Set<string>>(() => new Set(documents.filter((d) => d.state === 'Ready').map((d) => d.id)));
  const [selected, setSelected] = useState<DocumentRecord | null>(null);
  const toast = (m: string) => pushToast({ title: 'Paperwork', message: m, tone: 'success' });

  const horseName = useMemo(() => {
    const map = new Map(horses.map((h) => [h.id, h.name]));
    return (d: DocumentRecord) => (d.horseId ? map.get(d.horseId) : undefined) ?? d.entities.horseName ?? 'Unlinked';
  }, [horses]);

  const filters = useMemo(() => ['All', ...Array.from(new Set(documents.map((d) => d.type)))], [documents]);

  const rows = useMemo(() => {
    const base = filter === 'All' ? documents : documents.filter((d) => d.type === filter);
    return [...base].sort((a, b) => {
      const av = sort.key === 'name' ? a.title : sort.key === 'uploaded' ? a.uploadedAt : a.state;
      const bv = sort.key === 'name' ? b.title : sort.key === 'uploaded' ? b.uploadedAt : b.state;
      return av.localeCompare(bv) * sort.dir;
    });
  }, [documents, filter, sort]);

  const reviewCount = documents.filter((d) => d.state === 'Needs Review' || d.state === 'Queued' || d.state === 'Matched').length;

  const toggleSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: 1 }));
  const toggleRow = (id: string) => setSelectedRows((cur) => { const n = new Set(cur); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allSelected = rows.length > 0 && rows.every((r) => selectedRows.has(r.id));
  const toggleAll = () => setSelectedRows(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  const toggleSafe = (id: string) => setBuyerSafe((cur) => { const n = new Set(cur); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const Th = ({ k, label }: { k: SortKey; label: string }) => (
    <th className={`xs-th-sort${sort.key === k ? ' xs-th-sort--on' : ''}`} onClick={() => toggleSort(k)}>{label}<span><ArrowUpDown size={11} /></span></th>
  );

  if (documents.length === 0) {
    return (
      <>
        <PageHead
          eyebrow="Records"
          title="Paperwork"
          subtitle="Keep all your horse paperwork in one place — registration, Coggins, health records, and bills of sale — and choose what buyers can see."
          actions={<ActionButton variant="primary" icon={<Upload size={15} />} onClick={() => navigate('/documents?upload=1')}>Upload</ActionButton>}
        />
        <Card>
          <div className="xs-empty">
            <span className="xs-empty__icon"><FileText size={26} /></span>
            <div className="xs-empty__title">No paperwork yet</div>
            <div className="xs-empty__sub">Add registration papers, Coggins, health records, and bills of sale. XBAR reads them and files them under the right horse for you.</div>
            <ActionButton variant="primary" icon={<Upload size={15} />} onClick={() => navigate('/documents?upload=1')}>Upload documents</ActionButton>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHead
        eyebrow="Records"
        title="Paperwork"
        subtitle="Keep all your horse paperwork in one place — registration, Coggins, health records, and bills of sale — and choose what buyers can see."
        actions={<ActionButton variant="primary" icon={<Upload size={15} />} onClick={() => navigate('/documents?upload=1')}>Upload</ActionButton>}
      />

      <div className="xs-grid-3">
        <Card><div className="xs-card__sub">Total documents</div><div style={{ fontSize: 28, fontWeight: 700 }}>{documents.length}</div></Card>
        <Card><div className="xs-card__sub">Needs review</div><div style={{ fontSize: 28, fontWeight: 700, color: reviewCount ? 'var(--xbar-warning)' : 'var(--xbar-text)' }}>{reviewCount}</div></Card>
        <Card><div className="xs-card__sub">Ready to share</div><div style={{ fontSize: 28, fontWeight: 700 }}>{buyerSafe.size}</div></Card>
      </div>

      <div className="xs-fchips">
        {filters.map((f) => (
          <button key={f} type="button" className={`xs-fchip${filter === f ? ' xs-fchip--active' : ''}`} onClick={() => setFilter(f)}>{f}</button>
        ))}
      </div>

      {selectedRows.size > 0 ? (
        <div className="xs-bulkbar">
          <span className="xs-bulkbar__count">{selectedRows.size} selected</span>
          <ActionButton size="sm" icon={<ShieldCheck size={14} />} onClick={() => { track(events.documentBulkAction, { action: 'mark_buyer_safe', count: selectedRows.size }); setBuyerSafe((cur) => new Set([...cur, ...selectedRows])); toast(`${selectedRows.size} marked ready to share`); setSelectedRows(new Set()); }}>Mark Ready to Share</ActionButton>
          <ActionButton size="sm" icon={<FileUp size={14} />} onClick={() => { toast(`${selectedRows.size} added to packet`); setSelectedRows(new Set()); }}>Include in Packet</ActionButton>
          <ActionButton size="sm" icon={<Archive size={14} />} onClick={() => { toast(`${selectedRows.size} archived`); setSelectedRows(new Set()); }}>Archive</ActionButton>
          <span className="xs-bulkbar__spacer" />
          <button type="button" className="xs-btn xs-btn--sm xs-btn--ghost" onClick={() => setSelectedRows(new Set())}>Clear</button>
        </div>
      ) : null}

      <div className="xs-tablewrap">
        <table className="xs-table">
          <thead>
            <tr>
              <th style={{ width: 36 }}><span className={`xs-checkbox${allSelected ? ' xs-checkbox--on' : ''}`} onClick={toggleAll} role="checkbox" aria-checked={allSelected}>{allSelected ? <Check size={12} /> : null}</span></th>
              <Th k="name" label="Document" />
              <th>Type</th>
              <th>Linked to</th>
              <Th k="uploaded" label="Uploaded" />
              <Th k="status" label="Status" />
              <th>Ready to share</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const sel = selectedRows.has(d.id);
              return (
                <tr key={d.id} className={sel ? 'xs-tr--sel' : ''} onClick={() => { track(events.documentOpened, { id: d.id, type: d.type }); setSelected(d); }}>
                  <td onClick={(e) => { e.stopPropagation(); toggleRow(d.id); }}><span className={`xs-checkbox${sel ? ' xs-checkbox--on' : ''}`}>{sel ? <Check size={12} /> : null}</span></td>
                  <td style={{ fontWeight: 600 }}>{d.title}</td>
                  <td className="xs-muted">{d.type}</td>
                  <td>{horseName(d)}</td>
                  <td className="xs-muted">{d.uploadedAt}</td>
                  <td><StatusChip tone={STATE_TONE[d.state]}>{d.state}</StatusChip></td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <button type="button" className={`xs-switch${buyerSafe.has(d.id) ? ' xs-switch--on' : ''}`} aria-label="Toggle buyer-safe" onClick={() => toggleSafe(d.id)}><span className="xs-switch__knob" /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Document preview drawer */}
      <SlideOverDrawer
        open={Boolean(selected)}
        title={selected?.title ?? ''}
        subtitle={selected ? `${selected.type} · ${horseName(selected)}` : ''}
        onClose={() => setSelected(null)}
        footer={selected ? (<><ActionButton icon={<Archive size={15} />} onClick={() => { toast('Archived'); setSelected(null); }}>Archive</ActionButton><ActionButton variant="primary" icon={<ShieldCheck size={15} />} onClick={() => { if (selected) setBuyerSafe((c) => new Set(c).add(selected.id)); toast('Marked ready to share'); setSelected(null); }}>Mark Ready to Share</ActionButton></>) : null}
      >
        {selected ? (
          <>
            <div style={{ display: 'flex', gap: 8 }}>
              <StatusChip tone={STATE_TONE[selected.state]}>{selected.state}</StatusChip>
              <span className={`xs-chip xs-chip--${buyerSafe.has(selected.id) ? 'success' : 'neutral'}`}>{buyerSafe.has(selected.id) ? 'Ready to share' : 'Private'}</span>
            </div>
            <p className="xs-muted" style={{ fontSize: 13 }}>{selected.summary || selected.extractedTextPreview}</p>
            <dl className="xs-kv">
              <dt>Type</dt><dd>{selected.type}</dd>
              <dt>Linked animal</dt><dd>{horseName(selected)}</dd>
              <dt>Source</dt><dd>{selected.source}</dd>
              <dt>Confidence</dt><dd>{Math.round(selected.confidence * 100)}%</dd>
              <dt>Uploaded</dt><dd>{selected.uploadedAt} · {selected.uploadedBy}</dd>
            </dl>
            <div className="xs-section-label">Actions</div>
            <div className="xs-field">
              <button type="button" className="xs-fieldbtn" onClick={() => navigate('/documents')}><Check size={15} /> Open in intake</button>
              <button type="button" className="xs-fieldbtn" onClick={() => toast('Attached to record')}><Link2 size={15} /> Attach</button>
              <button type="button" className="xs-fieldbtn" onClick={() => toast('Included in packet')}><FileUp size={15} /> Include in Packet</button>
            </div>
          </>
        ) : null}
      </SlideOverDrawer>
    </>
  );
}

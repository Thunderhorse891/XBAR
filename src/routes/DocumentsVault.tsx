import { useMemo, useState } from 'react';
import { Archive, ArrowUpDown, Check, FileUp, Link2, ShieldCheck, Upload } from 'lucide-react';
import { ActionButton, Card, PageHead, SlideOverDrawer, StatusChip } from '@/components/saas';
import { useUiStore } from '@/store/useUiStore';
import { dataRoomDocs, documentFilters, type DataRoomDoc } from '@/data/xbarSaasMock';

const statusTone = { Current: 'success', Expiring: 'warning', Missing: 'danger', Review: 'warning' } as const;
type SortKey = 'name' | 'expires' | 'status';

export default function DocumentsVault() {
  const pushToast = useUiStore((s) => s.pushToast);
  const [filter, setFilter] = useState<string>('All');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'status', dir: 1 });
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [buyerSafe, setBuyerSafe] = useState<Set<string>>(new Set(dataRoomDocs.filter((d) => d.status === 'Current').map((d) => d.id)));
  const [selected, setSelected] = useState<DataRoomDoc | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const toast = (m: string) => pushToast({ title: 'Documents Vault', message: m, tone: 'success' });

  const rows = useMemo(() => {
    const base = filter === 'All' ? dataRoomDocs : dataRoomDocs.filter((d) => d.type === filter);
    return [...base].sort((a, b) => {
      const av = sort.key === 'name' ? a.name : sort.key === 'expires' ? a.expires ?? 'zzzz' : a.status;
      const bv = sort.key === 'name' ? b.name : sort.key === 'expires' ? b.expires ?? 'zzzz' : b.status;
      return av.localeCompare(bv) * sort.dir;
    });
  }, [filter, sort]);

  const toggleSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: 1 }));
  const toggleRow = (id: string) => setSelectedRows((cur) => { const n = new Set(cur); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allSelected = rows.length > 0 && rows.every((r) => selectedRows.has(r.id));
  const toggleAll = () => setSelectedRows(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  const toggleSafe = (id: string) => setBuyerSafe((cur) => { const n = new Set(cur); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const Th = ({ k, label }: { k: SortKey; label: string }) => (
    <th className={`xs-th-sort${sort.key === k ? ' xs-th-sort--on' : ''}`} onClick={() => toggleSort(k)}>{label}<span><ArrowUpDown size={11} /></span></th>
  );

  return (
    <>
      <PageHead
        eyebrow="Records"
        title="Documents Vault"
        subtitle="A ranch data room — attach proof to animals, deals, and locations, track expirations, and control buyer-safe access."
        actions={<ActionButton variant="primary" icon={<Upload size={15} />} onClick={() => setUploadOpen(true)}>Upload</ActionButton>}
      />

      <div className="xs-grid-3">
        <Card><div className="xs-card__sub">Expiring soon</div><div style={{ fontSize: 28, fontWeight: 700, color: 'var(--xbar-warning)' }}>15</div></Card>
        <Card><div className="xs-card__sub">Missing data</div><div style={{ fontSize: 28, fontWeight: 700, color: 'var(--xbar-danger)' }}>{dataRoomDocs.filter((d) => d.status === 'Missing').length}</div></Card>
        <Card><div className="xs-card__sub">Buyer-safe</div><div style={{ fontSize: 28, fontWeight: 700 }}>{buyerSafe.size}</div></Card>
      </div>

      <div className="xs-fchips">
        {documentFilters.map((f) => (
          <button key={f} type="button" className={`xs-fchip${filter === f ? ' xs-fchip--active' : ''}`} onClick={() => setFilter(f)}>{f}</button>
        ))}
      </div>

      {selectedRows.size > 0 ? (
        <div className="xs-bulkbar">
          <span className="xs-bulkbar__count">{selectedRows.size} selected</span>
          <ActionButton size="sm" icon={<ShieldCheck size={14} />} onClick={() => { toast(`${selectedRows.size} marked buyer-safe`); setSelectedRows(new Set()); }}>Mark Buyer-Safe</ActionButton>
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
              <Th k="expires" label="Expires" />
              <Th k="status" label="Status" />
              <th>Buyer-safe</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const sel = selectedRows.has(d.id);
              return (
                <tr key={d.id} className={sel ? 'xs-tr--sel' : ''} onClick={() => setSelected(d)}>
                  <td onClick={(e) => { e.stopPropagation(); toggleRow(d.id); }}><span className={`xs-checkbox${sel ? ' xs-checkbox--on' : ''}`}>{sel ? <Check size={12} /> : null}</span></td>
                  <td style={{ fontWeight: 600 }}>{d.name}</td>
                  <td className="xs-muted">{d.type}</td>
                  <td>{d.horse}</td>
                  <td className="xs-muted">{d.expires ?? '—'}</td>
                  <td><StatusChip tone={statusTone[d.status]}>{d.status}</StatusChip></td>
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
        title={selected?.name ?? ''}
        subtitle={selected ? `${selected.type} · ${selected.horse}` : ''}
        onClose={() => setSelected(null)}
        footer={selected ? (<><ActionButton icon={<Archive size={15} />} onClick={() => { toast('Archived'); setSelected(null); }}>Archive</ActionButton><ActionButton variant="primary" icon={<ShieldCheck size={15} />} onClick={() => { if (selected) setBuyerSafe((c) => new Set(c).add(selected.id)); toast('Marked buyer-safe'); setSelected(null); }}>Mark Buyer-Safe</ActionButton></>) : null}
      >
        {selected ? (
          <>
            <div style={{ display: 'flex', gap: 8 }}>
              <StatusChip tone={statusTone[selected.status]}>{selected.status}</StatusChip>
              <span className={`xs-chip xs-chip--${buyerSafe.has(selected.id) ? 'success' : 'neutral'}`}>{buyerSafe.has(selected.id) ? 'Buyer-safe' : 'Internal only'}</span>
            </div>
            <div className="xs-skel" style={{ height: 120 }} aria-hidden="true" />
            <dl className="xs-kv">
              <dt>Type</dt><dd>{selected.type}</dd>
              <dt>Linked animal</dt><dd>{selected.horse}</dd>
              <dt>Transaction</dt><dd>{selected.transaction}</dd>
              <dt>Expiration</dt><dd>{selected.expires ?? 'Not set'}</dd>
            </dl>
            <div className="xs-section-label">Actions</div>
            <div className="xs-field">
              <button type="button" className="xs-fieldbtn" onClick={() => toast('Sent to review')}><Check size={15} /> Review</button>
              <button type="button" className="xs-fieldbtn" onClick={() => toast('Attached to record')}><Link2 size={15} /> Attach</button>
              <button type="button" className="xs-fieldbtn" onClick={() => toast('Included in packet')}><FileUp size={15} /> Include in Packet</button>
            </div>
          </>
        ) : null}
      </SlideOverDrawer>

      {/* Upload drawer */}
      <SlideOverDrawer
        open={uploadOpen}
        title="Upload Document"
        subtitle="Add proof to the data room"
        onClose={() => setUploadOpen(false)}
        footer={<><ActionButton onClick={() => setUploadOpen(false)}>Cancel</ActionButton><ActionButton variant="primary" onClick={() => { toast('Document uploaded'); setUploadOpen(false); }}>Upload</ActionButton></>}
      >
        <div className="xs-drop"><FileUp size={20} style={{ display: 'block', margin: '0 auto 8px' }} />Drop a file or click to browse (PDF, JPG)</div>
        <label><span className="xs-field-label">Document type</span><select className="xs-select" defaultValue="Health Cert">{['Health Cert', 'Coggins', 'Registration', 'Bill of Sale', 'Photos', 'Contracts'].map((t) => <option key={t}>{t}</option>)}</select></label>
        <label><span className="xs-field-label">Expiration date</span><input className="xs-input" placeholder="YYYY-MM-DD" /></label>
      </SlideOverDrawer>
    </>
  );
}

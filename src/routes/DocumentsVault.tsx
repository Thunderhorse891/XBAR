import { useMemo, useState } from 'react';
import { Archive, Check, FileUp, Link2, ShieldCheck, Upload } from 'lucide-react';
import { ActionButton, Card, FilterTabs, PageHead, SlideOverDrawer, StatusChip } from '@/components/saas';
import { useUiStore } from '@/store/useUiStore';
import { dataRoomDocs, documentFilters, type DataRoomDoc } from '@/data/xbarSaasMock';

const statusTone = { Current: 'success', Expiring: 'warning', Missing: 'danger', Review: 'warning' } as const;

export default function DocumentsVault() {
  const pushToast = useUiStore((s) => s.pushToast);
  const [filter, setFilter] = useState<string>('All');
  const [selected, setSelected] = useState<DataRoomDoc | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const rows = useMemo(() => (filter === 'All' ? dataRoomDocs : dataRoomDocs.filter((d) => d.type === filter)), [filter]);
  const toast = (m: string) => pushToast({ title: 'Documents Vault', message: m, tone: 'success' });

  return (
    <>
      <PageHead
        eyebrow="Records"
        title="Documents Vault"
        subtitle="A lightweight ranch data room — attach proof to animals, deals, and locations, track expirations, and control buyer-safe access."
        actions={<ActionButton variant="primary" icon={<Upload size={15} />} onClick={() => setUploadOpen(true)}>Upload</ActionButton>}
      />

      <div className="xs-grid-3">
        <Card><div className="xs-card__sub">Expiring soon</div><div style={{ fontSize: 28, fontWeight: 700, color: 'var(--xbar-warning)' }}>{dataRoomDocs.filter((d) => d.status === 'Expiring').length + 13}</div></Card>
        <Card><div className="xs-card__sub">Missing data</div><div style={{ fontSize: 28, fontWeight: 700, color: 'var(--xbar-danger)' }}>{dataRoomDocs.filter((d) => d.status === 'Missing').length}</div></Card>
        <Card><div className="xs-card__sub">Buyer-safe</div><div style={{ fontSize: 28, fontWeight: 700 }}>24</div></Card>
      </div>

      <Card>
        <div style={{ marginBottom: 12 }}><FilterTabs tabs={documentFilters} active={filter} onChange={setFilter} /></div>
        <table className="xs-table">
          <thead>
            <tr><th>Document</th><th>Type</th><th>Linked to</th><th>Transaction</th><th>Expires</th><th>Status</th></tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id} onClick={() => setSelected(d)}>
                <td style={{ fontWeight: 600 }}>{d.name}</td>
                <td className="xs-muted">{d.type}</td>
                <td>{d.horse}</td>
                <td className="xs-muted">{d.transaction}</td>
                <td className="xs-muted">{d.expires ?? '—'}</td>
                <td><StatusChip tone={statusTone[d.status]}>{d.status}</StatusChip></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Document drawer */}
      <SlideOverDrawer
        open={Boolean(selected)}
        title={selected?.name ?? ''}
        subtitle={selected ? `${selected.type} · ${selected.horse}` : ''}
        onClose={() => setSelected(null)}
        footer={selected ? (<><ActionButton icon={<Archive size={15} />} onClick={() => { toast('Archived'); setSelected(null); }}>Archive</ActionButton><ActionButton variant="primary" icon={<ShieldCheck size={15} />} onClick={() => { toast('Marked buyer-safe'); setSelected(null); }}>Mark Buyer-Safe</ActionButton></>) : null}
      >
        {selected ? (
          <>
            <div style={{ display: 'flex', gap: 8 }}>
              <StatusChip tone={statusTone[selected.status]}>{selected.status}</StatusChip>
              {selected.status === 'Missing' ? <span className="xs-chip xs-chip--danger">Missing fields</span> : <span className="xs-chip xs-chip--neutral">Complete</span>}
            </div>
            <dl className="xs-kv">
              <dt>Type</dt><dd>{selected.type}</dd>
              <dt>Linked animal</dt><dd>{selected.horse}</dd>
              <dt>Transaction</dt><dd>{selected.transaction}</dd>
              <dt>Expiration</dt><dd>{selected.expires ?? 'Not set'}</dd>
              <dt>Buyer-safe</dt><dd>{selected.status === 'Current' ? 'Yes' : 'Pending review'}</dd>
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

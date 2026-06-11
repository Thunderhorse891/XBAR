import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from '@/components/EmptyState';
import { MetricCard, Panel, Pill, SurfaceTabs } from '@/components/app-ui';
import { buildPrefilledDocument, documentTemplateLibrary, downloadHtmlFile, type DocumentTemplate, type DocumentTemplateTier } from '@/lib/documentTemplateLibrary';
import { downloadLegalHtml, legalDocuments, openPrintableLegalDocument } from '@/lib/legalDocuments';
import { buildLocalSalePacket, getBuyerSafePacketDocuments } from '@/lib/localSalePacketGenerator';
import { buildSharePath } from '@/lib/xbarRuntime';
import { packetExportGate } from '@/lib/subscriptionGates';
import { useUiStore } from '@/store/useUiStore';
import { useXbarStore } from '@/store/useXbarStore';
import type { SubscriptionTier } from '@/types/xbar';

const tierOrder: DocumentTemplateTier[] = ['Basic', 'Pro', 'Business'];
const planRank: Record<SubscriptionTier, number> = { Starter: 0, Professional: 1, 'Ranch Ops': 2, Enterprise: 3 };
const packetLogKey = 'xbar-local-sale-packet-log';

function planAllows(current: SubscriptionTier, required: SubscriptionTier) {
  return planRank[current] >= planRank[required];
}

function tierCopy(tier: DocumentTemplateTier) {
  if (tier === 'Basic') return 'Hobby owner and individual rider documents: sale, board, lease, care, and annual health paperwork.';
  if (tier === 'Pro') return 'Breeder and trainer workflows: breeding, training, foaling, sales packets, and client intake.';
  return 'Barn and large-stable documents: services, waivers, multi-owner transfers, branded packs, and payment plans.';
}

function TemplateCard({ template, active, locked, onSelect }: { template: DocumentTemplate; active: boolean; locked: boolean; onSelect: () => void }) {
  return (
    <button type="button" className={`stack-item stack-item--interactive ${active ? 'border-[#1155dd] bg-[#eef4ff]' : ''}`} onClick={onSelect}>
      <div className="stack-item__top">
        <div>
          <div className="stack-item__title">{template.label}</div>
          <div className="stack-item__copy">{template.purpose}</div>
        </div>
        <div className="status-inline">
          <Pill tone={template.tier === 'Basic' ? 'blue' : template.tier === 'Pro' ? 'emerald' : 'amber'}>{template.tier}</Pill>
          {locked ? <Pill tone="rose">{template.minimumPlan}+</Pill> : <Pill tone="emerald">Included</Pill>}
        </div>
      </div>
    </button>
  );
}

function appendLocalPacketLog(entry: Record<string, unknown>) {
  if (typeof window === 'undefined') return;
  const current = JSON.parse(window.localStorage.getItem(packetLogKey) || '[]') as Record<string, unknown>[];
  window.localStorage.setItem(packetLogKey, JSON.stringify([{ ...entry, createdAt: new Date().toISOString() }, ...current].slice(0, 100)));
}

function downloadSalePacketHtml(fileName: string, html: string) {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = window.URL.createObjectURL(blob);
  const anchor = window.document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.URL.revokeObjectURL(url);
}

export default function DocumentLibrary() {
  const horses = useXbarStore((state) => state.horses);
  const documents = useXbarStore((state) => state.documents);
  const ownershipRecords = useXbarStore((state) => state.ownershipRecords);
  const workspaceProfile = useXbarStore((state) => state.workspaceProfile);
  const subscription = useXbarStore((state) => state.subscription);
  const recordSalePacketGenerated = useXbarStore((state) => state.recordSalePacketGenerated);
  const pushToast = useUiStore((state) => state.pushToast);
  const [activeTier, setActiveTier] = useState<DocumentTemplateTier>('Pro');
  const [selectedHorseId, setSelectedHorseId] = useState(horses[0]?.id ?? '');
  const [selectedTemplateId, setSelectedTemplateId] = useState(documentTemplateLibrary.find((template) => template.id === 'sales-packet')?.id ?? documentTemplateLibrary[0].id);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);

  const selectedHorse = horses.find((horse) => horse.id === selectedHorseId) ?? horses[0];
  const selectedTemplate = documentTemplateLibrary.find((template) => template.id === selectedTemplateId) ?? documentTemplateLibrary[0];
  const selectedOwnership = ownershipRecords.find((record) => record.horseId === selectedHorse?.id);
  const sharedLink = selectedHorse ? `${window.location.origin}${buildSharePath(selectedHorse.id)}` : '';
  const buyerSafeProof = useMemo(() => selectedHorse ? getBuyerSafePacketDocuments(documents, selectedHorse.id) : [], [documents, selectedHorse]);
  const localSalePacket = selectedHorse ? buildLocalSalePacket({
    horse: selectedHorse,
    workspaceProfile,
    documents,
    ownershipRecord: selectedOwnership,
    selectedDocumentIds,
    generatedBy: workspaceProfile.ranchManagerName || workspaceProfile.businessName || 'XBAR',
  }) : null;
  const prefilled = selectedHorse ? buildPrefilledDocument({
    templateId: selectedTemplate.id,
    horse: selectedHorse,
    workspaceProfile,
    documents,
    ownershipRecord: selectedOwnership,
    generatedBy: workspaceProfile.ranchManagerName || workspaceProfile.businessName || 'XBAR',
    sharedLink,
  }) : null;

  const templatesByTier = useMemo(() => Object.fromEntries(tierOrder.map((tier) => [tier, documentTemplateLibrary.filter((template) => template.tier === tier)])) as Record<DocumentTemplateTier, DocumentTemplate[]>, []);

  useEffect(() => {
    setSelectedDocumentIds(buyerSafeProof.filter((document) => document.buyerSafe).map((document) => document.id));
  }, [selectedHorseId, buyerSafeProof]);

  const openPreview = () => {
    if (!prefilled) return;
    const preview = window.open('', '_blank', 'noopener,noreferrer');
    if (!preview) {
      pushToast({ title: 'Preview blocked', message: 'Allow popups to preview the generated document.', tone: 'error' });
      return;
    }
    preview.document.write(prefilled.html);
    preview.document.close();
  };

  const previewSalePacket = () => {
    if (!localSalePacket || !selectedHorse) return;
    const preview = window.open('', '_blank', 'noopener,noreferrer');
    if (!preview) {
      pushToast({ title: 'Preview blocked', message: 'Allow popups to preview the sale packet.', tone: 'error' });
      return;
    }
    preview.document.write(localSalePacket.html);
    preview.document.close();
    appendLocalPacketLog({ horseId: selectedHorse.id, horseName: selectedHorse.name, action: 'previewed', packetScore: localSalePacket.packetScore, releaseStatus: localSalePacket.releaseStatus, includedDocuments: selectedDocumentIds.length });
    pushToast({ title: 'Sale packet preview opened', message: `${selectedHorse.name} packet was logged locally.`, tone: 'success' });
  };

  const exportSalePacket = () => {
    if (!localSalePacket || !selectedHorse) return;
    if (localSalePacket.blockers.length) {
      pushToast({ title: 'Packet export blocked', message: localSalePacket.blockers[0], tone: 'error' });
      return;
    }
    const usageResult = recordSalePacketGenerated();
    if (!usageResult.ok) {
      pushToast({ title: 'Upgrade to unlock packet export', message: usageResult.message, tone: 'error' });
      return;
    }
    downloadSalePacketHtml(localSalePacket.fileName, localSalePacket.html);
    appendLocalPacketLog({ horseId: selectedHorse.id, horseName: selectedHorse.name, action: 'exported', packetScore: localSalePacket.packetScore, releaseStatus: localSalePacket.releaseStatus, includedDocuments: selectedDocumentIds.length });
    pushToast({ title: 'Sale packet exported', message: `${selectedHorse.name} buyer packet downloaded and logged locally. Open it and print to PDF.`, tone: 'success' });
  };

  const downloadDocument = () => {
    if (!prefilled) return;
    downloadHtmlFile(prefilled.fileName, prefilled.html);
    pushToast({ title: 'Document exported', message: `${prefilled.template.label} downloaded as a print-ready HTML report. Use browser print to save as PDF.`, tone: 'success' });
  };

  const previewLegalDocument = (legalDoc: (typeof legalDocuments)[number]) => {
    const opened = openPrintableLegalDocument(legalDoc);
    pushToast({
      title: opened ? 'Legal document opened' : 'Preview blocked',
      message: opened ? `${legalDoc.shortTitle} opened in a printable PDF-ready tab.` : 'Allow popups to preview and print the legal document.',
      tone: opened ? 'success' : 'error',
    });
  };

  const downloadLegalDocument = (legalDoc: (typeof legalDocuments)[number]) => {
    downloadLegalHtml(legalDoc);
    pushToast({ title: 'Legal document exported', message: `${legalDoc.shortTitle} downloaded as a print-ready HTML document. Open it and print to PDF.`, tone: 'success' });
  };

  const copyShareLink = () => {
    if (!sharedLink) return;
    void navigator.clipboard.writeText(sharedLink).then(() => {
      pushToast({ title: 'Secure link copied', message: 'Use shared access controls before sending this buyer-facing link.', tone: 'success' });
    });
  };

  const toggleProof = (documentId: string) => {
    setSelectedDocumentIds((current) => current.includes(documentId) ? current.filter((id) => id !== documentId) : [...current, documentId]);
  };

  if (!horses.length) {
    return <Panel title="Document Library"><EmptyState title="Add a horse first" description="Dynamic templates need horse, owner, and barn data before XBAR can pre-fill documents." action={<Link to="/horses?new=1" className="button button--primary button--compact">Create first horse</Link>} /></Panel>;
  }

  const locked = !planAllows(subscription.tier, selectedTemplate.minimumPlan);

  return (
    <>
      <div className="surface-hero surface-hero--dark">
        <div className="surface-hero__top">
          <div>
            <span className="surface-hero__eyebrow">Sale Packet Generator</span>
            <h1 className="surface-hero__title">Generate PDF-ready buyer packets before cloud is live</h1>
            <p className="surface-hero__copy">Select a horse, see release blockers, choose included proof, add XBAR disclaimer and watermark, export the packet, and log the generation locally.</p>
          </div>
          <div className="surface-hero__stats">
            <div className="surface-hero__stat"><span>Packet score</span><strong>{localSalePacket?.packetScore ?? 0}%</strong></div>
            <div className="surface-hero__stat"><span>Blockers</span><strong>{localSalePacket?.blockers.length ?? 0}</strong></div>
            <div className="surface-hero__stat"><span>Included proof</span><strong>{selectedDocumentIds.length}</strong></div>
            <div className="surface-hero__stat"><span>Legal docs</span><strong>{legalDocuments.length}</strong></div>
          </div>
        </div>
      </div>

      <div className="metric-grid">
        <MetricCard label="Release gate" value={localSalePacket?.releaseStatus ?? 'Pending'} detail={localSalePacket?.blockers[0] ?? 'No hard blocker flagged'} tone={localSalePacket?.blockers.length ? 'rose' : 'emerald'} />
        <MetricCard label="Buyer proof" value={`${selectedDocumentIds.length}/${buyerSafeProof.length}`} detail="Ready records selected for packet" tone="blue" />
        <MetricCard label="Watermark" value="XBAR" detail="Disclaimer and trademark notice included" tone="slate" />
        <MetricCard label="Export" value="HTML/PDF" detail="Download then print to PDF" tone="emerald" />
      </div>

      <div className="dashboard-grid dashboard-grid--primary">
        <Panel title="1. Select horse" meta={<Pill tone="blue">Local-first</Pill>}>
          <div className="form-grid form-grid--tight">
            <label className="field-stack">
              <span className="field-label">Horse</span>
              <select className="field-input" value={selectedHorse?.id ?? ''} onChange={(event) => setSelectedHorseId(event.target.value)}>
                {horses.map((horse) => <option key={horse.id} value={horse.id}>{horse.name}</option>)}
              </select>
            </label>
            <label className="field-stack">
              <span className="field-label">Buyer link preview</span>
              <input className="field-input" value={sharedLink} readOnly />
            </label>
          </div>
          <div className="stack-list">
            <div className="stack-item"><div className="stack-item__title">{selectedHorse.name}</div><div className="stack-item__copy">{selectedHorse.segment} · {selectedHorse.status} · {selectedHorse.sale.listingState}</div></div>
            <div className="stack-item"><div className="stack-item__title">Ask price</div><div className="stack-item__copy">{selectedHorse.sale.askPrice ? `$${selectedHorse.sale.askPrice.toLocaleString()}` : 'Not listed yet'}</div></div>
          </div>
        </Panel>

        <Panel title="2. Resolve blockers" meta={<Pill tone={localSalePacket?.blockers.length ? 'rose' : 'emerald'}>{localSalePacket?.blockers.length ? 'Blocked' : 'Clear'}</Pill>}>
          <div className="stack-list">
            {localSalePacket?.blockers.length ? localSalePacket.blockers.map((blocker) => (
              <Link key={blocker} to={blocker.includes('Title') ? '/ownership' : blocker.includes('Care') ? '/medical' : '/documents'} className="stack-item stack-item--interactive">
                <div className="stack-item__top"><div className="stack-item__title">{blocker}</div><Pill tone="rose">Fix</Pill></div>
              </Link>
            )) : <div className="stack-item"><div className="stack-item__title">Release gate clear</div><div className="stack-item__copy">No hard blocker flagged. Review warnings and proof before sending.</div></div>}
            {localSalePacket?.warnings.slice(0, 4).map((warning) => <div key={warning} className="stack-item"><div className="stack-item__title">Warning</div><div className="stack-item__copy">{warning}</div></div>)}
          </div>
        </Panel>
      </div>

      <Panel title="3. Select included proof" meta={<Pill tone="blue">{selectedDocumentIds.length} selected</Pill>}>
        {buyerSafeProof.length ? (
          <div className="stack-list">
            {buyerSafeProof.map((document) => (
              <button key={document.id} type="button" className="stack-item stack-item--interactive" onClick={() => toggleProof(document.id)}>
                <div className="stack-item__top">
                  <div>
                    <div className="stack-item__title">{document.type} · {document.title}</div>
                    <div className="stack-item__copy">{document.summary || 'No summary provided.'}</div>
                  </div>
                  <Pill tone={selectedDocumentIds.includes(document.id) ? 'emerald' : 'slate'}>{selectedDocumentIds.includes(document.id) ? 'Included' : 'Excluded'}</Pill>
                </div>
              </button>
            ))}
          </div>
        ) : <EmptyState compact title="No verified proof available" description="Approve registration, Coggins, transfer, bill of sale, media, or vet records in Proof Vault before generating a premium packet." action={<Link to="/documents?upload=1" className="button button--primary button--compact">Upload proof</Link>} />}
      </Panel>

      <Panel title="4. Generate and log packet" meta={<Pill tone="slate">XBAR watermark + disclaimer</Pill>}>
        <div className="stack-list">
          <div className="stack-item"><div className="stack-item__title">PDF-ready output</div><div className="stack-item__copy">The packet opens as branded HTML with XBAR watermark, buyer verification disclaimer, release blockers, proof list, and seller review section. Use browser print to save as PDF.</div></div>
          <div className="stack-item"><div className="stack-item__title">Local packet log</div><div className="stack-item__copy">Preview/export events are saved in local browser storage under {packetLogKey}. Cloud audit can replace this later.</div></div>
        </div>
        <div className="inline-actions">
          <button className="button button--primary button--compact" type="button" onClick={previewSalePacket}>Preview packet</button>
          <button className="button button--ghost button--compact" type="button" onClick={exportSalePacket} disabled={Boolean(packetExportGate(subscription) || localSalePacket?.blockers.length)}>Export packet</button>
          <button className="button button--ghost button--compact" type="button" onClick={copyShareLink}>Copy buyer link</button>
        </div>
        {packetExportGate(subscription) ? <div className="field-error">{packetExportGate(subscription)} <Link to="/subscriptions">Upgrade to unlock.</Link></div> : null}
      </Panel>

      <Panel title="XBAR LLC legal and commercial documents" meta={<Pill tone="blue">TM / billing / disclaimer</Pill>}>
        <p className="stack-item__copy" style={{ marginBottom: '14px' }}>
          PDF-ready legal documents for charging customers, buyer packet disclaimers, trademark notice, acceptable use, privacy, and subscription billing. These are operational baseline documents and should be reviewed by counsel before final launch.
        </p>
        <div className="stack-list">
          {legalDocuments.map((legalDoc) => (
            <div key={legalDoc.id} className="stack-item">
              <div className="stack-item__top">
                <div>
                  <div className="stack-item__title">{legalDoc.shortTitle}</div>
                  <div className="stack-item__copy">{legalDoc.purpose}</div>
                </div>
                <Pill tone={legalDoc.id === 'trademark-notice' ? 'amber' : 'blue'}>{legalDoc.id === 'trademark-notice' ? 'TM' : 'Legal'}</Pill>
              </div>
              <div className="inline-actions inline-actions--card">
                <button className="button button--primary button--compact" type="button" onClick={() => previewLegalDocument(legalDoc)}>Preview / print PDF</button>
                <button className="button button--ghost button--compact" type="button" onClick={() => downloadLegalDocument(legalDoc)}>Download PDF-ready file</button>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <section className="surface-panel">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <SurfaceTabs items={tierOrder} active={activeTier} onChange={(tier) => setActiveTier(tier as DocumentTemplateTier)} />
          <div className="flex flex-wrap gap-2"><Pill tone="blue">{templatesByTier[activeTier].length} templates</Pill><Pill tone="slate">{tierCopy(activeTier)}</Pill></div>
        </div>
      </section>

      <div className="dashboard-grid dashboard-grid--primary">
        <Panel title="Other document templates" meta={<Pill tone="blue">{activeTier}</Pill>}>
          <div className="stack-list">
            {templatesByTier[activeTier].map((template) => (
              <TemplateCard key={template.id} template={template} active={template.id === selectedTemplate.id} locked={!planAllows(subscription.tier, template.minimumPlan)} onSelect={() => setSelectedTemplateId(template.id)} />
            ))}
          </div>
        </Panel>

        <Panel title="Template prefill" meta={<Pill tone={locked ? 'rose' : 'emerald'}>{locked ? `${selectedTemplate.minimumPlan}+` : 'Ready'}</Pill>}>
          {prefilled ? (
            <div className="stack-list">
              <div className="stack-item"><div className="stack-item__title">{prefilled.title}</div><div className="stack-item__copy">{prefilled.summary}</div></div>
              <div className="stack-item"><div className="stack-item__title">Missing before signature</div><div className="token-row">{prefilled.missingFields.length ? prefilled.missingFields.map((field) => <Pill key={field} tone="amber">{field}</Pill>) : <Pill tone="emerald">No required gaps flagged</Pill>}</div></div>
              <div className="inline-actions">
                <button className="button button--primary button--compact" type="button" onClick={openPreview} disabled={locked}>Preview</button>
                <button className="button button--ghost button--compact" type="button" onClick={downloadDocument} disabled={locked}>Download report</button>
                <button className="button button--ghost button--compact" type="button" onClick={() => window.print()} disabled={locked}>Print / save PDF</button>
              </div>
              {locked ? <div className="field-error">This template belongs to {selectedTemplate.minimumPlan}+ plan positioning. Current plan: {subscription.tier}.</div> : null}
            </div>
          ) : null}
        </Panel>
      </div>

      <Panel title="Generated preview data" meta={<Pill tone="slate">Review only</Pill>}>
        <div className="table-shell">
          <table className="data-table">
            <tbody>
              <tr><th>Horse</th><td>{selectedHorse.name}</td></tr>
              <tr><th>Owner</th><td>{selectedHorse.owner || workspaceProfile.defaultOwnerName}</td></tr>
              <tr><th>Registration</th><td>{selectedHorse.registrationNumber || selectedHorse.aqhaNumber || 'Missing'}</td></tr>
              <tr><th>Microchip</th><td>{selectedHorse.microchipId || 'Missing'}</td></tr>
              <tr><th>Coggins / health docs</th><td>{documents.filter((document) => document.horseId === selectedHorse.id && (document.type === 'Coggins' || document.type === 'Vet Record')).length}</td></tr>
              <tr><th>Ready source records</th><td>{documents.filter((document) => document.horseId === selectedHorse.id && document.state === 'Ready').length}</td></tr>
              <tr><th>Buyer link</th><td>{sharedLink}</td></tr>
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

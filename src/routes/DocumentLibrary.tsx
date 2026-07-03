import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { generateDocumentFromTemplateRemote, hasBackendIdentity } from '@/lib/backendApi';
import { useCloudStore } from '@/store/useCloudStore';
import { EmptyState } from '@/components/EmptyState';
import { MetricCard, Panel, Pill, SurfaceTabs } from '@/components/app-ui';
import { UsageMeterPanel } from '@/components/UsageMeterPanel';
import { buildPrefilledDocument, documentTemplateLibrary, downloadHtmlFile, type DocumentTemplate, type DocumentTemplateTier } from '@/lib/documentTemplateLibrary';
import { downloadLegalHtml, legalDocuments, openPrintableLegalDocument } from '@/lib/legalDocuments';
import { buildLocalSalePacket, getBuyerSafePacketDocuments } from '@/lib/localSalePacketGenerator';
import { appendLocalSalePacketLog, localSalePacketLogKey } from '@/lib/localSalePacketLog';
import { buildSharePath } from '@/lib/xbarRuntime';
import { useUiStore } from '@/store/useUiStore';
import { useXbarStore } from '@/store/useXbarStore';
import type { SubscriptionTier } from '@/types/xbar';

const tierOrder: DocumentTemplateTier[] = ['Basic', 'Pro', 'Business'];
const planRank: Record<SubscriptionTier, number> = { Starter: 0, Professional: 1, 'Ranch Ops': 2, Enterprise: 3 };

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
  const currentRole = useXbarStore((state) => state.currentRole);
  const createSalePacketBuild = useXbarStore((state) => state.createSalePacketBuild);
  const recordSharedChannel = useXbarStore((state) => state.recordSharedChannel);
  const pushToast = useUiStore((state) => state.pushToast);
  const navigate = useNavigate();
  const session = useCloudStore((state) => state.session);
  const workspaceId = useCloudStore((state) => state.workspaceId);
  const [activeTier, setActiveTier] = useState<DocumentTemplateTier>('Pro');
  const [selectedHorseId, setSelectedHorseId] = useState(horses[0]?.id ?? '');
  const [selectedTemplateId, setSelectedTemplateId] = useState(documentTemplateLibrary.find((template) => template.id === 'sales-packet')?.id ?? documentTemplateLibrary[0].id);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

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
    appendLocalSalePacketLog({ horseId: selectedHorse.id, horseName: selectedHorse.name, action: 'previewed', packetScore: localSalePacket.packetScore, releaseStatus: localSalePacket.releaseStatus, includedDocuments: selectedDocumentIds.length });
    pushToast({ title: 'Sale packet preview opened', message: `${selectedHorse.name} packet was logged locally.`, tone: 'success' });
  };

  const exportSalePacket = () => {
    if (!localSalePacket || !selectedHorse) return;
    if (localSalePacket.blockers.length) {
      pushToast({ title: 'Packet release blocked', message: localSalePacket.blockers[0], tone: 'error' });
      return;
    }
    const build = createSalePacketBuild({
      horseId: selectedHorse.id,
      watermark: 'XBAR buyer packet',
      documentIds: selectedDocumentIds,
      includesBillOfSale: false,
      createdBy: currentRole,
    });
    if (!build.ok) {
      pushToast({ title: 'Packet export blocked', message: build.message, tone: 'warning' });
      if (build.message.toLowerCase().includes('upgrade')) navigate('/subscriptions');
      return;
    }
    downloadSalePacketHtml(localSalePacket.fileName, localSalePacket.html);
    appendLocalSalePacketLog({ horseId: selectedHorse.id, horseName: selectedHorse.name, action: 'exported', packetScore: localSalePacket.packetScore, releaseStatus: localSalePacket.releaseStatus, includedDocuments: selectedDocumentIds.length });
    pushToast({ title: 'Sale packet exported', message: `${selectedHorse.name} buyer packet downloaded and logged locally. Open it and print to PDF.`, tone: 'success' });
  };

  const downloadDocument = () => {
    if (!prefilled) return;
    downloadHtmlFile(prefilled.fileName, prefilled.html);
    pushToast({ title: 'Document exported', message: `${prefilled.template.label} downloaded as a print-ready HTML report. Use browser print to save as PDF.`, tone: 'success' });
  };

  // Cloud workspaces generate the real PDF server-side; a tier refusal
  // becomes an upgrade moment instead of a dead end.
  const generatePdf = async () => {
    if (!selectedHorse) return;
    const auth = { workspaceId, accessToken: session?.access_token ?? '' };
    if (!hasBackendIdentity(auth)) {
      pushToast({
        title: 'Sign in for PDF generation',
        message: 'Server-side PDF generation needs a cloud workspace session. Use "Download report" + print to PDF in local mode.',
        tone: 'warning',
      });
      return;
    }
    setIsGeneratingPdf(true);
    const remote = await generateDocumentFromTemplateRemote(auth, {
      templateId: selectedTemplate.id,
      horseId: selectedHorse.id,
    });
    setIsGeneratingPdf(false);
    if (remote.ok) {
      if (typeof window !== 'undefined' && remote.downloadUrl) {
        window.open(remote.downloadUrl, '_blank', 'noopener,noreferrer');
      }
      pushToast({
        title: 'PDF generated',
        message: remote.missingFields.length
          ? `${remote.fileName} is ready. ${remote.missingFields.length} fields were left blank: ${remote.missingFields.slice(0, 4).join(', ')}.`
          : `${remote.fileName} is ready and stored with this horse's documents.`,
        tone: 'success',
      });
      return;
    }
    if (remote.tierBlock) {
      pushToast({
        title: `This template needs the ${remote.tierBlock.requiredPlan} plan`,
        message: remote.message,
        tone: 'warning',
      });
      navigate(`/subscriptions?plan=${encodeURIComponent(remote.tierBlock.requiredPlan)}`);
      return;
    }
    pushToast({ title: 'PDF generation failed', message: remote.message, tone: 'error' });
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

  const copyShareLink = async () => {
    if (!sharedLink || !selectedHorse) return;
    const release = await recordSharedChannel(selectedHorse.id, 'Direct Link');
    if (!release.ok) {
      pushToast({ title: 'Buyer link blocked', message: release.message, tone: 'warning' });
      navigate('/shared-access');
      return;
    }
    await navigator.clipboard.writeText(sharedLink);
    pushToast({ title: 'Audited buyer link copied', message: 'Seller release is confirmed and the direct-link share was recorded.', tone: 'success' });
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
      <div className="surface-hero">
        <div className="surface-hero__top">
          <div>
            <span className="surface-hero__eyebrow">Sale Packet Generator</span>
            <h1 className="surface-hero__title">Generate PDF-ready buyer packets before cloud is live</h1>
            <p className="surface-hero__copy">Select a horse, see release blockers, choose included documents, add the XBAR disclaimer and watermark, export the packet, and log the generation locally.</p>
          </div>
          <div className="surface-hero__stats">
            <div className="surface-hero__stat"><span>Packet score</span><strong>{localSalePacket?.packetScore ?? 0}%</strong></div>
            <div className="surface-hero__stat"><span>Blockers</span><strong>{localSalePacket?.blockers.length ?? 0}</strong></div>
            <div className="surface-hero__stat"><span>Included documents</span><strong>{selectedDocumentIds.length}</strong></div>
            <div className="surface-hero__stat"><span>Legal docs</span><strong>{legalDocuments.length}</strong></div>
          </div>
        </div>
      </div>

      <div className="metric-grid">
        <MetricCard label="Release gate" value={localSalePacket?.releaseStatus ?? 'Pending'} detail={localSalePacket?.blockers[0] ?? 'No hard blocker flagged'} tone={localSalePacket?.blockers.length ? 'rose' : 'emerald'} />
        <MetricCard label="Buyer documents" value={`${selectedDocumentIds.length}/${buyerSafeProof.length}`} detail="Ready records selected for packet" tone="blue" />
        <MetricCard label="Watermark" value="XBAR" detail="Disclaimer and trademark notice included" tone="slate" />
        <MetricCard label="Export" value="HTML/PDF" detail="Download then print to PDF" tone="emerald" />
      </div>

      <UsageMeterPanel compact />

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
            )) : <div className="stack-item"><div className="stack-item__title">Release gate clear</div><div className="stack-item__copy">No hard blocker flagged. Review warnings and documents before sending.</div></div>}
            {localSalePacket?.warnings.slice(0, 4).map((warning) => <div key={warning} className="stack-item"><div className="stack-item__title">Warning</div><div className="stack-item__copy">{warning}</div></div>)}
          </div>
        </Panel>
      </div>

      <Panel title="3. Select included documents" meta={<Pill tone="blue">{selectedDocumentIds.length} selected</Pill>}>
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
        ) : <EmptyState compact title="No approved documents available" description="Approve registration, Coggins, transfer, bill of sale, media, or vet records before generating a premium packet." action={<Link to="/documents?upload=1" className="button button--primary button--compact">Upload Documents</Link>} />}
      </Panel>

      <Panel title="4. Generate and log packet" meta={<Pill tone="slate">XBAR watermark + disclaimer</Pill>}>
        <div className="stack-list">
          <div className="stack-item"><div className="stack-item__title">PDF-ready output</div><div className="stack-item__copy">The packet opens as branded HTML with XBAR watermark, buyer verification disclaimer, release blockers, document list, and seller review section. Use browser print to save as PDF.</div></div>
          <div className="stack-item"><div className="stack-item__title">Local packet log</div><div className="stack-item__copy">Preview/export events are saved in local browser storage under {localSalePacketLogKey}. Cloud audit can replace this later.</div></div>
        </div>
        <div className="inline-actions">
          <button className="button button--primary button--compact" type="button" onClick={previewSalePacket}>Preview packet</button>
          <button className="button button--ghost button--compact" type="button" onClick={exportSalePacket}>Export packet</button>
          <button className="button button--ghost button--compact" type="button" onClick={() => void copyShareLink()}>Copy buyer link</button>
        </div>
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
                <button className="button button--primary button--compact" type="button" onClick={() => void generatePdf()} disabled={isGeneratingPdf}>
                  {isGeneratingPdf ? 'Generating PDF…' : locked ? `Generate PDF (${selectedTemplate.minimumPlan}+)` : 'Generate PDF'}
                </button>
                <button className="button button--ghost button--compact" type="button" onClick={downloadDocument} disabled={locked}>Download report</button>
                <button className="button button--ghost button--compact" type="button" onClick={() => window.print()} disabled={locked}>Print / save PDF</button>
              </div>
              {locked ? (
                <div className="field-error">
                  This template belongs to {selectedTemplate.minimumPlan}+ plan positioning. Current plan: {subscription.tier}.{' '}
                  {selectedTemplate.minimumPlan === 'Professional'
                    ? 'Upgrading to Professional unlocks watermarked sale packets and buyer folders.'
                    : selectedTemplate.minimumPlan === 'Ranch Ops'
                      ? 'Upgrading to Ranch Ops unlocks team roles, the breeding program, and equipment at scale.'
                      : `Upgrading to ${selectedTemplate.minimumPlan} unlocks this template.`}
                </div>
              ) : null}
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

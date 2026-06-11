import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { generateDocumentFromTemplateRemote, hasBackendIdentity } from '@/lib/backendApi';
import { useCloudStore } from '@/store/useCloudStore';
import { EmptyState } from '@/components/EmptyState';
import { MetricCard, Panel, Pill, SurfaceTabs } from '@/components/app-ui';
import { buildPrefilledDocument, documentTemplateLibrary, downloadHtmlFile, type DocumentTemplate, type DocumentTemplateTier } from '@/lib/documentTemplateLibrary';
import { downloadLegalHtml, legalDocuments, openPrintableLegalDocument } from '@/lib/legalDocuments';
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

export default function DocumentLibrary() {
  const horses = useXbarStore((state) => state.horses);
  const documents = useXbarStore((state) => state.documents);
  const ownershipRecords = useXbarStore((state) => state.ownershipRecords);
  const workspaceProfile = useXbarStore((state) => state.workspaceProfile);
  const subscription = useXbarStore((state) => state.subscription);
  const pushToast = useUiStore((state) => state.pushToast);
  const navigate = useNavigate();
  const session = useCloudStore((state) => state.session);
  const workspaceId = useCloudStore((state) => state.workspaceId);
  const [activeTier, setActiveTier] = useState<DocumentTemplateTier>('Basic');
  const [selectedHorseId, setSelectedHorseId] = useState(horses[0]?.id ?? '');
  const [selectedTemplateId, setSelectedTemplateId] = useState(documentTemplateLibrary[0].id);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  const selectedHorse = horses.find((horse) => horse.id === selectedHorseId) ?? horses[0];
  const selectedTemplate = documentTemplateLibrary.find((template) => template.id === selectedTemplateId) ?? documentTemplateLibrary[0];
  const selectedOwnership = ownershipRecords.find((record) => record.horseId === selectedHorse?.id);
  const sharedLink = selectedHorse ? `${window.location.origin}${buildSharePath(selectedHorse.id)}` : '';
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
  const readyDocCount = documents.filter((document) => document.state === 'Ready').length;
  const salePacketTemplates = documentTemplateLibrary.filter((template) => template.id === 'sales-packet' || template.label.includes('Sale') || template.label.includes('Transfer'));

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

  const copyShareLink = () => {
    if (!sharedLink) return;
    void navigator.clipboard.writeText(sharedLink).then(() => {
      pushToast({ title: 'Secure link copied', message: 'Use shared access controls before sending this buyer-facing link.', tone: 'success' });
    });
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
            <span className="surface-hero__eyebrow">Document Library</span>
            <h1 className="surface-hero__title">Pre-filled contracts, legal notices, reports, and sale packets</h1>
            <p className="surface-hero__copy">Pull horse, owner, barn, Coggins, health, ownership, and document-vault data into templates, while keeping XBAR commercial terms, trademark notices, and disclaimers printable from the same library.</p>
          </div>
          <div className="surface-hero__stats">
            <div className="surface-hero__stat"><span>Templates</span><strong>{documentTemplateLibrary.length}</strong></div>
            <div className="surface-hero__stat"><span>Legal docs</span><strong>{legalDocuments.length}</strong></div>
            <div className="surface-hero__stat"><span>Sale packet tools</span><strong>{salePacketTemplates.length}</strong></div>
            <div className="surface-hero__stat"><span>Plan</span><strong>{subscription.tier}</strong></div>
          </div>
        </div>
      </div>

      <div className="metric-grid">
        <MetricCard label="Dynamic prefill" value="Live" detail="Horse, owner, barn, health, sale, and document fields" tone="emerald" />
        <MetricCard label="Legal packet" value={`${legalDocuments.length}`} detail="Terms, privacy, billing, trademark, disclaimer, acceptable use" tone="blue" />
        <MetricCard label="Ready docs" value={String(readyDocCount)} detail="Verified proof records available for document workflows" tone="slate" />
        <MetricCard label="Missing fields" value={String(prefilled?.missingFields.length ?? 0)} detail="Review before e-signature" tone={prefilled?.missingFields.length ? 'amber' : 'emerald'} />
      </div>

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
        <Panel title="Choose template" meta={<Pill tone="blue">{activeTier}</Pill>}>
          <div className="stack-list">
            {templatesByTier[activeTier].map((template) => (
              <TemplateCard key={template.id} template={template} active={template.id === selectedTemplate.id} locked={!planAllows(subscription.tier, template.minimumPlan)} onSelect={() => setSelectedTemplateId(template.id)} />
            ))}
          </div>
        </Panel>

        <Panel title="Dynamic prefill" meta={<Pill tone={locked ? 'rose' : 'emerald'}>{locked ? `${selectedTemplate.minimumPlan}+` : 'Ready'}</Pill>}>
          <div className="form-grid form-grid--tight">
            <label className="field-stack">
              <span className="field-label">Horse</span>
              <select className="field-input" value={selectedHorse?.id ?? ''} onChange={(event) => setSelectedHorseId(event.target.value)}>
                {horses.map((horse) => <option key={horse.id} value={horse.id}>{horse.name}</option>)}
              </select>
            </label>
            <label className="field-stack">
              <span className="field-label">Template</span>
              <input className="field-input" value={selectedTemplate.label} readOnly />
            </label>
          </div>

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
                <button className="button button--ghost button--compact" type="button" onClick={copyShareLink}>Copy secure link</button>
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

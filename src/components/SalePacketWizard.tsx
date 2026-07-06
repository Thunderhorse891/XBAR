import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { createSalePacketRemote, hasBackendIdentity } from '@/lib/backendApi';
import { billingPathForTier } from '@/lib/billingRoutes';
import { assessRevenueAtRisk, computeHorseEconomics } from '@/lib/businessIntelligence';
import { formatCompactCurrency } from '@/lib/format';
import { useCloudStore } from '@/store/useCloudStore';
import { useUiStore } from '@/store/useUiStore';
import { useXbarStore } from '@/store/useXbarStore';
import './confirmActionDialog.css';

/*
 * The core paid workflow: select horse → release gate (title/transfer is a
 * HARD gate, stale Coggins requires explicit disclosure) → choose proof →
 * buyer + watermark → generate (real PDF in cloud workspaces, recorded build
 * in local mode) → buyer follow-up opens automatically (packet-shared event +
 * sales lead) with the next money action offered.
 */

const STEPS = ['Horse', 'Release gate', 'Documents', 'Buyer', 'Generate'] as const;

type BuyerPacketForm = {
  buyerName: string;
  buyerEmail: string;
  watermark: string;
};

export function SalePacketWizard({
  open,
  initialHorseId,
  onClose,
}: {
  open: boolean;
  initialHorseId?: string | null;
  onClose: () => void;
}) {
  const horses = useXbarStore((state) => state.horses);
  const documents = useXbarStore((state) => state.documents);
  const ownershipRecords = useXbarStore((state) => state.ownershipRecords);
  const expenseReceipts = useXbarStore((state) => state.expenseReceipts);
  const salesLeads = useXbarStore((state) => state.salesLeads);
  const createSalePacketBuild = useXbarStore((state) => state.createSalePacketBuild);
  const logBuyerRoomEvent = useXbarStore((state) => state.logBuyerRoomEvent);
  const createSalesLead = useXbarStore((state) => state.createSalesLead);
  const currentRole = useXbarStore((state) => state.currentRole);
  const session = useCloudStore((state) => state.session);
  const workspaceId = useCloudStore((state) => state.workspaceId);
  const pushToast = useUiStore((state) => state.pushToast);
  const navigate = useNavigate();

  const [step, setStep] = useState(0);
  const [horseId, setHorseId] = useState<string>(initialHorseId ?? '');
  const [selectedDocIds, setSelectedDocIds] = useState<string[] | null>(null);
  const [cogginsDisclosed, setCogginsDisclosed] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generated, setGenerated] = useState<{ packetId: string; downloadUrl?: string } | null>(null);
  const buyerForm = useForm<BuyerPacketForm>({
    defaultValues: { buyerName: '', buyerEmail: '', watermark: '' },
  });
  const buyerName = buyerForm.watch('buyerName');
  const buyerEmail = buyerForm.watch('buyerEmail');
  const watermark = buyerForm.watch('watermark');

  const effectiveHorseId = horseId || initialHorseId || '';
  const horse = horses.find((item) => item.id === effectiveHorseId);

  const risk = useMemo(
    () => assessRevenueAtRisk(horses, ownershipRecords, documents).items.find((item) => item.horseId === effectiveHorseId),
    [horses, ownershipRecords, documents, effectiveHorseId],
  );
  const economics = useMemo(
    () => (horse ? computeHorseEconomics(horse, expenseReceipts) : null),
    [horse, expenseReceipts],
  );

  // Title/transfer problems hard-block release; a stale Coggins can be
  // disclosed and acknowledged, never silently ignored.
  const ownershipBlockers = (risk?.blockers ?? []).filter(
    (blocker) => !blocker.includes('Coggins') && !blocker.includes('medical review'),
  );
  const cogginsBlocked = (risk?.blockers ?? []).some((blocker) => blocker.includes('Coggins'));
  const careHold = horse?.status === 'Medical Review';
  const readyDocs = documents.filter((document) => document.horseId === effectiveHorseId && document.state === 'Ready');
  const docSelection = selectedDocIds ?? readyDocs.map((document) => document.id);
  const defaultWatermark = `Copy for ${buyerName.trim() || 'buyer review'} – ${new Date().toISOString().slice(0, 10)}`;
  const effectiveWatermark = watermark.trim() || defaultWatermark;

  if (!open) return null;

  const reset = () => {
    setStep(0); setHorseId(''); setSelectedDocIds(null); setCogginsDisclosed(false);
    buyerForm.reset(); setGenerated(null);
  };
  const close = () => { reset(); onClose(); };

  const stepBlockReason =
    step === 0 && !horse ? 'Select a horse to continue.'
    : step === 1 && ownershipBlockers.length ? 'Title & transfer blockers must be cleared before a packet can be released.'
    : step === 1 && (cogginsBlocked || careHold) && !cogginsDisclosed ? 'Acknowledge the buyer disclosure to continue.'
    : step === 2 && docSelection.length === 0 ? 'Include at least one approved document.'
    : '';

  const generate = async () => {
    if (!horse) return;
    setIsGenerating(true);
    const auth = { workspaceId, accessToken: session?.access_token ?? '' };
    let downloadUrl: string | undefined;

    if (hasBackendIdentity(auth)) {
      const remote = await createSalePacketRemote(auth, {
        horseId: horse.id,
        buyerName: buyerName.trim() || undefined,
        buyerEmail: buyerEmail.trim() || undefined,
        watermarkText: effectiveWatermark,
        documentIds: docSelection,
      });
      if (!remote.ok) {
        setIsGenerating(false);
        if (remote.tierBlock) {
          pushToast({ title: `Sale packets need the ${remote.tierBlock.requiredPlan} plan`, message: remote.message, tone: 'warning' });
          close();
          navigate(billingPathForTier(remote.tierBlock.requiredPlan));
          return;
        }
        pushToast({ title: 'Packet PDF failed', message: remote.message, tone: 'error' });
        return;
      }
      downloadUrl = remote.downloadUrl;
    }

    const build = createSalePacketBuild({
      horseId: horse.id,
      buyerName: buyerName.trim() || undefined,
      buyerEmail: buyerEmail.trim() || undefined,
      watermark: effectiveWatermark,
      documentIds: docSelection,
      includesBillOfSale: false,
      createdBy: currentRole,
      downloadUrl,
    });
    setIsGenerating(false);

    if (!build.ok || !build.packet) {
      pushToast({ title: 'Packet blocked', message: build.message, tone: 'error' });
      return;
    }

    // Buyer follow-up opens automatically: share event + sales lead.
    if (buyerName.trim()) {
      logBuyerRoomEvent({
        horseId: horse.id,
        kind: 'packet-shared',
        actor: buyerName.trim(),
        packetId: build.packet.id,
        note: buyerEmail.trim() ? `Shared to ${buyerEmail.trim()}` : 'Shared directly',
      });
      const existingLead = salesLeads.some(
        (lead) => lead.horseId === horse.id && lead.name.toLowerCase() === buyerName.trim().toLowerCase(),
      );
      if (!existingLead) {
        createSalesLead({ name: buyerName.trim(), channel: 'Referral', horseId: horse.id, shareReady: true });
      }
    }

    if (downloadUrl && typeof window !== 'undefined') {
      window.open(downloadUrl, '_blank', 'noopener,noreferrer');
    }
    setGenerated({ packetId: build.packet.id, downloadUrl });
    pushToast({
      title: downloadUrl ? 'Sale packet PDF ready' : 'Sale packet recorded',
      message: downloadUrl
        ? 'Watermarked PDF opened in a new tab. Buyer activity is now tracked in Buyer follow-up.'
        : `${build.message} Cloud sign-in generates the watermarked PDF; Buyer follow-up is tracking this buyer either way.`,
      tone: 'success',
    });
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) close(); }}>
      <DialogContent
        className="confirm-dialog"
        style={{ width: 'min(640px, 100%)' }}
      >
        <DialogHeader>
          <DialogTitle className="confirm-dialog__title">Sale packet generator</DialogTitle>
          <DialogDescription>Build a buyer packet, open Buyer follow-up, and keep the sale organized.</DialogDescription>
        </DialogHeader>
        <div style={{ display: 'flex', gap: 6, marginTop: 12 }} aria-label={`Step ${step + 1} of ${STEPS.length}`}>
          {STEPS.map((label, index) => (
            <div key={label} style={{ flex: 1 }}>
              <div style={{ height: 4, borderRadius: 2, background: index <= step ? '#18a8ff' : 'rgba(96,124,154,0.3)' }} />
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: index === step ? '#1466d8' : '#8aa0b8' }}>{label}</span>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 16, minHeight: 220 }}>
          {step === 0 && (
            <div className="confirm-dialog__acks">
              <Select
                value={effectiveHorseId}
                onValueChange={(value) => {
                  setHorseId(value);
                  setSelectedDocIds(null);
                  setCogginsDisclosed(false);
                }}
              >
                <SelectTrigger aria-label="Select horse for sale packet">
                  <SelectValue placeholder="Select a sale horse" />
                </SelectTrigger>
                <SelectContent>
                  {horses
                    .filter((item) => (item.sale?.askPrice ?? 0) > 0 || item.status === 'Sale Prep' || item.id === effectiveHorseId)
                    .map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name} · {item.sale?.askPrice ? formatCompactCurrency(item.sale.askPrice) : 'No asking price'} · {item.status}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {horse ? <p><strong>{horse.name}</strong> is selected for release-gate review.</p> : null}
              {horses.length === 0 && <p>No horses yet. Close this and add your first horse to begin a sale.</p>}
            </div>
          )}

          {step === 1 && horse && (
            <div>
              {ownershipBlockers.length > 0 ? (
                <>
                  <p className="confirm-dialog__hint" style={{ color: '#a8343e', marginTop: 0 }}>
                    Release gate: this packet cannot be issued until title &amp; transfer is provable.
                  </p>
                  <ul className="confirm-dialog__consequences">
                    {ownershipBlockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
                  </ul>
                  <button
                    className="button button--primary button--compact"
                    type="button"
                    style={{ marginTop: 10 }}
                    onClick={() => { close(); navigate('/ownership'); }}
                  >
                    Fix in Ownership registry
                  </button>
                </>
              ) : (
                <p style={{ fontSize: 14, color: '#303842', marginTop: 0 }}>Title &amp; transfer is provable. This packet can be released.</p>
              )}
              {(cogginsBlocked || careHold) && ownershipBlockers.length === 0 && (
                <div className="confirm-dialog__acks" style={{ marginTop: 8 }}>
                  <label className="confirm-dialog__ack" htmlFor="wizard-coggins-disclosure">
                    <Checkbox id="wizard-coggins-disclosure" checked={cogginsDisclosed} onCheckedChange={(value) => setCogginsDisclosed(Boolean(value))} />
                    <span>
                      {cogginsBlocked && careHold
                        ? 'No current Coggins is on file and this horse is under active medical review. I will disclose both to the buyer.'
                        : careHold
                          ? `${horse.name} is under active medical review. I will disclose the care hold to the buyer.`
                          : 'No current Coggins is on file. I will disclose this to the buyer in the packet.'}
                      {cogginsBlocked && (
                        <> (Or close and <button type="button" className="button button--ghost button--compact" onClick={() => { close(); navigate(`/documents?upload=1&horse=${horse.id}`); }}>upload the Coggins now</button>.)</>
                      )}
                      {careHold && !cogginsBlocked && (
                        <> (Or close and <button type="button" className="button button--ghost button--compact" onClick={() => { close(); navigate(`/medical?horse=${horse.id}`); }}>review the care hold</button>.)</>
                      )}
                    </span>
                  </label>
                </div>
              )}
              {economics && (
                <div className="confirm-dialog__proof" style={{ marginTop: 14 }}>
                  <strong>Pricing:</strong> cost to date {formatCompactCurrency(economics.costToDate)} · burn {formatCompactCurrency(economics.monthlyBurn)}/mo ·
                  break-even {formatCompactCurrency(economics.breakEvenPrice)} · <strong>do not discount below {formatCompactCurrency(economics.safeDiscountFloor)}</strong>
                  {economics.askPrice > 0 ? <> · margin at ask {formatCompactCurrency(economics.projectedMargin)} ({economics.marginPercent}%)</> : ' · set an asking price on the horse record'}
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="confirm-dialog__acks">
              {readyDocs.length === 0 && (
                <p style={{ fontSize: 14, color: '#303842' }}>
                  No approved documents for this horse yet.{' '}
                  <button type="button" className="button button--ghost button--compact" onClick={() => { close(); navigate(`/documents?upload=1&horse=${effectiveHorseId}`); }}>Upload Documents</button>
                </p>
              )}
              {readyDocs.length > 0 ? (
                <Table aria-label="Approved sale packet documents">
                  <TableHeader>
                    <TableRow><TableHead>Include</TableHead><TableHead>Document</TableHead><TableHead>Type</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {readyDocs.map((document) => (
                      <TableRow key={document.id}>
                        <TableCell>
                          <Checkbox
                            aria-label={`Include ${document.title}`}
                            checked={docSelection.includes(document.id)}
                            onCheckedChange={(value) =>
                              setSelectedDocIds(value ? [...docSelection, document.id] : docSelection.filter((id) => id !== document.id))
                            }
                          />
                        </TableCell>
                        <TableCell><strong>{document.title}</strong></TableCell>
                        <TableCell>{document.type}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : null}
            </div>
          )}

          {step === 3 && (
            <Form {...buyerForm}>
              <form className="confirm-dialog__type-check" style={{ marginTop: 0, gap: 10 }} onSubmit={(event) => event.preventDefault()}>
                <FormField
                  control={buyerForm.control}
                  name="buyerName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Buyer name</FormLabel>
                      <FormControl><Input {...field} placeholder="John Smith" /></FormControl>
                      <FormDescription>Opens Buyer follow-up and creates a buyer lead.</FormDescription>
                    </FormItem>
                  )}
                />
                <FormField
                  control={buyerForm.control}
                  name="buyerEmail"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Buyer email</FormLabel>
                      <FormControl><Input {...field} type="email" placeholder="buyer@example.com" /></FormControl>
                      <FormDescription>Optional. Used for packet attribution and follow-up.</FormDescription>
                    </FormItem>
                  )}
                />
                <FormField
                  control={buyerForm.control}
                  name="watermark"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Watermark</FormLabel>
                      <FormControl><Input {...field} placeholder={defaultWatermark} /></FormControl>
                      <FormDescription>Stamped on every released page.</FormDescription>
                    </FormItem>
                  )}
                />
              </form>
            </Form>
          )}

          {step === 4 && !generated && horse && (
            <div>
              <ul className="confirm-dialog__consequences">
                <li>{docSelection.length} approved document{docSelection.length === 1 ? '' : 's'} bundled for {horse.name}.</li>
                <li>Watermark “{effectiveWatermark}” on every page.</li>
                <li>{buyerName.trim() ? `Buyer follow-up opens for ${buyerName.trim()} with a packet-shared event and a sales lead.` : 'No buyer named — packet generates without a buyer follow-up entry.'}</li>
                <li>The build and buyer attribution are written to the audit log.</li>
              </ul>
              <button className="confirm-dialog__confirm confirm-dialog__confirm--legal" type="button" style={{ width: '100%', marginTop: 14 }} disabled={isGenerating} onClick={() => void generate()}>
                {isGenerating ? 'Assembling packet…' : 'Generate sale packet'}
              </button>
            </div>
          )}

          {step === 4 && generated && horse && (
            <div>
              <p style={{ fontSize: 14, fontWeight: 700, color: '#1466d8', marginTop: 0 }}>Packet ready. Next money action:</p>
              <div className="confirm-dialog__acks">
                {generated.downloadUrl && (
                  <a className="button button--primary button--compact" href={generated.downloadUrl} target="_blank" rel="noreferrer">Download packet PDF</a>
                )}
                <button className="button button--ghost button--compact" type="button" onClick={() => { close(); navigate('/shared-access'); }}>
                  Open Listings sharing for {horse.name}
                </button>
                <button className="button button--ghost button--compact" type="button" onClick={() => { close(); navigate('/sales'); }}>
                  Open Sales to track {buyerName.trim() || 'this buyer'}
                </button>
                <button
                  className="button button--ghost button--compact"
                  type="button"
                  onClick={() => {
                    logBuyerRoomEvent({ horseId: horse.id, kind: 'packet-viewed', actor: buyerName.trim() || 'Buyer', packetId: generated.packetId });
                    pushToast({ title: 'Buyer view logged', message: 'Buyer follow-up now shows the packet was viewed.', tone: 'success' });
                  }}
                >
                  Log that the buyer viewed it
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="confirm-dialog__actions">
          <button className="confirm-dialog__cancel" type="button" onClick={step === 0 || generated ? close : () => setStep(step - 1)}>
            {step === 0 || generated ? 'Close' : 'Back'}
          </button>
          {step < 4 && (
            <button
              className="confirm-dialog__confirm confirm-dialog__confirm--legal"
              type="button"
              disabled={Boolean(stepBlockReason)}
              title={stepBlockReason || undefined}
              onClick={() => setStep(step + 1)}
            >
              Continue
            </button>
          )}
        </div>
        {stepBlockReason && <p className="confirm-dialog__hint">{stepBlockReason}</p>}
      </DialogContent>
    </Dialog>
  );
}

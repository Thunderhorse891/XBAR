'use client';

import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Download, FileCheck2, Mail, Search } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { HorseAvatar, MicroLabel, ExpiryBadge } from '@/components/shared/status';
import { useCreateSalePacket, useDocuments, useHorses } from '@/hooks/queries';
import { useUiStore } from '@/stores/ui';
import { cn, formatDate, horseAge } from '@/lib/utils';
import { DOCUMENT_TYPE_LABELS } from '@/lib/types';
import type { SalePacket } from '@/lib/types';

const STEPS = ['Horse', 'Documents', 'Bill of Sale', 'Watermark', 'Generate'] as const;

export default function SalePacketGenerator() {
  const { salePacketOpen, salePacketHorseId, closeSalePacket } = useUiStore();
  const [step, setStep] = useState(0);
  const [horseId, setHorseId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedDocs, setSelectedDocs] = useState<Set<string> | null>(null);
  const [includeBill, setIncludeBill] = useState(true);
  const [buyerName, setBuyerName] = useState('');
  const [buyerEmail, setBuyerEmail] = useState('');
  const [salePrice, setSalePrice] = useState('');
  const [saleDate, setSaleDate] = useState(new Date().toISOString().slice(0, 10));
  const [watermark, setWatermark] = useState('');
  const [result, setResult] = useState<SalePacket | null>(null);
  const [shared, setShared] = useState(false);

  const { data: horses } = useHorses();
  const effectiveHorseId = horseId ?? salePacketHorseId;
  const horse = horses?.find((entry) => entry.id === effectiveHorseId) ?? null;
  const { data: docResult } = useDocuments({ horseId: effectiveHorseId ?? undefined, pageSize: 50 });
  const createPacket = useCreateSalePacket();

  const horseDocs = useMemo(
    () => (effectiveHorseId ? (docResult?.documents ?? []).filter((doc) => doc.horseId === effectiveHorseId) : []),
    [docResult, effectiveHorseId],
  );
  // All documents selected by default.
  const docSelection = selectedDocs ?? new Set(horseDocs.map((doc) => doc.id));

  const filteredHorses = (horses ?? []).filter((entry) => entry.name.toLowerCase().includes(search.toLowerCase()));
  const defaultWatermark = buyerName ? `Copy for ${buyerName} – ${formatDate(saleDate)}` : `Copy – ${formatDate(saleDate)}`;
  const effectiveWatermark = watermark || defaultWatermark;

  const reset = () => {
    setStep(0); setHorseId(null); setSearch(''); setSelectedDocs(null); setIncludeBill(true);
    setBuyerName(''); setBuyerEmail(''); setSalePrice(''); setWatermark(''); setResult(null); setShared(false);
  };

  const close = () => { reset(); closeSalePacket(); };

  const canContinue =
    step === 0 ? Boolean(effectiveHorseId)
    : step === 1 ? docSelection.size > 0 || includeBill
    : step === 2 ? !includeBill || buyerName.trim().length > 1
    : true;

  const continueHint =
    step === 0 && !effectiveHorseId ? 'Select a horse to continue.'
    : step === 1 && docSelection.size === 0 && !includeBill ? 'Select at least one document or include a Bill of Sale.'
    : step === 2 && includeBill && buyerName.trim().length <= 1 ? 'Buyer name is required for the Bill of Sale.'
    : '';

  const generate = async () => {
    if (!effectiveHorseId) return;
    const packet = await createPacket.mutateAsync({
      horseId: effectiveHorseId,
      documentIds: [...docSelection],
      includeBillOfSale: includeBill,
      buyerName,
      buyerEmail,
      salePrice,
      watermark: effectiveWatermark,
    });
    setResult(packet);
  };

  return (
    <Dialog open={salePacketOpen} onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className="max-w-3xl p-0 overflow-hidden" hideClose={false}>
        <div className="grid md:grid-cols-[1fr_260px]">
          {/* Light form column */}
          <div className="p-6">
            <DialogHeader>
              <DialogTitle>Generate sale packet</DialogTitle>
              <DialogDescription>Bundle verified documents into a watermarked, buyer-ready PDF.</DialogDescription>
            </DialogHeader>

            <ol className="mt-4 flex items-center gap-1" aria-label="Progress">
              {STEPS.map((label, index) => (
                <li key={label} className="flex flex-1 flex-col gap-1">
                  <span className={cn('h-1 rounded-full', index <= step ? 'bg-accent' : 'bg-steel/40')} aria-hidden />
                  <span className={cn('text-[10px] font-semibold uppercase tracking-micro', index === step ? 'text-accent-strong' : 'text-steel-muted')}>
                    {label}
                  </span>
                </li>
              ))}
            </ol>

            <div className="mt-5 min-h-[260px]">
              {step === 0 && (
                <div className="space-y-3">
                  <Label htmlFor="packet-horse-search">Select horse</Label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-steel-muted" aria-hidden />
                    <Input id="packet-horse-search" className="pl-9" placeholder="Search horses…" value={search} onChange={(event) => setSearch(event.target.value)} />
                  </div>
                  <ul className="max-h-52 space-y-1 overflow-y-auto" role="listbox" aria-label="Horses">
                    {filteredHorses.map((entry) => (
                      <li key={entry.id}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={effectiveHorseId === entry.id}
                          onClick={() => setHorseId(entry.id)}
                          className={cn(
                            'flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors',
                            effectiveHorseId === entry.id ? 'border-accent bg-accent-glow' : 'border-steel/40 hover:border-accent',
                          )}
                        >
                          <HorseAvatar name={entry.name} size="sm" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-ink">{entry.name}</span>
                            <span className="block text-xs text-steel-muted">{entry.breed} · {horseAge(entry.birthdate)} · {entry.registrationNumber || 'no reg #'}</span>
                          </span>
                          {effectiveHorseId === entry.id && <Check className="h-4 w-4 text-accent-strong" aria-hidden />}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {step === 1 && (
                <fieldset className="space-y-2">
                  <legend className="text-xs font-semibold uppercase tracking-micro text-gunmetal">Include documents ({docSelection.size}/{horseDocs.length} selected)</legend>
                  {horseDocs.length === 0 && (
                    <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-gunmetal">
                      No stored documents for this horse yet. You can still generate a packet with just a Bill of Sale.
                    </p>
                  )}
                  <ul className="max-h-56 space-y-1 overflow-y-auto">
                    {horseDocs.map((doc) => {
                      const checked = docSelection.has(doc.id);
                      return (
                        <li key={doc.id}>
                          <label className={cn('flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2', checked ? 'border-accent bg-accent-glow' : 'border-steel/40')}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                const next = new Set(docSelection);
                                if (checked) next.delete(doc.id); else next.add(doc.id);
                                setSelectedDocs(next);
                              }}
                              className="h-4 w-4 accent-[#18A8FF]"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-ink">{doc.title}</span>
                              <span className="block text-xs text-steel-muted">{DOCUMENT_TYPE_LABELS[doc.type]} · uploaded {formatDate(doc.uploadedAt)}</span>
                            </span>
                            <Badge variant={doc.verification === 'verified' ? 'verified' : doc.verification === 'pending' ? 'pending' : 'blocked'}>
                              {doc.verification}
                            </Badge>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </fieldset>
              )}

              {step === 2 && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between rounded-md border border-steel/40 px-3 py-2.5">
                    <div>
                      <p className="text-sm font-semibold text-ink">Include Bill of Sale</p>
                      <p className="text-xs text-steel-muted">XBAR pre-fills horse identity from the verified record.</p>
                    </div>
                    <Switch checked={includeBill} onCheckedChange={setIncludeBill} aria-label="Include Bill of Sale" />
                  </div>
                  {includeBill && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="buyer-name">Buyer name</Label>
                        <Input id="buyer-name" value={buyerName} onChange={(event) => setBuyerName(event.target.value)} placeholder="John Smith" />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="buyer-email">Buyer email</Label>
                        <Input id="buyer-email" type="email" value={buyerEmail} onChange={(event) => setBuyerEmail(event.target.value)} placeholder="buyer@example.com" />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="sale-price">Sale price</Label>
                        <Input id="sale-price" value={salePrice} onChange={(event) => setSalePrice(event.target.value)} placeholder="$18,500" />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="sale-date">Sale date</Label>
                        <Input id="sale-date" type="date" value={saleDate} onChange={(event) => setSaleDate(event.target.value)} />
                      </div>
                      <p className="text-xs text-steel-muted sm:col-span-2">Signature lines for seller and buyer are added automatically.</p>
                    </div>
                  )}
                </div>
              )}

              {step === 3 && (
                <div className="space-y-3">
                  <Label htmlFor="watermark">Watermark text</Label>
                  <Input id="watermark" value={watermark} onChange={(event) => setWatermark(event.target.value)} placeholder={defaultWatermark} />
                  <p className="text-xs text-steel-muted">Stamped diagonally on every page. Leave blank to use the default.</p>
                  <div className="rounded-md border border-steel/40 bg-canvas p-6 text-center">
                    <p className="rotate-[-6deg] text-lg font-bold text-danger/40">{effectiveWatermark}</p>
                  </div>
                </div>
              )}

              {step === 4 && !result && (
                <div className="space-y-3">
                  <p className="text-sm text-gunmetal">
                    Ready to assemble <strong className="text-ink">{docSelection.size}</strong> document{docSelection.size === 1 ? '' : 's'}
                    {includeBill ? ' plus a pre-filled Bill of Sale' : ''} for <strong className="text-ink">{horse?.name}</strong>.
                  </p>
                  <Button size="lg" onClick={generate} disabled={createPacket.isPending} className="w-full">
                    <FileCheck2 aria-hidden /> {createPacket.isPending ? 'Assembling packet…' : 'Generate packet'}
                  </Button>
                  {createPacket.isPending && (
                    <p role="status" aria-live="polite" className="text-xs text-steel-muted">
                      Building cover sheet, merging documents, applying watermark…
                    </p>
                  )}
                </div>
              )}

              {step === 4 && result && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-3" role="status" aria-live="polite">
                  <Badge variant="verified">Packet ready</Badge>
                  <p className="text-sm text-gunmetal">
                    {result.documentCount} documents bundled for {result.horseName}. The download link expires in 1 hour.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button asChild>
                      <a href={result.downloadUrl} download>
                        <Download aria-hidden /> Download PDF
                      </a>
                    </Button>
                    <Button
                      variant="outline"
                      disabled={!buyerEmail}
                      title={!buyerEmail ? 'Enter a buyer email in the Bill of Sale step to share.' : undefined}
                      onClick={() => setShared(true)}
                    >
                      <Mail aria-hidden /> {shared ? `Sent to ${buyerEmail}` : 'Email to buyer'}
                    </Button>
                  </div>
                  {!buyerEmail && <p className="text-xs text-steel-muted">Email sharing is disabled — no buyer email was provided.</p>}
                </motion.div>
              )}
            </div>

            <div className="mt-6 flex items-center justify-between border-t border-steel/40 pt-4">
              <Button variant="ghost" onClick={() => (step === 0 ? close() : setStep(step - 1))}>
                {step === 0 ? 'Cancel' : 'Back'}
              </Button>
              {step < 4 && (
                <div className="text-right">
                  <Button onClick={() => setStep(step + 1)} disabled={!canContinue} title={continueHint || undefined}>
                    Continue
                  </Button>
                  {continueHint && <p className="mt-1 text-xs text-steel-muted">{continueHint}</p>}
                </div>
              )}
              {step === 4 && result && <Button variant="outline" onClick={close}>Done</Button>}
            </div>
          </div>

          {/* Dark readiness preview panel */}
          <aside className="hidden flex-col gap-4 border-l border-metal bg-panel-strong p-5 text-surface md:flex" aria-label="Packet readiness">
            <MicroLabel className="text-steel-strong">Packet readiness</MicroLabel>
            {horse ? (
              <>
                <div className="flex items-center gap-3">
                  <HorseAvatar name={horse.name} size="sm" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-heading">{horse.name}</p>
                    <p className="text-xs text-steel-muted">{horse.registrationNumber || 'No registration on file'}</p>
                  </div>
                </div>
                <ExpiryBadge label="Coggins" dueAt={horse.cogginsExpiresAt} />
                <dl className="space-y-2 text-xs">
                  <div className="flex justify-between"><dt className="text-steel-muted">Documents</dt><dd className="font-semibold text-heading">{docSelection.size}</dd></div>
                  <div className="flex justify-between"><dt className="text-steel-muted">Bill of Sale</dt><dd className="font-semibold text-heading">{includeBill ? 'Included' : 'Excluded'}</dd></div>
                  <div className="flex justify-between"><dt className="text-steel-muted">Buyer</dt><dd className="max-w-[120px] truncate font-semibold text-heading">{buyerName || '—'}</dd></div>
                  <div className="flex justify-between"><dt className="text-steel-muted">Watermark</dt><dd className="max-w-[120px] truncate font-semibold text-heading">{effectiveWatermark}</dd></div>
                </dl>
                <div className="mt-auto rounded-md border border-blueline bg-accent-glow p-3 text-xs text-surface">
                  Every page is stamped and the packet is logged to the audit trail with buyer attribution.
                </div>
              </>
            ) : (
              <p className="text-xs text-steel-muted">Select a horse to see readiness.</p>
            )}
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}

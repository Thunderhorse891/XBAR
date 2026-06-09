'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  ArrowRightLeft,
  BellPlus,
  Download,
  FileText,
  Hammer,
  LayoutGrid,
  List,
  PackagePlus,
  Scale,
  Stethoscope,
  Upload,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { EmptyState } from '@/components/shared/empty-state';
import { DocumentProvenance } from '@/components/shared/provenance';
import { ConfidenceBadge, MicroLabel, VerificationBadge } from '@/components/shared/status';
import {
  useAddReminder,
  useDocuments,
  useHealth,
  useOwnership,
  useSalePackets,
  useTimeline,
} from '@/hooks/queries';
import { useSubscriptionStore } from '@/stores/subscription';
import { useUiStore } from '@/stores/ui';
import { cn, daysUntil, formatDate, formatDateTime } from '@/lib/utils';
import type { Horse, TimelineEntry } from '@/lib/types';
import { DOCUMENT_TYPE_LABELS } from '@/lib/types';

const TIMELINE_ICONS: Record<TimelineEntry['kind'], typeof Activity> = {
  vet: Stethoscope,
  farrier: Hammer,
  weight: Scale,
  document: FileText,
  ownership: Users,
  training: Activity,
};

export function TimelineTab({ horse }: { horse: Horse }) {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useTimeline(horse.id);
  const entries = data?.pages.flatMap((page) => page.entries) ?? [];

  if (!isLoading && entries.length === 0) {
    return (
      <EmptyState
        icon={Activity}
        title="No events yet"
        body="Vet visits, farrier work, weight checks, and document uploads will appear here as they happen."
      />
    );
  }

  return (
    <ol className="relative space-y-3 border-l border-steel/50 pl-5">
      {entries.map((entry) => {
        const Icon = TIMELINE_ICONS[entry.kind];
        return (
          <li key={entry.id} className="relative">
            <span className="absolute -left-[31px] flex h-6 w-6 items-center justify-center rounded-full border border-blueline bg-surface" aria-hidden>
              <Icon className="h-3 w-3 text-accent-strong" />
            </span>
            <Card>
              <CardContent className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-ink">{entry.title}</p>
                  <MicroLabel>{formatDateTime(entry.occurredAt)}</MicroLabel>
                </div>
                <p className="mt-1 text-sm text-gunmetal">{entry.detail}</p>
                <p className="mt-1.5 text-xs text-steel-muted">Logged by {entry.actor}</p>
              </CardContent>
            </Card>
          </li>
        );
      })}
      {hasNextPage && (
        <li className="pt-1">
          <Button variant="outline" size="sm" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
            {isFetchingNextPage ? 'Loading…' : 'Load older events'}
          </Button>
        </li>
      )}
    </ol>
  );
}

export function HealthTab({ horse }: { horse: Horse }) {
  const { data: records, isLoading } = useHealth(horse.id);
  const addReminder = useAddReminder(horse.id);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<'coggins' | 'vaccination' | 'deworming' | 'farrier' | 'dental'>('vaccination');
  const [label, setLabel] = useState('');
  const [nextDue, setNextDue] = useState('');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gunmetal">Compliance and care intervals with next-due countdowns.</p>
        <Button onClick={() => setOpen(true)}>
          <BellPlus aria-hidden /> Add reminder
        </Button>
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead>Last done</TableHead>
              <TableHead>Next due</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>By</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(records ?? []).map((record) => {
              const days = daysUntil(record.nextDue);
              return (
                <TableRow key={record.id}>
                  <TableCell className="font-medium">{record.label}</TableCell>
                  <TableCell>{formatDate(record.lastDate)}</TableCell>
                  <TableCell>{formatDate(record.nextDue)}</TableCell>
                  <TableCell>
                    {days !== null && days < 0 ? (
                      <Badge variant="blocked" title="Overdue — schedule immediately.">Overdue {Math.abs(days)}d</Badge>
                    ) : days !== null && days <= 14 ? (
                      <Badge variant="pending" title="Due soon — book the appointment.">Due in {days}d</Badge>
                    ) : (
                      <Badge variant="verified" title="Within compliance window.">Current</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-steel-muted">{record.administeredBy}</TableCell>
                </TableRow>
              );
            })}
            {!isLoading && (records ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-gunmetal">No health records yet — add a reminder to start tracking.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add reminder for {horse.name}</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!label || !nextDue) return;
              await addReminder.mutateAsync({ kind, label, nextDue: new Date(nextDue).toISOString() });
              setOpen(false);
              setLabel('');
              setNextDue('');
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="reminder-kind">Type</Label>
              <Select id="reminder-kind" value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
                <option value="coggins">Coggins</option>
                <option value="vaccination">Vaccination</option>
                <option value="deworming">Deworming</option>
                <option value="farrier">Farrier</option>
                <option value="dental">Dental</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reminder-label">Label</Label>
              <Input id="reminder-label" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Spring vaccines" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reminder-due">Due date</Label>
              <Input id="reminder-due" type="date" value={nextDue} onChange={(event) => setNextDue(event.target.value)} required />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={addReminder.isPending || !label || !nextDue} title={!label || !nextDue ? 'Label and due date are required.' : undefined}>
                {addReminder.isPending ? 'Saving…' : 'Save reminder'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function DocumentsTab({ horse }: { horse: Horse }) {
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [type, setType] = useState<string>('all');
  const { data } = useDocuments({ horseId: horse.id, type: type as never, pageSize: 50 });
  const documents = data?.documents ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Select aria-label="Filter by document type" value={type} onChange={(event) => setType(event.target.value)} className="w-44">
            <option value="all">All types</option>
            {Object.entries(DOCUMENT_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </Select>
          <div className="flex rounded-md border border-steel/50" role="group" aria-label="View mode">
            <button type="button" onClick={() => setView('list')} aria-pressed={view === 'list'} aria-label="List view" className={cn('rounded-l-md p-2', view === 'list' ? 'bg-accent-glow text-accent-strong' : 'text-gunmetal')}>
              <List className="h-4 w-4" aria-hidden />
            </button>
            <button type="button" onClick={() => setView('grid')} aria-pressed={view === 'grid'} aria-label="Grid view" className={cn('rounded-r-md p-2', view === 'grid' ? 'bg-accent-glow text-accent-strong' : 'text-gunmetal')}>
              <LayoutGrid className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
        <Button asChild>
          <Link href={`/documents?upload=1&horse=${horse.id}`}>
            <Upload aria-hidden /> Upload documents
          </Link>
        </Button>
      </div>

      {documents.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="Upload registration paper to auto-fill"
          body="XBAR reads registration papers, Coggins tests, and health certificates with OCR and attaches them to this record."
          action={
            <Button asChild>
              <Link href={`/documents?upload=1&horse=${horse.id}`}>Upload with OCR</Link>
            </Button>
          }
        />
      ) : view === 'list' ? (
        <ul className="space-y-2">
          {documents.map((doc) => (
            <li key={doc.id} className="rounded-lg border border-steel/40 bg-surface p-3">
              <DocumentProvenance document={doc} compact />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {documents.map((doc) => (
            <li key={doc.id} className="rounded-lg border border-steel/40 bg-surface p-4">
              <div className="flex items-start justify-between gap-2">
                <FileText className="h-8 w-8 text-gunmetal" aria-hidden />
                <ConfidenceBadge value={doc.confidence} />
              </div>
              <p className="mt-3 truncate text-sm font-semibold text-ink">{doc.title}</p>
              <p className="text-xs text-steel-muted">{DOCUMENT_TYPE_LABELS[doc.type]} · {formatDate(doc.uploadedAt)}</p>
              <div className="mt-2"><VerificationBadge state={doc.verification} /></div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function OwnershipTab({ horse }: { horse: Horse }) {
  const { data: records } = useOwnership(horse.id);
  const atLeast = useSubscriptionStore((state) => state.atLeast);
  const isBusiness = atLeast('business');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gunmetal">Verified chain of ownership with linked transfer evidence.</p>
        <Button
          variant="command"
          disabled={!isBusiness}
          title={!isBusiness ? 'Ownership transfer workflows require the Business plan.' : undefined}
        >
          <ArrowRightLeft aria-hidden /> Transfer ownership
        </Button>
      </div>
      {!isBusiness && (
        <p className="text-xs text-steel-muted">
          Transfer workflows are a Business feature. <Link href="/settings/billing?upgrade=business" className="text-accent-strong underline-offset-2 hover:underline">Upgrade</Link> to enable multi-party transfers.
        </p>
      )}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Owner</TableHead>
              <TableHead>From</TableHead>
              <TableHead>To</TableHead>
              <TableHead>Evidence</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(records ?? []).map((record) => (
              <TableRow key={record.id} data-state={record.to === null ? 'selected' : undefined}>
                <TableCell className="font-medium">
                  {record.ownerName} {record.to === null && <Badge variant="blue" className="ml-2">Current</Badge>}
                </TableCell>
                <TableCell>{formatDate(record.from)}</TableCell>
                <TableCell>{record.to ? formatDate(record.to) : 'Present'}</TableCell>
                <TableCell>
                  {record.transferDocumentId ? (
                    <Link href="/documents" className="text-accent-strong underline-offset-2 hover:underline">Transfer document</Link>
                  ) : (
                    <span className="text-steel-muted">No document linked</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

export function SalePacketTab({ horse }: { horse: Horse }) {
  const { data: packets } = useSalePackets(horse.id);
  const openSalePacket = useUiStore((state) => state.openSalePacket);
  const cogginsValid = (daysUntil(horse.cogginsExpiresAt) ?? -1) >= 0;

  return (
    <div className="space-y-5">
      <Card className="border-blueline">
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div>
            <h3 className="text-base font-semibold text-ink">Buyer-ready packet</h3>
            <p className="mt-1 max-w-md text-sm text-gunmetal">
              Bundles registration, Coggins, health records, and a pre-filled Bill of Sale into a single watermarked PDF.
            </p>
            {!cogginsValid && (
              <p className="mt-2 text-xs font-medium text-danger">
                Coggins is expired — buyers will see a blocked compliance state. Renew before sending.
              </p>
            )}
          </div>
          <Button size="lg" onClick={() => openSalePacket(horse.id)}>
            <PackagePlus aria-hidden /> Generate sale packet
          </Button>
        </CardContent>
      </Card>

      <section aria-labelledby="previous-packets">
        <h4 id="previous-packets" className="mb-2 text-sm font-semibold text-ink">Previous packets</h4>
        {(packets ?? []).length === 0 ? (
          <p className="text-sm text-gunmetal">No packets generated yet for {horse.name}.</p>
        ) : (
          <ul className="space-y-2">
            {(packets ?? []).map((packet) => (
              <li key={packet.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-steel/40 bg-surface p-3">
                <div>
                  <p className="text-sm font-medium text-ink">{packet.buyerName || 'Unnamed buyer'} · {packet.documentCount} documents</p>
                  <p className="text-xs text-steel-muted">{formatDateTime(packet.createdAt)} · watermark “{packet.watermark}”</p>
                </div>
                <Button variant="outline" size="sm" asChild>
                  <a href={packet.downloadUrl} download>
                    <Download aria-hidden /> Download
                  </a>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

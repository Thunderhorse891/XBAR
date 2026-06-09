'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { BellPlus, Camera, Pencil } from 'lucide-react';
import { Header } from '@/components/layout/header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ExpiryBadge, HorseAvatar, MicroLabel } from '@/components/shared/status';
import {
  DocumentsTab,
  HealthTab,
  OwnershipTab,
  SalePacketTab,
  TimelineTab,
} from '@/components/horses/profile-tabs';
import { useHorse, useUpdateHorse } from '@/hooks/queries';
import { daysSince, daysUntil, formatDate, horseAge } from '@/lib/utils';

export default function HorseProfilePage() {
  const params = useParams<{ id: string }>();
  const { data: horse, isLoading } = useHorse(params.id);
  const updateHorse = useUpdateHorse(params.id);
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editBreed, setEditBreed] = useState('');
  const [tab, setTab] = useState('timeline');

  if (isLoading) {
    return (
      <>
        <Header title="Horse profile" />
        <div className="p-6 text-sm text-gunmetal" role="status">Loading horse record…</div>
      </>
    );
  }

  if (!horse) {
    return (
      <>
        <Header title="Horse profile" />
        <div className="p-6 text-sm text-gunmetal">This horse was not found in your workspace.</div>
      </>
    );
  }

  const sinceVet = daysSince(horse.lastVetVisitAt);

  return (
    <>
      <Header title={horse.name} />
      <div className="grid gap-5 p-4 sm:p-6 xl:grid-cols-[1fr_280px]">
        <div className="min-w-0 space-y-5">
          {/* Premium light profile header */}
          <Card>
            <CardContent className="flex flex-wrap items-start gap-5 p-5 sm:p-6">
              <div className="relative">
                <HorseAvatar name={horse.name} size="lg" />
                <button
                  type="button"
                  aria-label="Upload photo"
                  title="Upload a profile photo"
                  className="absolute -bottom-1.5 -right-1.5 rounded-full border border-steel bg-surface p-1.5 text-gunmetal shadow-lift hover:text-accent-strong"
                >
                  <Camera className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">{horse.name}</h2>
                  <ExpiryBadge label="Coggins" dueAt={horse.cogginsExpiresAt} />
                  {horse.status === 'sale-listed' && <Badge variant="blue">For sale</Badge>}
                  <button
                    type="button"
                    aria-label={`Edit ${horse.name}`}
                    className="rounded p-1 text-gunmetal hover:text-accent-strong"
                    onClick={() => {
                      setEditName(horse.name);
                      setEditBreed(horse.breed);
                      setEditOpen(true);
                    }}
                  >
                    <Pencil className="h-4 w-4" aria-hidden />
                  </button>
                </div>
                <p className="mt-1 text-sm text-gunmetal">
                  {horse.breed} · {horse.color} · {horse.sex} · {horseAge(horse.birthdate)} (foaled {formatDate(horse.birthdate)})
                </p>
                <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1">
                  <MicroLabel>Reg # {horse.registrationNumber || '—'}</MicroLabel>
                  <MicroLabel>Registry {horse.registry || '—'}</MicroLabel>
                  <MicroLabel>Microchip {horse.microchip || '—'}</MicroLabel>
                  <MicroLabel>Owner {horse.ownerName}</MicroLabel>
                </div>
              </div>
            </CardContent>
          </Card>

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList aria-label="Horse record sections">
              <TabsTrigger value="timeline">Timeline</TabsTrigger>
              <TabsTrigger value="health">Health</TabsTrigger>
              <TabsTrigger value="documents">Documents</TabsTrigger>
              <TabsTrigger value="ownership">Ownership</TabsTrigger>
              <TabsTrigger value="packet">Sale Packet</TabsTrigger>
            </TabsList>
            <TabsContent value="timeline"><TimelineTab horse={horse} /></TabsContent>
            <TabsContent value="health"><HealthTab horse={horse} /></TabsContent>
            <TabsContent value="documents"><DocumentsTab horse={horse} /></TabsContent>
            <TabsContent value="ownership"><OwnershipTab horse={horse} /></TabsContent>
            <TabsContent value="packet"><SalePacketTab horse={horse} /></TabsContent>
          </Tabs>
        </div>

        {/* Desktop key-metrics sidebar */}
        <aside className="hidden space-y-4 xl:block" aria-label="Key metrics">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm uppercase tracking-micro text-gunmetal">Key metrics</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Metric label="Coggins status" value={horse.cogginsExpiresAt ? ((daysUntil(horse.cogginsExpiresAt) ?? 0) >= 0 ? `Valid · expires ${formatDate(horse.cogginsExpiresAt)}` : `Expired ${formatDate(horse.cogginsExpiresAt)}`) : 'No test on file'} alert={(daysUntil(horse.cogginsExpiresAt) ?? 1) < 7} />
              <Metric label="Next farrier" value={horse.nextFarrierAt ? formatDate(horse.nextFarrierAt) : 'Not scheduled'} />
              <Metric label="Days since last vet" value={sinceVet !== null ? `${sinceVet} days` : 'No visit recorded'} alert={(sinceVet ?? 0) > 90} />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-sm font-medium text-ink">Quick add reminder</p>
              <p className="mt-1 text-xs text-gunmetal">Schedule the next Coggins, vaccine, or farrier interval.</p>
              <Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => setTab('health')}>
                <BellPlus aria-hidden /> Add reminder
              </Button>
            </CardContent>
          </Card>
        </aside>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit {horse.name}</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={async (event) => {
              event.preventDefault();
              await updateHorse.mutateAsync({ name: editName, breed: editBreed });
              setEditOpen(false);
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="edit-name">Name</Label>
              <Input id="edit-name" value={editName} onChange={(event) => setEditName(event.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-breed">Breed</Label>
              <Input id="edit-breed" value={editBreed} onChange={(event) => setEditBreed(event.target.value)} required />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={updateHorse.isPending}>{updateHorse.isPending ? 'Saving…' : 'Save changes'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Metric({ label, value, alert = false }: { label: string; value: string; alert?: boolean }) {
  return (
    <div>
      <MicroLabel>{label}</MicroLabel>
      <p className={`mt-0.5 text-sm font-semibold ${alert ? 'text-danger' : 'text-ink'}`}>{value}</p>
    </div>
  );
}

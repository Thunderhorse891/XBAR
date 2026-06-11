'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  Activity,
  AlertTriangle,
  ClipboardList,
  FileWarning,
  PackageCheck,
} from 'lucide-react';
import { HorseheadIcon } from '@/components/layout/horsehead-icon';
import { Header } from '@/components/layout/header';
import { CommandBar } from '@/components/layout/command-bar';
import { Card, CardContent, CardHeader, CardTitle, CommandCard } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/shared/empty-state';
import { ExpiryBadge, HorseAvatar, MicroLabel } from '@/components/shared/status';
import { useHorses, useSalePackets, useSubscription } from '@/hooks/queries';
import { useActivity } from '@/hooks/queries';
import { useSubscriptionStore } from '@/stores/subscription';
import { useUiStore } from '@/stores/ui';
import { daysUntil, formatDate, formatDateTime, horseAge } from '@/lib/utils';
import { DOCUMENT_TYPE_LABELS } from '@/lib/types';

export default function DashboardPage() {
  const { data: horses, isLoading } = useHorses();
  const { data: activity } = useActivity();
  const { data: packets } = useSalePackets();
  const { data: subscription } = useSubscription();
  const atLeast = useSubscriptionStore((state) => state.atLeast);
  const setAddHorseOpen = useUiStore((state) => state.setAddHorseOpen);

  const expiring = (horses ?? [])
    .map((horse) => ({ horse, days: daysUntil(horse.cogginsExpiresAt) }))
    .filter((entry) => entry.days !== null && entry.days <= 30)
    .sort((a, b) => (a.days ?? 0) - (b.days ?? 0));
  const critical = expiring.filter((entry) => (entry.days ?? 0) <= 7);
  const missingInfo = (horses ?? []).filter((horse) => horse.missingDocuments.length > 0);
  const recentHorses = horses ?? [];

  return (
    <>
      <Header title="Dashboard" />
      <div className="space-y-6 p-4 sm:p-6">
        {/* Mission brief: dark graphite command panel */}
        <CommandCard className="overflow-hidden">
          <div className="relative p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <MicroLabel className="text-steel-strong">Mission brief · {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</MicroLabel>
                <h2 className="mt-2 text-xl font-semibold text-heading sm:text-2xl">
                  {critical.length > 0
                    ? `${critical.length} compliance ${critical.length === 1 ? 'item needs' : 'items need'} action this week`
                    : 'All horses are compliant. No critical items.'}
                </h2>
                <p className="mt-1 max-w-xl text-sm text-steel-muted">
                  {horses?.length ?? 0} horses under management · {missingInfo.length} with missing documents ·{' '}
                  {packets?.length ?? 0} sale packet{(packets?.length ?? 0) === 1 ? '' : 's'} issued
                </p>
              </div>
              <CommandBar />
            </div>
            {critical.length > 0 && (
              <ul className="mt-4 flex flex-wrap gap-2">
                {critical.map(({ horse }) => (
                  <li key={horse.id}>
                    <Link href={`/horses/${horse.id}`} className="inline-flex">
                      <Badge variant="blocked">
                        <AlertTriangle className="h-3 w-3" aria-hidden /> {horse.name}: Coggins {formatDate(horse.cogginsExpiresAt)}
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CommandCard>

        {/* Widget grid */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileWarning className="h-4 w-4 text-danger" aria-hidden /> Expiring documents
              </CardTitle>
              {critical.length > 0 && <Badge variant="blocked">{critical.length} urgent</Badge>}
            </CardHeader>
            <CardContent className="space-y-2">
              {expiring.length === 0 && <p className="text-sm text-gunmetal">Nothing expires in the next 30 days.</p>}
              {expiring.slice(0, 4).map(({ horse }) => (
                <Link key={horse.id} href={`/horses/${horse.id}`} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-accent-glow/60">
                  <span className="truncate text-sm font-medium text-ink">{horse.name}</span>
                  <ExpiryBadge label="Coggins" dueAt={horse.cogginsExpiresAt} />
                </Link>
              ))}
              <Button variant="link" size="sm" asChild>
                <Link href="/calendar">View all</Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <Activity className="h-4 w-4 text-accent-strong" aria-hidden /> Recent activity
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {(activity ?? []).slice(0, 4).map((entry) => (
                <div key={entry.id} className="text-sm">
                  <p className="text-ink">
                    <span className="font-medium">{entry.user}</span> · {entry.action.toLowerCase()}
                    {entry.horseName ? ` — ${entry.horseName}` : ''}
                  </p>
                  <p className="text-xs text-steel-muted">{formatDateTime(entry.occurredAt)}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <ClipboardList className="h-4 w-4 text-warning" aria-hidden /> Missing info
              </CardTitle>
              {missingInfo.length > 0 && <Badge variant="pending">{missingInfo.length}</Badge>}
            </CardHeader>
            <CardContent className="space-y-2">
              {missingInfo.length === 0 && <p className="text-sm text-gunmetal">Every horse has a complete record.</p>}
              {missingInfo.slice(0, 4).map((horse) => (
                <Link key={horse.id} href={`/horses/${horse.id}`} className="block rounded-md px-2 py-1.5 hover:bg-accent-glow/60">
                  <p className="text-sm font-medium text-ink">{horse.name}</p>
                  <p className="text-xs text-steel-muted">
                    Missing: {horse.missingDocuments.map((type) => DOCUMENT_TYPE_LABELS[type]).join(', ')}
                  </p>
                </Link>
              ))}
            </CardContent>
          </Card>

          {/* Packet requests — Business tier only, rendered as a dark command widget */}
          {atLeast('business') ? (
            <CommandCard>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="flex items-center gap-2 text-base text-heading">
                  <PackageCheck className="h-4 w-4 text-accent" aria-hidden /> Packet requests
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2.5">
                {(packets ?? []).slice(0, 3).map((packet) => (
                  <div key={packet.id} className="text-sm">
                    <p className="font-medium text-heading">{packet.horseName}</p>
                    <p className="text-xs text-steel-muted">
                      {packet.buyerName || 'Unnamed buyer'} · {packet.documentCount} docs · {formatDate(packet.createdAt)}
                    </p>
                  </div>
                ))}
                {(packets ?? []).length === 0 && <p className="text-sm text-steel-muted">No buyer requests yet.</p>}
              </CardContent>
            </CommandCard>
          ) : (
            <Card className="border-dashed">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base text-gunmetal">
                  <PackageCheck className="h-4 w-4" aria-hidden /> Packet requests
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gunmetal">Buyer packet requests are a Business plan feature.</p>
                <Button variant="link" size="sm" asChild>
                  <Link href="/settings/billing?upgrade=business">Upgrade to Business</Link>
                </Button>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Recent horses: horizontal scroll */}
        <section aria-labelledby="recent-horses-heading">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="recent-horses-heading" className="text-base font-semibold text-ink">Recent horses</h2>
            <Button variant="link" size="sm" asChild>
              <Link href="/horses">View all</Link>
            </Button>
          </div>
          {!isLoading && recentHorses.length === 0 ? (
            <EmptyState
              icon={HorseheadIcon}
              title="Add your first horse"
              body="Create a profile manually, or upload registration papers and XBAR will build it for you with OCR."
              action={<Button onClick={() => setAddHorseOpen(true)}>Add your first horse</Button>}
            />
          ) : (
            <ul className="flex gap-3 overflow-x-auto pb-2">
              {recentHorses.map((horse, index) => (
                <motion.li
                  key={horse.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.04 }}
                  className="w-60 shrink-0"
                >
                  <Link href={`/horses/${horse.id}`} className="block rounded-lg border border-steel/40 bg-surface p-4 shadow-lift transition-colors hover:border-accent">
                    <div className="flex items-center gap-3">
                      <HorseAvatar name={horse.name} />
                      <div className="min-w-0">
                        <p className="truncate text-base font-semibold text-ink">{horse.name}</p>
                        <p className="text-xs text-gunmetal">{horse.breed} · {horseAge(horse.birthdate)}</p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <ExpiryBadge label="Coggins" dueAt={horse.cogginsExpiresAt} />
                      {horse.status === 'sale-listed' && <Badge variant="blue">For sale</Badge>}
                      {horse.packetReady && <Badge variant="verified">Packet ready</Badge>}
                    </div>
                  </Link>
                </motion.li>
              ))}
            </ul>
          )}
        </section>

        {subscription?.trialEndsAt && (
          <MicroLabel className="block">
            Trial active — ends {formatDate(subscription.trialEndsAt)} · manage in Billing
          </MicroLabel>
        )}
      </div>
    </>
  );
}

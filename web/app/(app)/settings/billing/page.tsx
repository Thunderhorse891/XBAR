'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, ExternalLink, FileText } from 'lucide-react';
import { Header } from '@/components/layout/header';
import { PricingTable } from '@/components/billing/pricing-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { MicroLabel } from '@/components/shared/status';
import { useInvoices, useSubscription } from '@/hooks/queries';
import { signIn, getToken } from '@/lib/auth';
import { useSubscriptionStore } from '@/stores/subscription';
import { daysUntil, formatDate } from '@/lib/utils';
import type { Tier } from '@/lib/types';

function BillingWorkspace() {
  const params = useSearchParams();
  const router = useRouter();
  const { data: subscription } = useSubscription();
  const { data: invoices } = useInvoices();
  const setStoreTier = useSubscriptionStore((state) => state.setTier);
  const [pricingOpen, setPricingOpen] = useState(params.get('upgrade') !== null);

  const trialDays = subscription?.trialEndsAt ? daysUntil(subscription.trialEndsAt) : null;
  const upgradeReason = params.get('reason');

  // Demo plan change: re-issues the session cookie at the new tier. In
  // production this redirects to Stripe Checkout via the backend.
  const changePlan = (tier: Tier) => {
    const token = getToken();
    const email = token ? atob(token.split('.')[1] ?? '') : 'demo@xbar.app';
    signIn(email || 'demo@xbar.app', tier);
    setStoreTier(tier);
    setPricingOpen(false);
    router.refresh();
    window.location.reload();
  };

  return (
    <>
      <Header title="Subscription & Billing" />
      <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
        {upgradeReason === 'barn-settings' && (
          <div role="alert" className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden />
            <div>
              <p className="text-sm font-semibold text-ink">Barn settings require the Business plan</p>
              <p className="text-sm text-gunmetal">Multi-user roles, owner portal, and branding are Business features. Upgrade below to unlock them.</p>
            </div>
          </div>
        )}

        {trialDays !== null && trialDays >= 0 && (
          <div
            role="status"
            className={
              trialDays < 3
                ? 'flex items-center justify-between gap-3 rounded-lg border border-danger/50 bg-danger/10 p-4'
                : 'flex items-center justify-between gap-3 rounded-lg border border-blueline bg-accent-glow p-4'
            }
          >
            <div>
              <p className={`text-sm font-semibold ${trialDays < 3 ? 'text-danger' : 'text-ink'}`}>
                Free trial — {trialDays} day{trialDays === 1 ? '' : 's'} remaining
              </p>
              <p className="text-sm text-gunmetal">
                {trialDays < 3 ? 'Your trial ends soon. Pick a plan to keep reminders and OCR running.' : `Billing starts ${formatDate(subscription?.trialEndsAt)}.`}
              </p>
            </div>
            <Button onClick={() => setPricingOpen(true)}>Choose a plan</Button>
          </div>
        )}

        {/* Current plan: electric blue left border */}
        <Card className="border-l-4 border-l-accent">
          <CardHeader className="flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle>Current plan</CardTitle>
              <p className="mt-1 text-sm text-gunmetal">
                <span className="text-xl font-bold text-ink">{subscription?.tierLabel ?? '—'}</span>
                <span className="ml-2">${subscription?.monthlyPrice ?? '—'}/mo · next billing {formatDate(subscription?.nextBillingDate)}</span>
              </p>
            </div>
            <Badge variant="verified">Active</Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            {subscription && (
              <div className="grid gap-4 sm:grid-cols-3">
                {(
                  [
                    ['Horses', subscription.usage.horses],
                    ['Documents', subscription.usage.documents],
                    ['Team seats', subscription.usage.seats],
                  ] as const
                ).map(([label, usage]) => {
                  const pct = Math.round((usage.used / usage.limit) * 100);
                  return (
                    <div key={label}>
                      <div className="mb-1 flex items-center justify-between">
                        <MicroLabel>{label}</MicroLabel>
                        <span className="text-xs text-gunmetal">{usage.used} / {usage.limit}</span>
                      </div>
                      <Progress value={pct} tone={pct >= 90 ? 'danger' : 'blue'} aria-label={`${label} usage: ${usage.used} of ${usage.limit}`} />
                    </div>
                  );
                })}
              </div>
            )}
            <div className="flex flex-wrap gap-2 border-t border-steel/40 pt-4">
              <Button onClick={() => setPricingOpen(true)}>Upgrade / downgrade</Button>
              <Button variant="outline" asChild>
                <a href="https://billing.stripe.com" target="_blank" rel="noreferrer">
                  Manage in Stripe Customer Portal <ExternalLink aria-hidden />
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Invoice history</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">PDF</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(invoices ?? []).map((invoice) => (
                  <TableRow key={invoice.id}>
                    <TableCell className="font-medium">{invoice.number}</TableCell>
                    <TableCell>{formatDate(invoice.date)}</TableCell>
                    <TableCell>${invoice.amount.toFixed(2)}</TableCell>
                    <TableCell>
                      <Badge variant={invoice.status === 'paid' ? 'verified' : invoice.status === 'open' ? 'pending' : 'blocked'}>
                        {invoice.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" asChild>
                        <a href={invoice.pdfUrl} download aria-label={`Download invoice ${invoice.number}`}>
                          <FileText aria-hidden /> PDF
                        </a>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Dialog open={pricingOpen} onOpenChange={setPricingOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Change plan</DialogTitle>
          </DialogHeader>
          <PricingTable currentTier={subscription?.tier} ctaLabel="Switch to this plan" onSelect={(tier) => changePlan(tier)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function BillingPage() {
  return (
    <Suspense fallback={null}>
      <BillingWorkspace />
    </Suspense>
  );
}

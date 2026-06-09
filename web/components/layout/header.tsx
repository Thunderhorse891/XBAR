'use client';

import { useEffect } from 'react';
import { Bell, Menu } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MicroLabel } from '@/components/shared/status';
import { useMarkNotificationsRead, useNotifications, useSubscription } from '@/hooks/queries';
import { useSubscriptionStore } from '@/stores/subscription';
import { useUiStore } from '@/stores/ui';
import { formatDateTime, cn } from '@/lib/utils';
import Link from 'next/link';

export function Header({ title }: { title?: string }) {
  const setSidebarOpen = useUiStore((state) => state.setSidebarOpen);
  const hydrate = useSubscriptionStore((state) => state.hydrate);
  const { data: notifications } = useNotifications();
  const { data: subscription } = useSubscription();
  const markRead = useMarkNotificationsRead();

  useEffect(() => hydrate(), [hydrate]);

  const unread = notifications?.filter((entry) => !entry.read).length ?? 0;

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-steel/40 bg-canvas/90 px-4 backdrop-blur sm:px-6">
      <button
        type="button"
        className="rounded p-1.5 text-gunmetal hover:bg-accent-glow lg:hidden"
        onClick={() => setSidebarOpen(true)}
        aria-label="Open navigation"
      >
        <Menu className="h-5 w-5" aria-hidden />
      </button>
      <div className="min-w-0 flex-1">
        {title && <h1 className="truncate text-base font-semibold text-ink">{title}</h1>}
      </div>
      {subscription && (
        <Badge variant="outline" className="hidden sm:inline-flex" title="Your current subscription plan">
          {subscription.tierLabel} plan
        </Badge>
      )}
      <Popover onOpenChange={(open) => { if (!open && unread > 0) markRead.mutate(); }}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`} className="relative">
            <Bell className="h-5 w-5" aria-hidden />
            {unread > 0 && (
              <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-surface">
                {unread}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent aria-label="Reminders and alerts">
          <div className="border-b border-steel/40 bg-shell px-4 py-3 rounded-t-lg">
            <MicroLabel className="text-steel-strong">Reminders &amp; alerts</MicroLabel>
          </div>
          <ul className="max-h-80 divide-y divide-steel/30 overflow-y-auto">
            {(notifications ?? []).map((entry) => (
              <li key={entry.id}>
                <Link href={entry.href} className="block px-4 py-3 transition-colors hover:bg-accent-glow/60">
                  <div className="flex items-start gap-2">
                    <span
                      aria-hidden
                      className={cn(
                        'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                        entry.severity === 'danger' ? 'bg-danger' : entry.severity === 'warning' ? 'bg-warning' : 'bg-accent',
                      )}
                    />
                    <div className="min-w-0">
                      <p className={cn('text-sm', entry.read ? 'text-gunmetal' : 'font-semibold text-ink')}>{entry.title}</p>
                      <p className="mt-0.5 text-xs text-gunmetal">{entry.body}</p>
                      <p className="mt-1 text-[11px] text-steel-muted">{formatDateTime(entry.createdAt)}</p>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
            {(notifications ?? []).length === 0 && (
              <li className="px-4 py-6 text-sm text-gunmetal">No reminders right now. You are fully compliant.</li>
            )}
          </ul>
        </PopoverContent>
      </Popover>
    </header>
  );
}

'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  CalendarDays,
  CreditCard,
  FileText,
  LayoutDashboard,
  LogOut,
  Lock,
  Users,
  X,
} from 'lucide-react';
import { HorseheadIcon } from './horsehead-icon';
import { cn } from '@/lib/utils';
import { signOut } from '@/lib/auth';
import { useSubscriptionStore } from '@/stores/subscription';
import { useUiStore } from '@/stores/ui';
import { MicroLabel } from '@/components/shared/status';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/horses', label: 'Horses', icon: HorseheadIcon },
  { href: '/documents', label: 'Documents', icon: FileText },
  { href: '/calendar', label: 'Calendar', icon: CalendarDays },
  { href: '/settings/billing', label: 'Billing', icon: CreditCard },
  { href: '/barn/settings', label: 'Barn settings', icon: Users, requires: 'business' as const },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { sidebarOpen, setSidebarOpen } = useUiStore();
  const atLeast = useSubscriptionStore((state) => state.atLeast);
  const hydrated = useSubscriptionStore((state) => state.hydrated);

  const nav = (
    <nav aria-label="Primary" className="flex flex-1 flex-col gap-1 px-3">
      {NAV.map((item) => {
        const active = pathname.startsWith(item.href);
        const locked = item.requires && hydrated && !atLeast(item.requires);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setSidebarOpen(false)}
            aria-current={active ? 'page' : undefined}
            title={locked ? 'Requires the Business plan — manage your plan in Billing.' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors',
              active
                ? 'bg-accent-glow text-accent border-l-2 border-accent'
                : 'text-steel-muted hover:bg-panel-elevated hover:text-surface',
            )}
          >
            <item.icon className="h-4 w-4 shrink-0" aria-hidden />
            <span className="flex-1">{item.label}</span>
            {locked && <Lock className="h-3.5 w-3.5 text-steel-muted" aria-label="Business plan required" />}
          </Link>
        );
      })}
    </nav>
  );

  const shell = (
    <div className="flex h-full flex-col py-5">
      <div className="flex items-center justify-between px-5 pb-6">
        <Link href="/dashboard" className="text-lg font-bold tracking-tight text-heading">
          XBAR<span className="text-accent">.</span>
        </Link>
        <button
          type="button"
          className="rounded p-1 text-steel-muted hover:text-surface lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close navigation"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      </div>
      {nav}
      <div className="mt-auto space-y-3 px-5 pt-4">
        <MicroLabel className="block text-steel-muted/70">North Barn Operations</MicroLabel>
        <button
          type="button"
          onClick={() => {
            signOut();
            router.push('/login');
          }}
          className="flex items-center gap-2 text-sm text-steel-muted transition-colors hover:text-surface"
        >
          <LogOut className="h-4 w-4" aria-hidden /> Sign out
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-metal bg-shell lg:block">{shell}</aside>
      {/* Mobile drawer */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button
            type="button"
            aria-label="Close navigation overlay"
            className="absolute inset-0 bg-void/70"
            onClick={() => setSidebarOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-64 bg-shell shadow-command">{shell}</aside>
        </div>
      )}
    </>
  );
}

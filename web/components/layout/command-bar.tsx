'use client';

import Link from 'next/link';
import { FilePlus2, PackagePlus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useUiStore } from '@/stores/ui';

// Quick actions presented as a clean command bar (and pinned above the fold
// on mobile). Primary actions are electric blue per the hierarchy rules.
export function CommandBar() {
  const { setAddHorseOpen, openSalePacket } = useUiStore();

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Quick actions">
      <Button onClick={() => setAddHorseOpen(true)}>
        <Plus aria-hidden /> Add horse
      </Button>
      <Button variant="command" asChild>
        <Link href="/documents?upload=1">
          <FilePlus2 aria-hidden /> Upload docs
        </Link>
      </Button>
      <Button variant="command" onClick={() => openSalePacket()}>
        <PackagePlus aria-hidden /> Create sale packet
      </Button>
    </div>
  );
}

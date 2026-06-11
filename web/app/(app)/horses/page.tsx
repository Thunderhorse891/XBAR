'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { Header } from '@/components/layout/header';
import { HorseheadIcon } from '@/components/layout/horsehead-icon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/shared/empty-state';
import { ExpiryBadge, HorseAvatar, MicroLabel } from '@/components/shared/status';
import { useHorses } from '@/hooks/queries';
import { useUiStore } from '@/stores/ui';
import { horseAge } from '@/lib/utils';

export default function HorsesPage() {
  const { data: horses, isLoading } = useHorses();
  const setAddHorseOpen = useUiStore((state) => state.setAddHorseOpen);
  const [search, setSearch] = useState('');

  const filtered = (horses ?? []).filter((horse) =>
    `${horse.name} ${horse.breed} ${horse.registrationNumber}`.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <>
      <Header title="Horses" />
      <div className="space-y-5 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-steel-muted" aria-hidden />
            <Input className="pl-9" placeholder="Search by name, breed, reg #…" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search horses" />
          </div>
          <Button onClick={() => setAddHorseOpen(true)}>
            <Plus aria-hidden /> Add horse
          </Button>
        </div>

        {!isLoading && filtered.length === 0 ? (
          <EmptyState
            icon={HorseheadIcon}
            title={search ? 'No horses match that search' : 'Add your first horse'}
            body={search ? 'Try a different name or registration number.' : 'Create a profile manually, or upload registration papers and XBAR will build it for you with OCR.'}
            action={!search ? <Button onClick={() => setAddHorseOpen(true)}>Add your first horse</Button> : undefined}
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((horse) => (
              <li key={horse.id}>
                <Link href={`/horses/${horse.id}`} className="flex gap-4 rounded-lg border border-steel/40 bg-surface p-4 shadow-lift transition-colors hover:border-accent">
                  <HorseAvatar name={horse.name} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-semibold text-ink sm:text-lg">{horse.name}</p>
                    <p className="text-xs text-gunmetal">
                      {horse.breed} · {horse.color} · {horse.sex} · {horseAge(horse.birthdate)}
                    </p>
                    <MicroLabel className="mt-0.5 block">{horse.registrationNumber || 'No registration on file'}</MicroLabel>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <ExpiryBadge label="Coggins" dueAt={horse.cogginsExpiresAt} />
                      {horse.status === 'sale-listed' && <Badge variant="blue">For sale</Badge>}
                      {horse.missingDocuments.length > 0 && <Badge variant="pending">{horse.missingDocuments.length} missing docs</Badge>}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

'use client';

import dynamic from 'next/dynamic';
import { Sidebar } from '@/components/layout/sidebar';
import { AddHorseDialog } from '@/components/horses/add-horse-dialog';
import { useUiStore } from '@/stores/ui';

// Heavy workflow modal is code-split and only loaded when opened.
const SalePacketGenerator = dynamic(() => import('@/components/sale-packet/generator-modal'), { ssr: false });

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const salePacketOpen = useUiStore((state) => state.salePacketOpen);

  return (
    <div className="min-h-screen bg-canvas">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <Sidebar />
      <div className="lg:pl-60">
        <main id="main-content" className="min-h-screen">
          {children}
        </main>
      </div>
      <AddHorseDialog />
      {salePacketOpen && <SalePacketGenerator />}
    </div>
  );
}

import React from 'react';
import SalesTracker from '@/components/SalesTracker';

export default function Sales() {
  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Sales Records</h1>
      <SalesTracker sales={[]} />
    </div>
  );
}

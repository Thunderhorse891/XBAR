import React from 'react';
import BreedingTab from '@/components/BreedingTab';

export default function Breeding() {
  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Breeding Records</h1>
      <BreedingTab breeding={[]} />
    </div>
  );
}

import React, { useState } from 'react';
import HorseList from './components/HorseList';
import { Horse } from './types/horse';

export default function App() {
  const [horses, setHorses] = useState<Horse[]>([
    {
      id: 1,
      name: 'Thunder',
      breed: 'Thoroughbred',
      age: 7,
      color: 'Bay',
      owner: 'John Smith',
      medicalNotes: 'Regular checkups',
      lastVetVisit: '2024-01-15'
    },
    {
      id: 2,
      name: 'Shadow', 
      breed: 'Quarter Horse',
      age: 12,
      color: 'Black',
      owner: 'Sarah Johnson',
      medicalNotes: 'Arthritis management',
      lastVetVisit: '2024-01-10'
    }
  ]);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <h1 className="text-2xl font-bold text-gray-900">
            🐎 XBAR Horse Management
          </h1>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-lg shadow-sm border">
          <HorseList horses={horses} onHorsesChange={setHorses} />
        </div>
      </main>
    </div>
  );
}

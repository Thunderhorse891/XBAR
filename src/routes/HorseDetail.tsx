import React, { useState } from 'react';
import { useHorses } from '@/store/useHorses';
import { useParams, useNavigate } from 'react-router-dom';

export default function HorseDetail() {
  const { id } = useParams<{ id: string }>();
  const { horses } = useHorses();
  const navigate = useNavigate();
  const horse = horses.find((h) => h.id === id);

  const [activeTab, setActiveTab] = useState<'overview' | 'medical'>('overview');

  if (!horse) {
    return (
      <div className="p-4">
        <p className="text-gray-500">No horse found with ID <strong>{id}</strong>.</p>
        <button onClick={() => navigate('/horses')} className="mt-3 text-blue-600 underline text-sm">
          Back to Horses
        </button>
      </div>
    );
  }

  return (
    <main className="p-4 max-w-3xl">
      <button onClick={() => navigate(-1)} className="text-sm text-blue-600 underline mb-4 block">
        ← Back
      </button>
      <h1 className="text-2xl font-bold mb-2">{horse.name}</h1>

      <div className="flex gap-2 mb-4 border-b border-gray-200 pb-2">
        {(['overview', 'medical'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-1 rounded text-sm font-medium transition-colors ${
              activeTab === tab ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <div className="bg-white border rounded-lg p-4 space-y-2 text-sm">
          <p><span className="font-medium">Status:</span> {horse.status ?? '—'}</p>
          <p><span className="font-medium">Color:</span> {horse.color}</p>
          <p><span className="font-medium">Breed:</span> {horse.breed}</p>
          <p><span className="font-medium">Age:</span> {horse.age}</p>
          <p><span className="font-medium">Owner:</span> {horse.owner}</p>
          <p><span className="font-medium">Gender:</span> {horse.gender ?? '—'}</p>
          <p><span className="font-medium">Last Vet Visit:</span> {horse.lastVetVisit}</p>
        </div>
      )}

      {activeTab === 'medical' && (
        <div className="bg-white border rounded-lg p-4">
          <p className="text-sm text-gray-600">{horse.medicalNotes || 'No medical notes.'}</p>
        </div>
      )}
    </main>
  );
}

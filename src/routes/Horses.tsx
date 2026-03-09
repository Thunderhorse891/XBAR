import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useHorses } from '@/store/useHorses';
import { EditableTable } from '@/components/EditableTable';
import OCRImporter from '@/components/OCRImporter';

export default function Horses() {
  const { horses } = useHorses();
  const navigate = useNavigate();

  return (
    <main className="p-4">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Horses</h1>
        <span className="text-sm text-gray-500">{horses.length} registered</span>
      </div>

      <div className="mb-6">
        <OCRImporter />
      </div>

      <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
        <EditableTable />
      </div>
    </main>
  );
}

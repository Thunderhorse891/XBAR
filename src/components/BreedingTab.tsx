import React from 'react';

interface BreedingRecord {
  id: string;
  mare: string;
  sire: string;
  date: string;
  outcome?: string;
}

interface BreedingTabProps {
  breeding: BreedingRecord[];
}

export default function BreedingTab({ breeding }: BreedingTabProps) {
  return (
    <div className="p-4">
      <h2 className="text-lg font-semibold mb-3">Breeding Records</h2>
      {breeding.length === 0 ? (
        <p className="text-gray-500 text-sm">No breeding records found.</p>
      ) : (
        <ul className="space-y-2">
          {breeding.map((record) => (
            <li key={record.id} className="border rounded p-3 bg-gray-50">
              <span className="font-bold">{record.mare}</span>
              {' × '}
              <span className="font-bold">{record.sire}</span>
              <span className="text-sm text-gray-500 ml-2">({record.date})</span>
              {record.outcome && (
                <span className="ml-2 text-sm text-green-600">{record.outcome}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

import React from 'react';

interface MedicalRecord {
  date: string;
  treatment: string;
  vet?: string;
  notes?: string;
}

interface MedicalTabProps {
  horse: {
    medical: MedicalRecord[];
  };
}

export default function MedicalTab({ horse }: MedicalTabProps) {
  return (
    <div className="p-4">
      <h2 className="text-lg font-semibold mb-3">Medical Records</h2>
      {horse.medical.length === 0 ? (
        <p className="text-gray-500 text-sm">No medical records found.</p>
      ) : (
        <ul className="space-y-2">
          {horse.medical.map((e, i) => (
            <li key={i} className="border rounded p-3 bg-gray-50 text-sm">
              <span className="font-medium">{e.date}</span>
              {' — '}
              <em>{e.treatment}</em>
              {e.vet && <span className="text-gray-500 ml-2">({e.vet})</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

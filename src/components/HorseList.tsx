import React from 'react';
import { Horse } from '../types/horse';

interface HorseListProps {
  horses: Horse[];
  onHorsesChange: (horses: Horse[]) => void;
}

const HorseList: React.FC<HorseListProps> = ({ horses, onHorsesChange }) => {
  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-semibold text-gray-800">Horse Inventory</h2>
        <button
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
          onClick={() => {
            const newHorse: Horse = {
              id: String(Date.now()),
              name: 'New Horse',
              breed: '',
              age: 0,
              color: '',
              owner: '',
              medicalNotes: '',
              lastVetVisit: '',
            };
            onHorsesChange([...horses, newHorse]);
          }}
        >
          Add Horse
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Breed</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Age</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Owner</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Vet Visit</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {horses.map((horse) => (
              <tr key={horse.id} className="hover:bg-gray-50 cursor-pointer">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm font-medium text-gray-900">{horse.name}</div>
                  <div className="text-sm text-gray-500">{horse.color}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{horse.breed}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{horse.age} yrs</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{horse.owner}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{horse.status ?? '—'}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{horse.lastVetVisit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default HorseList;

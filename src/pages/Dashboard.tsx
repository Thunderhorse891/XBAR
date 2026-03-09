import React from 'react';
import { useHorses } from '../store/useHorses';
import HorseCard from '../components/HorseCard';
import { useNavigate } from 'react-router-dom';

const Dashboard = () => {
  const { horses } = useHorses();
  const navigate = useNavigate();

  const activeCount = horses.filter((h) => h.status === 'Active').length;
  const forSaleCount = horses.filter((h) => h.status === 'For Sale').length;

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>

      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-white rounded-lg border p-4 shadow-sm">
          <p className="text-sm text-gray-500">Total Horses</p>
          <p className="text-3xl font-bold text-blue-700">{horses.length}</p>
        </div>
        <div className="bg-white rounded-lg border p-4 shadow-sm">
          <p className="text-sm text-gray-500">Active</p>
          <p className="text-3xl font-bold text-green-600">{activeCount}</p>
        </div>
        <div className="bg-white rounded-lg border p-4 shadow-sm">
          <p className="text-sm text-gray-500">For Sale</p>
          <p className="text-3xl font-bold text-yellow-600">{forSaleCount}</p>
        </div>
      </div>

      <h2 className="text-lg font-semibold mb-3">Horse Roster</h2>
      {horses.length === 0 ? (
        <p className="text-gray-500 text-sm">No horses registered yet.</p>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {horses.map((h) => (
            <HorseCard
              key={h.id}
              data={h}
              onClick={() => navigate(`/horses/${h.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default Dashboard;

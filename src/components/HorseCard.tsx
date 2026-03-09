import React from 'react';
import { Horse } from '../types/horse';

type Props = {
  data: Horse;
  onClick?: () => void;
};

export const HorseCard: React.FC<Props> = ({ data, onClick }) => {
  return (
    <div className="flex flex-col bg-white p-4 rounded-lg shadow hover:shadow-md transition-shadow">
      {data.profileImage && (
        <img
          src={data.profileImage}
          alt={`${data.name}`}
          className="w-full h-40 object-cover rounded mb-3"
        />
      )}
      <div className="flex flex-col space-y-1">
        <span className="text-lg font-bold leading-tight">{data.name}</span>
        <span className="text-sm text-gray-600">{data.breed}</span>
        {data.status && (
          <span className="text-xs text-gray-400">{data.status}</span>
        )}
        {onClick && (
          <button
            onClick={onClick}
            className="mt-2 text-sm text-blue-600 underline text-left"
          >
            View Details
          </button>
        )}
      </div>
    </div>
  );
};

export default HorseCard;

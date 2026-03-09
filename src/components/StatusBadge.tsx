import React from 'react';

const colorMap: Record<string, string> = {
  Active: 'bg-green-100 text-green-800',
  Retired: 'bg-gray-100 text-gray-700',
  Deceased: 'bg-red-100 text-red-700',
  'For Sale': 'bg-yellow-100 text-yellow-800',
};

interface StatusBadgeProps {
  status: string;
}

function StatusBadge({ status }: StatusBadgeProps) {
  const className = colorMap[status] ?? 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${className}`}>
      {status}
    </span>
  );
}

export default StatusBadge;

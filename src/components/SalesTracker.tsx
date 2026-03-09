import React from 'react';

interface SaleRecord {
  id: string;
  buyer: string;
  horse: string;
  price: number;
  date: string;
}

interface SalesTrackerProps {
  sales: SaleRecord[];
}

export default function SalesTracker({ sales }: SalesTrackerProps) {
  return (
    <div className="p-4">
      <h2 className="text-lg font-semibold mb-3">Sales</h2>
      {sales.length === 0 ? (
        <p className="text-gray-500 text-sm">No sales recorded.</p>
      ) : (
        <ul className="space-y-2">
          {sales.map((sale) => (
            <li key={sale.id} className="border rounded p-3 bg-gray-50 text-sm">
              <span className="font-bold">{sale.horse}</span>
              {' sold to '}
              <span>{sale.buyer}</span>
              {' for '}
              <span className="font-bold text-green-700">${sale.price.toLocaleString()}</span>
              <span className="text-gray-500 ml-2">({sale.date})</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

import React from "react";

export default function SalesTracker({ sales }) {
  return (
    <div className="p-4">
      <h2 className="text-lg">Sales</h2>
      <ul>
        {sales.map(sale => (
          <li key={sale.id}>
            <span>{sale.buyer} sold <span class="font-bold">{sale.price}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
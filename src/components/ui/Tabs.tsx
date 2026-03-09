import React, { useState } from 'react';

interface TabsProps {
  tabs: string[];
  children?: React.ReactNode[];
}

export default function Tabs({ tabs, children }: TabsProps) {
  const [index, setIndex] = useState(0);

  return (
    <div>
      <div className="flex space-x-1 border-b border-gray-200 mb-4">
        {tabs.map((tab, i) => (
          <button
            key={i}
            onClick={() => setIndex(i)}
            className={`px-4 py-2 text-sm font-medium rounded-t transition-colors ${
              i === index
                ? 'bg-white border border-b-white border-gray-200 text-blue-700'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>
      <div className="bg-white p-4">
        {children?.[index] ?? null}
      </div>
    </div>
  );
}

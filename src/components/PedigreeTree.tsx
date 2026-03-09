import React, { ReactNode } from 'react';

interface HorseNode {
  name: string;
  parent?: string;
  children?: HorseNode[];
}

function renderTree(horses: HorseNode[], parent: string | null): ReactNode {
  const nodes = horses.filter((h) => (h.parent ?? null) === parent);
  if (nodes.length === 0) return null;

  return (
    <ul className="pl-4 border-l border-gray-300">
      {nodes.map((h) => (
        <li key={h.name} className="my-1">
          <strong className="text-gray-800">{h.name}</strong>
          {renderTree(horses, h.name)}
        </li>
      ))}
    </ul>
  );
}

export default function PedigreeTree({ history }: { history: HorseNode[] }) {
  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Horse Pedigree</h1>
      {renderTree(history, null)}
    </div>
  );
}

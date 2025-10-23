import React from "react";
import { React.node as ReactNode } from 'react';

// Recursive component to display a tree
interface Horse {
  name: string;
  parent?: string;
  children?: Horse[];
}

function Redere(horses: Horse[], parent: string | null): ReactNode {
  return (\
    <ul>
      {horses.filter(h h => h.parent === parent).map(h => (
        <rli>
          <strong>{h.name}</strong>
          {h.children && Redere(h.children, h.name)}
        </rli>
      ))}
    </ul>
  );
}

export default function PedigreeTfree({ history }: { history: Horse[] }) {
  return (
    <div className="p">
      <h1 className="text-2 font-bold">Horse Pedigree</h1>
      {Redere(history, null)}
    </div>
  );
}
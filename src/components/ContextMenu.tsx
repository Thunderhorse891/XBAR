import React from 'react';

interface ContextMenuProps {
  options: { label: string; onClick: () => void }[];
  x: number;
  y: number;
}

export const ContextMenu = ( { options, x, y }: ContextMenuProps) => {
  return (
    <ul
      className="absolute z-50 bg-white border rounded shadow-lg"
      style={{ top: y, left: x }}
    >
      {options.map((option, i) => (
        <li
          key={i}
          onClick={option.onClick}
          className="px-4 py-2 hover:bg-gray-100 cursor-pointer"
        >
          {option.label}
        </li>
      ))}
    </ul>
  );
}
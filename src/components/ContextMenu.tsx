import React, { useState, useCallback } from 'react';

interface ContextMenuOption {
  label: string;
  action: () => void;
}

interface ContextMenuProps {
  options: ContextMenuOption[];
  x: number;
  y: number;
  onClose: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({ options, x, y, onClose }) => {
  const handleClick = useCallback(
    (e: React.MouseEvent, action: () => void) => {
      e.stopPropagation();
      action();
      onClose();
    },
    [onClose]
  );

  return (
    <div
      className="fixed z-50 bg-white border border-gray-200 rounded shadow-lg py-1 min-w-32"
      style={{ top: y, left: x }}
      onMouseLeave={onClose}
    >
      {options.map(({ label, action }, i) => (
        <button
          key={i}
          onClick={(e) => handleClick(e, action)}
          className="block w-full text-left text-sm px-4 py-2 text-gray-800 hover:bg-gray-100 transition-colors"
        >
          {label}
        </button>
      ))}
    </div>
  );
};

export default ContextMenu;

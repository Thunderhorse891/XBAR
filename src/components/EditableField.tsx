
import React, { useState } from 'react';

type EditableFieldProps = {
  value: string;
  onSave: (val: string) => void;
};

export default function EditableField({ value, onSave }: EditableFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const handleBlur = () => {
    setEditing(false);
    if (draft !== value) onSave(draft);
  };

  return editing ? (
    <input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={handleBlur}
      onKeyDown={(e)=> e.key === 'Enter' && handleBlur()}
      className="border border-gray-300 rounded px-2 py-1"
    />
  ) : (
    <span
      onDoubleClick={() => setEditing(true)}
      className="cursor-pointer hover-bg-gray-100"
    >
      {value}
    </span>
  );
}
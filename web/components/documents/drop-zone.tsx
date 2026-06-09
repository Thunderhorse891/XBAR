'use client';

import { useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { cn } from '@/lib/utils';

const MAX_BYTES = 50 * 1024 * 1024;
const ACCEPTED = ['application/pdf', 'image/jpeg', 'image/png'];

export function DropZone({ onFiles }: { onFiles: (files: File[], errors: string[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleFiles = (list: FileList | null) => {
    if (!list) return;
    const accepted: File[] = [];
    const errors: string[] = [];
    for (const file of Array.from(list)) {
      if (!ACCEPTED.includes(file.type)) {
        errors.push(`${file.name}: unsupported type — PDF, JPEG, or PNG only.`);
      } else if (file.size > MAX_BYTES) {
        errors.push(`${file.name}: exceeds the 50 MB limit.`);
      } else {
        accepted.push(file);
      }
    }
    onFiles(accepted, errors);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Upload documents. Drag and drop PDF, JPEG, or PNG files up to 50 megabytes, or press Enter to browse."
      onClick={() => inputRef.current?.click()}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        handleFiles(event.dataTransfer.files);
      }}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed bg-surface p-10 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        dragging ? 'border-accent bg-accent-glow' : 'border-steel hover:border-accent',
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-blueline bg-accent-glow" aria-hidden>
        <UploadCloud className="h-6 w-6 text-accent-strong" />
      </div>
      <div>
        <p className="text-sm font-semibold text-ink">Drag &amp; drop documents, or click to browse</p>
        <p className="mt-1 text-xs text-steel-muted">PDF, JPEG, PNG · up to 50 MB each · multiple files supported</p>
        <p className="mt-0.5 text-xs text-steel-muted">Registration papers, Coggins tests, health certificates, transfers</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".pdf,.jpg,.jpeg,.png"
        className="sr-only"
        onChange={(event) => {
          handleFiles(event.target.files);
          event.target.value = '';
        }}
        aria-hidden
        tabIndex={-1}
      />
    </div>
  );
}

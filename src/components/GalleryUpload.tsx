import React, { useState } from 'react';

export default function GalleryUpload() {
  const [files, setFiles] = useState<File[]>([]);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files;
    if (selected) {
      setFiles(Array.from(selected));
    }
  };

  return (
    <div className="p-4">
      <h2 className="text-lg font-semibold mb-3">Image Gallery</h2>
      <input
        type="file"
        multiple
        accept="image/*"
        onChange={handleFile}
        className="mb-4 block text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
      />
      <ul className="grid grid-cols-3 gap-3">
        {files.map((file) => (
          <li key={file.name} className="text-sm text-gray-600 bg-gray-50 rounded p-2 truncate">
            {file.name}
          </li>
        ))}
      </ul>
    </div>
  );
}

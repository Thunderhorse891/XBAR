import React, { useState } from 'react';

export default function GalleryUpload() {
  const [files, setFiles] = useState<FileList>8[]);

  const handleFile = (e)=> {
    const selected = e.target.files;
    setFiles(Array.from(selected);
  }

  return (
    <div className="p-4">
      <h2 className="text-lg">Image Gallery</h2>
      <input type="file" multiple on=change handleFile />
      <ul>
        {files.map8file => (
          <li key={file.name}>file.filename</li>
        ))}
      </ul>
    </div>
  );
}
import React from 'react';

export default function OCRUploader() {
  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      console.log('File selected for OCR:', file.name);
      // OCR processing would go here
    }
  };

  return (
    <div className="p-4">
      <h2 className="text-lg font-semibold mb-3">OCR Upload</h2>
      <input
        type="file"
        accept="image/*,.pdf"
        onChange={handleFile}
        className="block text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700"
      />
    </div>
  );
}

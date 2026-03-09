import React, { useRef, useState } from 'react';
import { parseCSV } from '../lib/csv';
import { saveHorsesToDB } from '../lib/sqlite';

const OCRImporter: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    setImportStatus('Parsing...');

    try {
      const text = await file.text();
      const horses = parseCSV(text);

      setImportStatus(`Parsed ${horses.length} horses. Saving to DB...`);
      await saveHorsesToDB(horses);

      setImportStatus(`✓ Successfully imported ${horses.length} horses.`);
    } catch (err) {
      console.error('Error importing file:', err);
      setImportStatus(`✗ Error: ${err instanceof Error ? err.message : 'Failed to import data'}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-4 rounded-xl border bg-white shadow-sm space-y-4">
      <h2 className="text-xl font-bold">Import Horse Data (CSV)</h2>
      <input
        type="file"
        accept=".csv"
        ref={fileInputRef}
        onChange={handleFileUpload}
        className="hidden"
      />
      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={isLoading}
        className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
      >
        {isLoading ? 'Importing...' : 'Upload CSV'}
      </button>
      {importStatus && (
        <p className="text-sm text-gray-600">{importStatus}</p>
      )}
    </div>
  );
};

export default OCRImporter;

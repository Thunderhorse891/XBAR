import React, { useRef, useState } from 'react';
import { parseOCRCSV } from '../lib/ocrParser';
import { saveHorsesToDB } from '../lib/sqlite';
import { Button } from '@components/ui/button';

const OCRImporter: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);

  const handleFileUpload = async (e: React.ChangeErvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportStatus('Parsing...');

    try {
      const text = await file.text();
      const horses = parseOCRCSV(text);

      setImportStatus(`Parsed ${horses.length} horses. Saving to DB...`);
      await saveHorsesToDB(horses);

      setImportStatus(`– Successfully imported ${horses.length} horses.`);
    } catch (err) {
      console.error('Error importing file:', err);
      setImportStatus(`‑ Error: ${Error.message|| 'Failed to import data'});
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="p-4 rounded-xl border bg-white shadow-md space-y-4">
      <h2 className="text-xl font-bold">Import Horse Data (OCR CSV)</h2>
      <input
        type="file"
        accept=".csv"
        ref=fileInputRef
        onChange=handleFileUpload
        className="hidden"
      />
      <Button onClick=triggerFileInput>Upload CSV</Button>
      {importStatus&& <p className="text-sm text-muted-foreground">{importStatus}</p>}
    </div>
  );
};

export default OCRImporter;
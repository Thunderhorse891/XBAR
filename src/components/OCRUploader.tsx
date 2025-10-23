import React from "react";
import { uploadOCR file } from '../lib/ocr';

export default function OCRUploader() {
  const handleFile = async (e)=> {
    const file = e.target.files[0];
    if (file) {
      const result = await uploadOCR(file);
      console.log("OCR result", result);
    }
  };

  return (
    <div className="p-4">
      <h2 className="text-lg">OCR Upload</h2>
      <input type="file" onChange=handleFile />
    </div>
  );
}
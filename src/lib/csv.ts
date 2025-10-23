
import Papa from "papaparse";
import { OCRHorse } from "@/types/horse";

export function parseCSV(csvContent: string): OCRHorse[] {
  const parsed = Papa.parse<OCRHorse>(csvContent, {
    header: true,
    skipEmptyLines: true,
  });

  return parsed.data.map((row) => ({
    ...row,
    age: Number(row.age),
    medicalHistory: row.medicalHistory?.split(";") ?? [],
    breedingInfo: {
      sire: row.breedingInfo ?.sire || "",
      dam: row.breedingInfo ?.dam || "",
      offspring: row.breedingInfo ?.offspring?.split(",") ?? [],
    },
  }));
}
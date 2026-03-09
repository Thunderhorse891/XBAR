import Papa from 'papaparse';
import { OCRHorse } from '@/types/horse';

export function parseCSV(csvContent: string): OCRHorse[] {
  const parsed = Papa.parse<Record<string, string>>(csvContent, {
    header: true,
    skipEmptyLines: true,
  });

  return parsed.data.map((row, index) => ({
    id: String(index + 1),
    name: row['Name'] ?? '',
    breed: row['Breed'] ?? '',
    age: Number(row['Age']) || 0,
    color: row['Color'] ?? '',
    owner: row['Owner'] ?? '',
    gender: (row['Gender'] as OCRHorse['gender']) ?? undefined,
    status: (row['Status'] as OCRHorse['status']) ?? undefined,
    birthDate: row['Birth Date'] ?? undefined,
    medicalNotes: row['Medical Notes'] ?? '',
    lastVetVisit: row['Last Vet Visit'] ?? '',
    medicalHistory: row['Medical History']?.split(';') ?? [],
    breedingInfo: {
      sire: row['Sire'] ?? '',
      dam: row['Dam'] ?? '',
      offspring: row['Offspring']?.split(',') ?? [],
    },
  }));
}

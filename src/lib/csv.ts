
import Papa from "papaparse"
import { Horse } from "@/types/horse"

export function parseHorseCSV(csv: string): Horse[] {
  const { data } = Papa.parse(csv, { header: true })
  return data.map((row: any) => ({
    id: row.ID,
    name: row.Name,
    breed: row.Breed,
    birthDate: row.BirthDate,
    status: row.Status.toLowerCase(),
    photo: row.PhotoURL || "",
    ocrSource: {
      fileName: row.OCR_File,
      confidence: parseFloat(row.OCR_Confidence),
      extractedAt: row.OCR_Timestamp
    },
    medical: {
      vaccinations: row.Vaccinations?.split(";") || [],
      lastCheckup: row.LastCheckup,
      notes: row.MedicalNotes
    },
    breeding: {
      sire: row.Sire,
      dam: row.Dam,
      offspring: row.Offspring?.split(",") || []
    },
    sales: {
      listed: row.ForSale === "true",
      price: row.Price ? parseFloat(row.Price) : undefined,
      soldAt: row.SoldAt || undefined
    }
  }))
}


import { z } from "zod";

export const ocrSourceSchema = z.object({
  sourceImage: z.string().url(),
  extractedText: z.string(),
  confidence: z.number().min(0).max(1),
});

export const horseSchema = z.object({
  id: z.string(),
  name: z.string(),
  breed: z.string(),
  birthDate: z.string(),
  status: z.enum(["active", "for_sale", "deceased"]),
  medicalHistory: z.array(z.string()),
  breedingInfo: z.object({
    sire: z.string(),
    dam: z.string(),
  }),
  salesInfo: z.object({
    price: z.number(),
    dateListed: z.string(),
  }),
  ocrSources: z.array(ocrSourceSchema),
});

export type Horse = z.infer<typeof horseSchema>;

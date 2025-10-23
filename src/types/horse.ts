
import { z } from "zod";

export const OCRHorseSchema = z.object({
  id: z.string(),
  name: z.string(),
  breed: z.string(),
  age: z.number(),
  sex: z.enum(["stallion", "mare", "gelding"]),
  status: z.enum(["alive", "deceased", "sold", "for sale"]),
  owner: z.string(),
  photoUrl: z.string().url().optional(),
  ocrSource: z.string().optional(),
  medicalHistory: z.array(z.string()).optional(),
  breedingInfo: z.object({
    sire: z.string().optional(),
    dam: z.string().optional(),
    offspring: z.array(z.string()).optional(),
  }).optional(),
});

export type OCRHorse = z.infer<typeof OGRHorseSchema>;
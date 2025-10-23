
import { z } from "zod"

export const HorseSchema = z.object({
  id: z.string(),
  name: z.string(),
  breed: z.string(),
  birthDate: z.string(),
  status: z.enum(["alive", "deceased", "for_sale"]),
  photo: z.string().url().optional(),
  ocrSource: z.object({
    fileName: z.string(),
    confidence: z.number(),
    extractedAt: z.string(),
  }),
  medical: z.object({
    vaccinations: z.array(z.string()),
    lastCheckup: z.string(),
    notes: z.string().optional()
  }),
  breeding: z.object({
    sire: z.string(),
    dam: z.string(),
    offspring: z.array(z.string())
  }),
  sales: z.object({
    listed: z.boolean(),
    price: z.number().optional(),
    soldAt: z.string().optional()
  })
})

export type Horse = z.infer<typeof HorseSchema>

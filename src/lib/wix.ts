import { invoke } from '@tauri-apps/api/tauri';
import type { OCRHorse } from '@/types/horse';

const TOKEN_KEY = 'wix_ist_token';
const DEFAULT_TOKEN =
  'IST.eyJraWQiOiJQb3pIX2FDMiIsImFsZyI6IlJTMjU2In0.eyJkYXRhIjoie1wiaWRcIjpcIjQ3MjM3MmU1LTE0YjMtNGJjOS05NjY5LTYyMmI5ZGMzNGZmM1wiLFwiaWRlbnRpdHlcIjp7XCJ0eXBlXCI6XCJhcHBsaWNhdGlvblwiLFwiaWRcIjpcIjc2OGYxZDFmLTg5NTQtNDc1My1hODY2LTAwOTZkMDM3NWMwZlwifSxcInRlbmFudFwiOntcInR5cGVcIjpcImFjY291bnRcIixcImlkXCI6XCIxMzMyZmRmOS05Y2E2LTQyZTEtODk3Ny0wNzk1MDgyNjM0ZmRcIn19IiwiaWF0IjoxNzc0MjcwOTc3fQ.PBP5g1-W4RWKMVK6uccdvTCfHE_nHOYgzvS0bQw1OtkLNVVni9nT4yZIXmtwbSZp0sM6oR8-HKZo8M68A2vz57U1Uzsc2EbqagkOVU-NdSNuNbWfbcL5GQqLlUeunVOC1Gqky0Fmk6Ibg9e8fnahPevblCrJszDzbZFlJzFzGq2o776ntEjD7zyiK2yZ9f_yvsK63evtobuSSW-29JKduUMnvyRMrmJ8GPd3tdsIYn99-QuKKOhMxg0rpdyhxqd-FvlvWcHr8-DSOfOcOECH6a9fenifq1ZzTmYKZx8ij-cWox9D3NwLt8YJt96D07L0PKZsUPdLdPr8C2EZjKGViQ';

export function getWixToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? DEFAULT_TOKEN;
}

export function setWixToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token.trim());
}

/** Ensure the Horses collection exists on the Wix site. */
export async function ensureWixCollection(): Promise<string> {
  return invoke<string>('wix_ensure_collection', { token: getWixToken() });
}

/** Push all local horses to Wix CMS (bulk upsert). */
export async function pushHorsesToWix(horses: OCRHorse[]): Promise<string> {
  return invoke<string>('wix_push_horses', {
    token: getWixToken(),
    horses,
  });
}

/** Pull all horses from Wix CMS. Returns raw data items. */
export async function pullHorsesFromWix(): Promise<OCRHorse[]> {
  const items = await invoke<Record<string, unknown>[]>('wix_pull_horses', {
    token: getWixToken(),
  });

  return items.map((d) => ({
    id: String(d['id'] ?? d['_id'] ?? crypto.randomUUID()),
    name: String(d['name'] ?? ''),
    breed: String(d['breed'] ?? ''),
    age: Number(d['age'] ?? 0),
    color: String(d['color'] ?? ''),
    owner: String(d['owner'] ?? ''),
    medicalNotes: String(d['medicalNotes'] ?? ''),
    lastVetVisit: String(d['lastVetVisit'] ?? ''),
    birthDate: d['birthDate'] ? String(d['birthDate']) : undefined,
    gender: d['gender'] as OCRHorse['gender'] | undefined,
    status: d['status'] as OCRHorse['status'] | undefined,
    microchipId: d['microchipId'] ? String(d['microchipId']) : undefined,
    profileImage: d['profileImage'] ? String(d['profileImage']) : undefined,
    registered: d['registered'] != null ? Boolean(d['registered']) : undefined,
  }));
}

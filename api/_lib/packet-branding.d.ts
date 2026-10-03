export const MAX_PACKET_LOGO_BYTES: number;
export const MAX_PACKET_LOGO_DIMENSION: number;
export interface PacketLogo {
  dataUrl: string;
  mimeType: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
  bytes: Uint8Array;
}
export interface PacketBrandingProfile {
  ranchName?: string;
  businessName?: string;
  defaultOwnerName?: string;
  ranchManagerName?: string;
  operationsEmail?: string;
  packetLogoDataUrl?: string;
  contactPhone?: string;
  website?: string;
}
export interface PacketBranding {
  name: string;
  ranch: string;
  business: string;
  email: string;
  phone: string;
  website: string;
  displayName: string;
  logoDataUrl: string;
  logoMimeType: string;
  logoWidth: number;
  logoHeight: number;
  logoBytes: Uint8Array | null;
}
export function validatePacketLogo(value: unknown): PacketLogo | null;
export function normalizePacketWebsite(value: unknown): string;
export function validatePacketProfile(profile: PacketBrandingProfile): void;
export function normalizePacketBranding(profile?: PacketBrandingProfile): PacketBranding;

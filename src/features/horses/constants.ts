import type { DocumentSource, GalleryAsset, SalesLead } from '@/types/xbar';

export const mediaKinds: GalleryAsset['kind'][] = ['Hero', 'Conformation', 'Sale Still', 'Pedigree', 'Document Cover'];
export const leadChannels: SalesLead['channel'][] = ['Facebook', 'Instagram', 'Referral', 'Site Inquiry'];
export const docSources: DocumentSource[] = ['Manual Upload', 'Bulk Intake', 'Shared Upload', 'Sales Packet'];

export function classNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

export const shareBadgeStyleMap = {
  live: 'border border-[#0c6f97]/15 bg-[#edf6fa] text-[#0c6f97]',
  blocked: 'border border-[#CC3333]/15 bg-[#fff4f4] text-[#CC3333]',
  needsReview: 'border border-[#708194]/15 bg-[#f1f5f9] text-[#5f6f80]',
  default: 'border border-[#d8e1ea] bg-[#f4f7fb] text-[#667789]',
} as const;

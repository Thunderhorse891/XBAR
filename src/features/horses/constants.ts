import type { DocumentSource, GalleryAsset, SalesLead } from '@/types/xbar';

export const mediaKinds: GalleryAsset['kind'][] = ['Hero', 'Conformation', 'Sale Still', 'Pedigree', 'Document Cover'];
export const leadChannels: SalesLead['channel'][] = ['Facebook', 'Instagram', 'Referral', 'Site Inquiry'];
export const docSources: DocumentSource[] = ['Manual Upload', 'Bulk Intake', 'Shared Upload', 'Sales Packet'];

export function classNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

export const shareBadgeStyleMap = {
  live: 'border border-[rgba(47,141,255,0.25)] bg-[rgba(47,141,255,0.1)] text-[#2F8DFF]',
  blocked: 'border border-[rgba(248,81,73,0.25)] bg-[rgba(248,81,73,0.08)] text-[#F85149]',
  needsReview: 'border border-[rgba(210,153,34,0.25)] bg-[rgba(210,153,34,0.08)] text-[#D29922]',
  default: 'border border-[rgba(48,54,61,0.9)] bg-[#1C2128] text-[#8B949E]',
} as const;

import type { DocumentSource, GalleryAsset, SalesLead } from '@/types/xbar';

export const mediaKinds: GalleryAsset['kind'][] = ['Hero', 'Conformation', 'Sale Still', 'Pedigree', 'Document Cover'];
export const leadChannels: SalesLead['channel'][] = ['Facebook', 'Instagram', 'Referral', 'Site Inquiry'];
export const docSources: DocumentSource[] = ['Manual Upload', 'Bulk Intake', 'Shared Upload', 'Sales Packet'];

export function classNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

export const shareBadgeStyleMap = {
  live: 'border border-[rgba(37,99,235,0.25)] bg-[var(--blue-soft)] text-[var(--blue-dark)]',
  blocked: 'border border-[rgba(220,38,38,0.25)] bg-[var(--rose-soft)] text-[var(--rose)]',
  needsReview: 'border border-[rgba(217,119,6,0.25)] bg-[var(--amber-soft)] text-[var(--amber)]',
  default: 'border border-[var(--border)] bg-[var(--surface-strong)] text-[var(--muted)]',
} as const;

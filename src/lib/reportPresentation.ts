import type { SubscriptionTier } from '../types/xbar.js';
import { planRank } from './commercialEngine.js';

export type ReportPresentation = { accent: string; layout: 'standard' | 'cover'; whiteLabel: boolean };
/** Print defaults mirror the named brand tokens; the parity test guards them. */
export const REPORT_ACCENT_PRESETS = { Graphite: '#171b20', Gunmetal: '#202d3c', Steel: '#596168' } as const;
export const DEFAULT_REPORT_PRESENTATION: ReportPresentation = {
  accent: REPORT_ACCENT_PRESETS.Gunmetal,
  layout: 'standard',
  whiteLabel: false,
};

export function reportAccentRgb(value: string): [number, number, number] | null {
  if (!/^#[\da-f]{6}$/i.test(value)) return null;
  return [1, 3, 5].map((start) => parseInt(value.slice(start, start + 2), 16) / 255) as [number, number, number];
}

/** Accent also labels charts; require AA against the white page, even for a custom ranch color. */
export function validReportAccent(value: string) {
  const color = reportAccentRgb(value);
  if (!color) return false;
  const linear = color.map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  return 1.05 / (luminance + 0.05) >= 4.5;
}

export function resolveReportPresentation(
  tier: SubscriptionTier,
  requested?: Partial<ReportPresentation>,
): ReportPresentation {
  const premium = planRank(tier) >= planRank('Ranch Ops');
  return {
    accent:
      premium && requested?.accent && validReportAccent(requested.accent)
        ? requested.accent
        : DEFAULT_REPORT_PRESENTATION.accent,
    layout: premium && requested?.layout === 'cover' ? 'cover' : 'standard',
    whiteLabel: tier === 'Enterprise' && requested?.whiteLabel === true,
  };
}

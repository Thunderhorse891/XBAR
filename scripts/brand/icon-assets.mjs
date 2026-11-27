import approvedAssets from '../../config/brand-assets.json' with { type: 'json' };

export const iconAssets = approvedAssets;
export const iconUrls = () => iconAssets.web;

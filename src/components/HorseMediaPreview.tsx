import { useState } from 'react';

type HorseMediaPreviewProps = {
  src?: string | null;
  name: string;
  imageClassName: string;
  fallbackClassName: string;
  emptyLabel?: string;
};

function buildInitials(name: string) {
  const parts = name
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 2);

  return (
    parts
      .map((part) => part[0])
      .join('')
      .toUpperCase() || 'XR'
  );
}

export function HorseMediaPreview({
  src,
  name,
  imageClassName,
  fallbackClassName,
  emptyLabel = 'No media',
}: HorseMediaPreviewProps) {
  const [imgError, setImgError] = useState(false);
  const mediaUrl = src?.trim();

  if (mediaUrl && !imgError) {
    return <img src={mediaUrl} alt={name} className={imageClassName} onError={() => setImgError(true)} />;
  }

  return (
    <div className={`horse-media-fallback ${fallbackClassName}`.trim()} role="img" aria-label={name}>
      <span className="horse-media-fallback__mark" aria-hidden="true">
        {buildInitials(name)}
      </span>
      <span className="horse-media-fallback__label" aria-hidden="true">
        {emptyLabel}
      </span>
    </div>
  );
}

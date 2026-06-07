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

  return parts.map((part) => part[0]).join('').toUpperCase() || 'XR';
}

export function HorseMediaPreview({
  src,
  name,
  imageClassName,
  fallbackClassName,
  emptyLabel = 'No media',
}: HorseMediaPreviewProps) {
  const mediaUrl = src?.trim();

  if (mediaUrl) {
    return <img src={mediaUrl} alt={name} className={imageClassName} />;
  }

  return (
    <div className={`horse-media-fallback ${fallbackClassName}`.trim()} aria-hidden="true">
      <span className="horse-media-fallback__mark">{buildInitials(name)}</span>
      <span className="horse-media-fallback__label">{emptyLabel}</span>
    </div>
  );
}

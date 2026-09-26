import { useEffect, useState } from 'react';
import { defaultHorseMediaResolver, useHorseMediaUrl } from '@/hooks/useHorseMediaUrl';

type HorseMediaPreviewProps = {
  src?: string | null;
  /**
   * Cloud storage path for the image. When present, the component resolves a
   * short-lived signed URL for it (the horse-media bucket is private, so the
   * stored `src` alone is not viewable). `src` remains the fallback for legacy
   * public URLs, external links, and local object URLs.
   */
  storagePath?: string | null;
  /**
   * Turns a storagePath into a viewable URL. Defaults to the workspace-member
   * path (a direct signed URL, which the bucket's storage policies grant to
   * members). Buyer-facing pages pass the token-gated server resolver instead,
   * because anonymous buyers hold no storage grant of their own.
   */
  signedUrlResolver?: (storagePath: string) => Promise<string | null>;
  name: string;
  imageClassName: string;
  fallbackClassName: string;
  emptyLabel?: string;
};

const defaultSignedUrlResolver = defaultHorseMediaResolver;

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
  storagePath,
  signedUrlResolver = defaultSignedUrlResolver,
  name,
  imageClassName,
  fallbackClassName,
  emptyLabel = 'No media',
}: HorseMediaPreviewProps) {
  const [imgError, setImgError] = useState(false);
  const mediaUrl = useHorseMediaUrl(storagePath, src, signedUrlResolver);

  useEffect(() => {
    setImgError(false);
  }, [mediaUrl]);

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

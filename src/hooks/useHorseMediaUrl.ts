import { useEffect, useRef, useState } from 'react';
import { getHorseMediaSignedUrl } from '../lib/cloudWorkspace.js';

/**
 * Default storagePath -> viewable URL resolver for signed-in workspace
 * members: a short-lived signed URL, which the horse-media bucket's storage
 * policies grant to the uploader and to members of the workspace whose horse
 * references the object.
 */
export const defaultHorseMediaResolver = (storagePath: string) => getHorseMediaSignedUrl(storagePath);

/**
 * Resolve the viewable URL for one horse-media asset.
 *
 * When a storagePath is present, a signed URL is minted for it (async) and
 * wins once it arrives; `fallbackSrc` covers legacy public URLs, external
 * links, and local object URLs, and is also what renders while the signature
 * is in flight. With neither, the result is '' and the caller shows its own
 * empty state.
 */
export function useHorseMediaUrl(
  storagePath: string | null | undefined,
  fallbackSrc: string | null | undefined,
  resolver: (storagePath: string) => Promise<string | null> = defaultHorseMediaResolver,
): string {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  // Held in a ref so an inline resolver prop cannot retrigger the fetch loop.
  const resolverRef = useRef(resolver);
  resolverRef.current = resolver;

  useEffect(() => {
    if (!storagePath) {
      setSignedUrl(null);
      return;
    }
    let alive = true;
    setSignedUrl(null);
    void resolverRef
      .current(storagePath)
      .then((url) => {
        if (alive && url) {
          setSignedUrl(url);
        }
      })
      .catch(() => {
        // A refused or failed signature is not fatal here: the caller still
        // has `fallbackSrc`, and its own empty state otherwise.
      });
    return () => {
      alive = false;
    };
  }, [storagePath]);

  return signedUrl ?? fallbackSrc?.trim() ?? '';
}

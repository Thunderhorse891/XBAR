import { useEffect } from 'react';
import { useCloudStore } from '@/store/useCloudStore';

export function CloudBootstrap() {
  const initialize = useCloudStore((state) => state.initialize);

  useEffect(() => {
    let dispose: (() => void) | void;

    void initialize().then((cleanup) => {
      dispose = cleanup;
    });

    return () => {
      dispose?.();
    };
  }, [initialize]);

  return null;
}

import { vaultOwnerId } from '@/lib/vaultOwner';
import { useUiStore } from '@/store/useUiStore';
import { useXbarStore } from '@/store/useXbarStore';

/** One recoverable archive flow for both the roster and the horse profile. */
export function useHorseArchiveActions() {
  const archiveHorse = useXbarStore((state) => state.archiveHorse);
  const restoreHorse = useXbarStore((state) => state.restoreHorse);
  const pushToast = useUiStore((state) => state.pushToast);

  const handleRestore = (horseId: string, archiveId: string, expectedOwnerId?: string) => {
    const result = restoreHorse(horseId, archiveId, expectedOwnerId);
    pushToast({
      title: result.ok ? 'Horse restored' : 'Restore blocked',
      message: result.message,
      tone: result.ok ? 'success' : 'error',
    });
  };

  const handleArchive = (horseId: string) => {
    const archiveOwnerId = vaultOwnerId();
    const result = archiveHorse(horseId);
    const archiveId = result.archiveId;
    pushToast({
      title: result.ok ? 'Horse archived' : 'Archive blocked',
      message: result.message,
      tone: result.ok ? 'success' : 'error',
      duration: result.ok ? 10000 : 4000,
      action:
        result.ok && archiveId
          ? { label: 'Undo', onClick: () => handleRestore(horseId, archiveId, archiveOwnerId) }
          : undefined,
    });
  };

  return { handleArchive, handleRestore };
}

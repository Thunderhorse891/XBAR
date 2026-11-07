import { useRef, useState } from 'react';
import { ActionButton, Card, StatusChip } from '@/components/saas';
import { ConfirmActionDialog } from '@/components/ConfirmActionDialog';
import { HorseMediaPreview } from '@/components/HorseMediaPreview';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { isHorsePhotoAsset } from '@/lib/animalPassport';
import { useCurrentRoleCapability, useXbarStore } from '@/store/useXbarStore';
import { useCloudStore } from '@/store/useCloudStore';
import { vaultOwnerId } from '@/lib/vaultOwner';
import { useUiStore } from '@/store/useUiStore';
import type { HorseRecord } from '@/types/xbar';
import type { HorsePhotoAction } from '@/lib/horsePhotoGallery';

export function HorsePhotoGallery({
  horse,
  onAdd,
  uploading,
}: {
  horse: HorseRecord;
  onAdd: () => void;
  uploading: boolean;
}) {
  const canManage = useCurrentRoleCapability('uploadMedia');
  const changePhoto = useXbarStore((s) => s.changeHorsePhoto);
  const pushToast = useUiStore((s) => s.pushToast);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [removal, setRemoval] = useState<{ assetId: string; horse: HorseRecord; owner: string; user?: string } | null>(
    null,
  );
  const opener = useRef<HTMLButtonElement | null>(null);
  const photos = horse.gallery.filter(isHorsePhotoAsset);
  const removed = horse.gallery.filter(
    (asset) =>
      asset.status === 'Archived' &&
      isHorsePhotoAsset({ kind: asset.kind, url: asset.url, storagePath: asset.storagePath }),
  );
  const selected = photos.find((asset) => asset.id === selectedId);
  const primary =
    photos.find((asset) => asset.isPrimary === true) ??
    photos.find((asset) => horse.profileImage && asset.url === horse.profileImage) ??
    (!horse.profileImage ? photos[0] : undefined);
  const act = (assetId: string, action: HorsePhotoAction) => {
    const result = changePhoto(horse.id, assetId, action);
    pushToast({
      title: result.ok ? 'Horse photos' : 'Photo change blocked',
      message: result.message,
      tone: result.ok ? 'success' : 'error',
    });
    if (result.ok && action === 'remove') setSelectedId(null);
    setRemoval(null);
  };
  return (
    <Card title="Photo gallery">
      {canManage ? (
        <ActionButton size="sm" disabled={uploading} onClick={onAdd}>
          {uploading ? 'Uploading…' : 'Add photos'}
        </ActionButton>
      ) : null}
      {!photos.length ? (
        <p className="xs-muted">No gallery photos yet.</p>
      ) : (
        <div className="xs-grid-3" style={{ marginTop: 12 }}>
          {photos.map((asset) => (
            <div key={asset.id}>
              <button
                type="button"
                className="button button--ghost"
                style={{ padding: 0, width: '100%' }}
                onClick={(event) => {
                  opener.current = event.currentTarget;
                  setSelectedId(asset.id);
                }}
                aria-label={`View ${asset.label}`}
              >
                <HorseMediaPreview
                  src={asset.url}
                  storagePath={asset.storagePath}
                  name={asset.label}
                  imageClassName="w-full h-36 object-cover rounded"
                  fallbackClassName="w-full h-36"
                />
              </button>
              <p>{asset.label}</p>
              {primary?.id === asset.id ? <StatusChip tone="info">Primary photo</StatusChip> : null}
              {canManage ? (
                <div className="inline-actions" style={{ marginTop: 8 }}>
                  <ActionButton
                    size="sm"
                    disabled={uploading || primary?.id === asset.id}
                    onClick={() => act(asset.id, 'primary')}
                  >
                    Make primary
                  </ActionButton>
                  <ActionButton
                    size="sm"
                    disabled={uploading}
                    onClick={() =>
                      setRemoval({
                        assetId: asset.id,
                        horse,
                        owner: vaultOwnerId(),
                        user: useCloudStore.getState().session?.user.id,
                      })
                    }
                  >
                    Remove photo
                  </ActionButton>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
      {removed.length ? (
        <details style={{ marginTop: 16 }}>
          <summary>Removed photos ({removed.length})</summary>
          <p>Originals are retained. Restore a photo to return it to the gallery.</p>
          {removed.map((asset) => (
            <div key={asset.id} className="xs-mrow">
              <span>{asset.label}</span>
              {canManage ? (
                <ActionButton size="sm" disabled={uploading} onClick={() => act(asset.id, 'restore')}>
                  Restore photo
                </ActionButton>
              ) : null}
            </div>
          ))}
        </details>
      ) : null}
      <Dialog
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
      >
        <DialogContent
          className="max-w-3xl"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            opener.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>{selected?.label ?? 'Horse photo'}</DialogTitle>
            <DialogDescription>{horse.name} photo gallery</DialogDescription>
          </DialogHeader>
          {selected ? (
            <HorseMediaPreview
              src={selected.url}
              storagePath={selected.storagePath}
              name={selected.label}
              imageClassName="w-full max-h-[70vh] object-contain"
              fallbackClassName="w-full h-36"
            />
          ) : null}
        </DialogContent>
      </Dialog>
      <ConfirmActionDialog
        open={Boolean(removal)}
        title="Remove photo from gallery?"
        consequences={[
          'This photo will leave the active gallery. Its original is retained and can be restored from Removed photos.',
        ]}
        confirmLabel="Remove photo"
        onConfirm={() => {
          if (!removal) return;
          if (
            vaultOwnerId() !== removal.owner ||
            useCloudStore.getState().session?.user.id !== removal.user ||
            useXbarStore.getState().horses.find((item) => item.id === horse.id) !== removal.horse
          ) {
            pushToast({
              title: 'Photo changed',
              message: 'The horse or ranch changed. Review the photo again before removing it.',
              tone: 'error',
            });
            setRemoval(null);
            return;
          }
          act(removal.assetId, 'remove');
        }}
        onCancel={() => setRemoval(null)}
      />
    </Card>
  );
}

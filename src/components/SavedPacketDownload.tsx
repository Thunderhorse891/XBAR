import { useState } from 'react';
import { downloadStoredFile } from '@/lib/downloadStoredFile';
import { vaultOwnerId } from '@/lib/vaultOwner';
import { readRecordsOwner } from '@/lib/recordsOwner';
import { useCloudStore } from '@/store/useCloudStore';
import { useUiStore } from '@/store/useUiStore';
import { useXbarStore } from '@/store/useXbarStore';
import type { SalePacketBuild } from '@/types/xbar';

function scope() {
  const cloud = useCloudStore.getState();
  return JSON.stringify([
    vaultOwnerId(),
    readRecordsOwner(),
    cloud.session?.user.id,
    cloud.workspaceId,
    cloud.workspaceRole,
    useXbarStore.getState().currentRole,
  ]);
}

export function SavedPacketDownload({
  packet,
  className = 'button button--ghost button--compact',
}: {
  packet: SalePacketBuild;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const download = async () => {
    if (busy) return;
    setBusy(true);
    const identity = scope();
    const result = await downloadStoredFile(
      packet,
      () =>
        scope() === identity &&
        useXbarStore.getState().salePacketBuilds.find((item) => item.id === packet.id) === packet,
    );
    setBusy(false);
    if (!result.ok)
      useUiStore.getState().pushToast({ title: 'Packet was not downloaded', message: result.message, tone: 'error' });
  };
  return (
    <button type="button" className={className} disabled={busy} onClick={() => void download()}>
      {busy ? 'Downloading…' : 'Download saved packet'}
    </button>
  );
}

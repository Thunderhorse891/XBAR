import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { XbarMark } from '@/components/BrandMark';
import { useCloudStore } from '@/store/useCloudStore';
import { useXbarStore } from '@/store/useXbarStore';
import { hasRoleCapability } from '@/lib/permissions';
import { hasNativeBridge } from '@/lib/nativePlatform';
import { supabaseConfig } from '@/lib/platformConfig';
import { readRecordsOwner } from '@/lib/recordsOwner';
import { vaultOwnerId } from '@/lib/vaultOwner';
import {
  canSharePacketFile,
  downloadPreparedSalePacket,
  prepareSalePacketFile,
  sharePreparedSalePacket,
  STALE_PACKET_MESSAGE,
  type PacketHandoffResult,
  type PreparedSalePacket,
} from '@/lib/salePacketSharing';
import type { SalePacketBuild } from '@/types/xbar';
import './confirmActionDialog.css';

function shareIdentity() {
  const cloud = useCloudStore.getState();
  return JSON.stringify([
    cloud.session?.user.id ?? '',
    cloud.workspaceId,
    cloud.workspaceRole,
    cloud.autosaveReady,
    cloud.autosaveUnlocked,
    useXbarStore.getState().currentRole,
    vaultOwnerId(),
    readRecordsOwner(),
  ]);
}

function maySharePacket() {
  const cloud = useCloudStore.getState();
  return (
    cloud.autosaveReady &&
    cloud.autosaveUnlocked &&
    readRecordsOwner() === vaultOwnerId() &&
    hasRoleCapability(useXbarStore.getState().currentRole, 'manageSharedAccess') &&
    (!cloud.workspaceId || Boolean(cloud.workspaceRole && hasRoleCapability(cloud.workspaceRole, 'manageSharedAccess')))
  );
}

function handoffMessage(result: PacketHandoffResult): string {
  if (result.status === 'handed-off')
    return 'File handed to the share sheet. Finish in the app you chose; XBAR cannot confirm an upload or post.';
  if (result.status === 'download-started')
    return 'Download started. Review the file, then upload it manually where supported.';
  if (result.status === 'cancelled') return 'Share cancelled.';
  return 'message' in result ? result.message : 'The file could not be handed off.';
}

/** One selected, immutable packet. Preparing a file never opens a share sheet. */
export function SalePacketShareDialog({ packet, onClose }: { packet: SalePacketBuild; onClose: () => void }) {
  const [prepared, setPrepared] = useState<PreparedSalePacket | null>(null);
  const [approved, setApproved] = useState(false);
  const [working, setWorking] = useState(false);
  const [stale, setStale] = useState(false);
  const [message, setMessage] = useState('');
  const [failure, setFailure] = useState(false);
  const request = useRef({ mounted: false, epoch: 0, busy: false, identity: '', controller: new AbortController() });
  const horse = useXbarStore((state) => state.horses.find((item) => item.id === packet.horseId));
  const native = hasNativeBridge();

  const isCurrent = (epoch: number) => {
    const state = request.current;
    return (
      state.mounted &&
      state.epoch === epoch &&
      state.identity === shareIdentity() &&
      maySharePacket() &&
      useXbarStore.getState().salePacketBuilds.find((item) => item.id === packet.id) === packet
    );
  };

  const prepare = async () => {
    const state = request.current;
    if (state.busy || !isCurrent(state.epoch)) return;
    state.busy = true;
    const epoch = state.epoch;
    setWorking(true);
    setMessage('Preparing the saved file…');
    setFailure(false);
    const cloud = useCloudStore.getState();
    try {
      const file = await prepareSalePacketFile(packet, {
        ownerId: vaultOwnerId(),
        workspaceId: cloud.workspaceId,
        accessToken: cloud.session?.access_token ?? '',
        supabaseUrl: supabaseConfig.url,
        isCurrent: () => isCurrent(epoch),
        signal: state.controller.signal,
      });
      if (!isCurrent(epoch)) return;
      setPrepared(file);
      setMessage('File ready. Review its contents before choosing an app.');
    } catch (error) {
      if (!isCurrent(epoch)) return;
      setFailure(true);
      setMessage(error instanceof Error ? error.message : 'The saved file could not be read. Try again.');
    } finally {
      if (isCurrent(epoch)) {
        state.busy = false;
        setWorking(false);
      }
    }
  };

  useEffect(() => {
    const state = request.current;
    state.mounted = true;
    state.identity = shareIdentity();
    state.controller = new AbortController();
    const invalidate = () => {
      state.epoch += 1;
      state.busy = false;
      state.controller.abort();
      setPrepared(null);
      setApproved(false);
      setWorking(false);
      setStale(true);
      setFailure(true);
      setMessage(STALE_PACKET_MESSAGE);
    };
    const stopCloud = useCloudStore.subscribe(() => {
      if (shareIdentity() !== state.identity) invalidate();
    });
    const stopWorkspace = useXbarStore.subscribe((next, previous) => {
      if (
        shareIdentity() !== state.identity ||
        next.horses !== previous.horses ||
        next.documents !== previous.documents ||
        next.workspaceProfile !== previous.workspaceProfile ||
        next.ownershipRecords !== previous.ownershipRecords ||
        next.salePacketBuilds.find((item) => item.id === packet.id) !== packet
      )
        invalidate();
    });
    if (maySharePacket()) void prepare();
    else {
      setStale(true);
      setFailure(true);
      setMessage('Sharing requires a settled ranch workspace and a role that can manage sharing.');
    }
    return () => {
      state.mounted = false;
      state.epoch += 1;
      state.busy = false;
      state.controller.abort();
      stopCloud();
      stopWorkspace();
    };
    // The parent keys this dialog by packet ID. Store subscriptions invalidate
    // even a rapid A → B → A change before React renders again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packet]);

  const deliver = async (kind: 'share' | 'download') => {
    const state = request.current;
    if (!prepared || state.busy || stale || !isCurrent(state.epoch) || ((kind === 'share' || native) && !approved))
      return;
    state.busy = true;
    const epoch = state.epoch;
    setWorking(true);
    setFailure(false);
    const result = await (kind === 'share' ? sharePreparedSalePacket : downloadPreparedSalePacket)(prepared, () =>
      isCurrent(epoch),
    );
    if (!isCurrent(epoch)) return;
    state.busy = false;
    setWorking(false);
    setFailure(result.status === 'error' || result.status === 'unavailable');
    setMessage(handoffMessage(result));
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="confirm-dialog" style={{ width: 'min(560px, calc(100% - 24px))' }}>
        <DialogHeader>
          <XbarMark width={72} height={41} title="XBAR" />
          <DialogTitle className="confirm-dialog__title">Share sale document</DialogTitle>
          <DialogDescription>
            Review the complete packet for {horse?.name || 'this horse'} before handing it to another app.
          </DialogDescription>
        </DialogHeader>
        <div>
          <p style={{ overflowWrap: 'anywhere' }}>{prepared?.file.name ?? packet.fileName ?? 'Saved sale packet'}</p>
          <ul className="confirm-dialog__consequences">
            <li>
              {packet.documentIds.length} source document record{packet.documentIds.length === 1 ? '' : 's'} selected
              for this build
              {packet.includesBillOfSale ? '; Bill of Sale requested' : ''}. Review the saved file to confirm which
              documents it contains.
            </li>
            <li>
              May contain registration papers, veterinary records, ownership details, signatures, prices and seller or
              buyer contact information.
            </li>
            {packet.buyerName || packet.buyerEmail ? (
              <li>Prepared for {[packet.buyerName, packet.buyerEmail].filter(Boolean).join(' · ')}.</li>
            ) : null}
            <li>
              The entire saved file and embedded documents go to the app you choose. Rebuild the packet to remove
              information first.
            </li>
          </ul>
          <p className="confirm-dialog__proof">
            PDF and HTML files are not accepted by every social app. If no compatible app appears, download the file and
            upload it manually where supported. XBAR does not convert the packet into a social image or publish a post.
          </p>
          <p style={{ fontSize: 13 }}>
            Facebook Marketplace prohibits animal sales; Facebook and Instagram also restrict peer-to-peer animal-sale
            posts. Check the{' '}
            <a href="https://www.oversightboard.com/decision/bun-63gbjx9k/" target="_blank" rel="noopener noreferrer">
              platform policy
            </a>{' '}
            before posting.
          </p>
          <label className="confirm-dialog__ack">
            <input
              type="checkbox"
              checked={approved}
              disabled={stale || working || !prepared}
              onChange={(event) => setApproved(event.target.checked)}
            />
            I reviewed this entire packet and approve sharing its contents with the app and audience I choose.
          </label>
        </div>
        <p role={failure ? 'alert' : 'status'} aria-live="polite" style={{ fontSize: 13, margin: 0 }}>
          {message}
        </p>
        {prepared && !canSharePacketFile(prepared.file) ? (
          <p style={{ fontSize: 13, margin: 0 }}>
            File sharing is unavailable here. Use Download for review or manual upload.
          </p>
        ) : null}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {!prepared && !stale ? (
            <button type="button" className="button button--compact" disabled={working} onClick={() => void prepare()}>
              {working ? 'Preparing…' : 'Try preparing again'}
            </button>
          ) : null}
          {prepared ? (
            <>
              <button
                type="button"
                className="button button--primary button--compact"
                disabled={working || stale || !approved || !canSharePacketFile(prepared.file)}
                onClick={() => void deliver('share')}
              >
                Choose app…
              </button>
              <button
                type="button"
                className="button button--ghost button--compact"
                disabled={working || stale || (native && !approved)}
                onClick={() => void deliver('download')}
              >
                {native ? 'Save using share sheet' : 'Download for review or upload'}
              </button>
            </>
          ) : null}
          <button type="button" className="button button--ghost button--compact" onClick={onClose}>
            Close
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

import type { PacketFailureGuidance } from '../lib/salePacketGuidance.js';

export function PacketFailureNotice({
  failure,
  onRepair,
}: {
  failure: PacketFailureGuidance;
  onRepair: (destination: string) => void;
}) {
  return (
    <div role="alert" className="confirm-dialog__proof">
      <strong>Packet needs attention</strong>
      <p>{failure.message}</p>
      <p>{failure.help}</p>
      {failure.action && (
        <button
          type="button"
          className="button button--ghost button--compact"
          onClick={() => onRepair(failure.action!.to)}
        >
          {failure.action.label}
        </button>
      )}
    </div>
  );
}

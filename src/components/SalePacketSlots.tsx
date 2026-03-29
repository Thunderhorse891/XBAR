import type { SalePacketSlot } from '@/lib/xbarPhaseTwo';

function classNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

const statusLabels: Record<SalePacketSlot['status'], string> = {
  ready: 'Ready',
  review: 'Review',
  missing: 'Missing',
};

export function SalePacketSlots({
  slots,
  compact = false,
}: {
  slots: SalePacketSlot[];
  compact?: boolean;
}) {
  return (
    <div className={classNames('sale-packet-grid', compact && 'sale-packet-grid--compact')}>
      {slots.map((slot) => (
        <div
          key={slot.key}
          className={classNames('sale-packet-slot', `sale-packet-slot--${slot.status}`)}
          title={compact ? slot.detail : undefined}
        >
          <div className="sale-packet-slot__head">
            <span className="sale-packet-slot__label">{slot.label}</span>
            <span className="sale-packet-slot__state">{statusLabels[slot.status]}</span>
          </div>
          {!compact ? <div className="sale-packet-slot__detail">{slot.detail}</div> : null}
        </div>
      ))}
    </div>
  );
}

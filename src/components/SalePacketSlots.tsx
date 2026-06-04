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
  onFix,
}: {
  slots: SalePacketSlot[];
  compact?: boolean;
  onFix?: (key: SalePacketSlot['key']) => void;
}) {
  return (
    <div className={classNames('sale-packet-grid', compact && 'sale-packet-grid--compact')}>
      {slots.map((slot) => {
        const showFix = onFix && slot.status !== 'ready';
        return (
          <div
            key={slot.key}
            className={classNames('sale-packet-slot', `sale-packet-slot--${slot.status}`)}
            title={compact ? slot.detail : undefined}
          >
            <div className="sale-packet-slot__head">
              <span className="sale-packet-slot__label">{slot.label}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span className="sale-packet-slot__state">{statusLabels[slot.status]}</span>
                {showFix && (
                  <button
                    type="button"
                    className="sale-packet-slot__fix"
                    title={`Go to ${slot.label} — ${slot.detail}`}
                    onClick={() => onFix(slot.key)}
                  >
                    Fix
                  </button>
                )}
              </div>
            </div>
            {!compact ? <div className="sale-packet-slot__detail">{slot.detail}</div> : null}
          </div>
        );
      })}
    </div>
  );
}

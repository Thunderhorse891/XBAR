import { useEffect, useRef, useState, type ReactNode } from 'react';
import './confirmActionDialog.css';

/*
 * Replaces window.confirm for destructive and legal actions. The confirm
 * button stays disabled until every acknowledgement is checked and, when
 * requireText is set, the operator has typed the exact phrase — a proof
 * check, not a reflex click.
 */

export interface ConfirmActionDialogProps {
  open: boolean;
  title: string;
  tone?: 'danger' | 'legal';
  consequences: string[];
  proofSummary?: ReactNode;
  acknowledgements?: string[];
  requireText?: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmActionDialog({
  open,
  title,
  tone = 'danger',
  consequences,
  proofSummary,
  acknowledgements = [],
  requireText,
  confirmLabel,
  onConfirm,
  onCancel,
}: ConfirmActionDialogProps) {
  const [checked, setChecked] = useState<boolean[]>([]);
  const [typed, setTyped] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setChecked(acknowledgements.map(() => false));
      setTyped('');
      const frame = requestAnimationFrame(() => {
        const focusable = panelRef.current?.querySelector<HTMLElement>('input, button');
        focusable?.focus();
      });
      return () => cancelAnimationFrame(frame);
    }
    return undefined;
  }, [open, acknowledgements.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  const allAcknowledged = checked.every(Boolean);
  const textMatches = !requireText || typed === requireText;
  const ready = allAcknowledged && textMatches;
  const blockerHint = !allAcknowledged
    ? 'Check every acknowledgement to continue.'
    : !textMatches
      ? `Type “${requireText}” exactly to enable ${confirmLabel.toLowerCase()}.`
      : '';

  return (
    <div className="confirm-dialog__overlay" role="presentation" onClick={onCancel}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className={`confirm-dialog confirm-dialog--${tone}`}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="confirm-dialog-title" className="confirm-dialog__title">
          {title}
        </h2>

        <ul className="confirm-dialog__consequences">
          {consequences.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>

        {proofSummary && <div className="confirm-dialog__proof">{proofSummary}</div>}

        {acknowledgements.length > 0 && (
          <div className="confirm-dialog__acks">
            {acknowledgements.map((text, index) => (
              <label key={text} className="confirm-dialog__ack">
                <input
                  type="checkbox"
                  checked={checked[index] ?? false}
                  onChange={(event) =>
                    setChecked((previous) => previous.map((value, i) => (i === index ? event.target.checked : value)))
                  }
                />
                <span>{text}</span>
              </label>
            ))}
          </div>
        )}

        {requireText && (
          <div className="confirm-dialog__type-check">
            <label htmlFor="confirm-dialog-type">
              Type <strong>{requireText}</strong> to confirm
            </label>
            <input
              id="confirm-dialog-type"
              type="text"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        )}

        {blockerHint && (
          <p className="confirm-dialog__hint" role="status">
            {blockerHint}
          </p>
        )}

        <div className="confirm-dialog__actions">
          <button type="button" className="confirm-dialog__cancel" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={`confirm-dialog__confirm confirm-dialog__confirm--${tone}`}
            disabled={!ready}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

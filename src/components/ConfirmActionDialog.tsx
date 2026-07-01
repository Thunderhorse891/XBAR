import { useEffect, useId, useState, type ReactNode } from 'react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  const idPrefix = useId();
  const [checked, setChecked] = useState<boolean[]>([]);
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (open) {
      setChecked(acknowledgements.map(() => false));
      setTyped('');
    }
  }, [open, acknowledgements.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const allAcknowledged = checked.every(Boolean);
  const textMatches = !requireText || typed === requireText;
  const ready = allAcknowledged && textMatches;
  const blockerHint = !allAcknowledged
    ? 'Check every acknowledgement to continue.'
    : !textMatches
      ? `Type "${requireText}" exactly to enable ${confirmLabel.toLowerCase()}.`
      : '';

  return (
    <AlertDialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onCancel(); }}>
      <AlertDialogContent className={`confirm-dialog confirm-dialog--${tone}`}>
        <AlertDialogHeader>
          <AlertDialogTitle className="confirm-dialog__title">{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>
              <ul className="confirm-dialog__consequences">
                {consequences.map((line) => <li key={line}>{line}</li>)}
              </ul>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        {proofSummary && <div className="confirm-dialog__proof">{proofSummary}</div>}

        {acknowledgements.length > 0 && (
          <div className="confirm-dialog__acks">
            {acknowledgements.map((text, index) => (
              <div key={text} className="confirm-dialog__ack">
                <Checkbox
                  id={`${idPrefix}-ack-${index}`}
                  checked={checked[index] ?? false}
                  onCheckedChange={(value) =>
                    setChecked((previous) => previous.map((item, i) => (i === index ? Boolean(value) : item)))
                  }
                />
                <Label htmlFor={`${idPrefix}-ack-${index}`}>{text}</Label>
              </div>
            ))}
          </div>
        )}

        {requireText && (
          <div className="confirm-dialog__type-check">
            <Label htmlFor={`${idPrefix}-type`}>
              Type <strong>{requireText}</strong> to confirm
            </Label>
            <Input
              id={`${idPrefix}-type`}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        )}

        {blockerHint && <p className="confirm-dialog__hint" role="status">{blockerHint}</p>}

        <AlertDialogFooter className="confirm-dialog__actions">
          <Button type="button" variant="outline" className="confirm-dialog__cancel" onClick={onCancel}>Cancel</Button>
          <Button
            type="button"
            variant={tone === 'danger' ? 'destructive' : 'default'}
            className={`confirm-dialog__confirm confirm-dialog__confirm--${tone}`}
            disabled={!ready}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

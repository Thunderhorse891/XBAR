import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type MenuTone = 'default' | 'danger';
export type ContextMenuItem = {
  id: string;
  label: string;
  onSelect: () => void;
  tone?: MenuTone;
  disabled?: boolean;
  disabledReason?: string;
};

export function ContextMenu({
  open,
  x,
  y,
  items,
  onClose,
}: {
  open: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden="true"
          style={{
            position: 'fixed',
            left: Math.max(8, Math.min(x, window.innerWidth - 224)),
            top: Math.max(8, Math.min(y, window.innerHeight - Math.max(140, items.length * 48))),
            width: 1,
            height: 1,
          }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="context-menu" align="start" side="bottom" sideOffset={0}>
        <DropdownMenuLabel className="context-menu__hint">
          Actions <span>Esc to close</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {items.map((item) => (
          <DropdownMenuItem
            key={item.id}
            className={`context-menu__item${item.tone === 'danger' ? ' context-menu__item--danger' : ''}`}
            disabled={item.disabled}
            title={item.disabled ? (item.disabledReason ?? 'This action is unavailable.') : item.label}
            onSelect={() => {
              if (item.disabled) return;
              item.onSelect();
              onClose();
            }}
          >
            <span>{item.label}</span>
            {item.disabled && item.disabledReason ? <small>{item.disabledReason}</small> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

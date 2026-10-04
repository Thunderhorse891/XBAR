/** Only the explicit Camera choice requests capture. Other sources must let
 * the OS expose existing photos/files, including in the native WebView. */
export const photoSources = [
  { id: 'library', label: 'Photo library', accept: 'image/*', multiple: true },
  { id: 'camera', label: 'Camera', accept: 'image/*', capture: 'environment', multiple: false },
  {
    id: 'files',
    label: 'Files',
    // Extensions also cover providers that omit an image's MIME type. This is
    // a picker hint, not a new format-validation or conversion policy.
    accept: '.jpg,.jpeg,.png,.webp,.gif,.avif,.heic,.heif,.bmp,.tif,.tiff,.svg,.ico',
    multiple: true,
  },
] as const;

/** Copy before clearing: the native FileList is tied to its input. Clearing
 * lets the same file fire change again after an upload failure. Cancel is empty. */
export function takePhotoSelection(input: { files: ArrayLike<File> | null; value: string }): File[] {
  const files = Array.from(input.files ?? []);
  input.value = '';
  return files;
}

/** A picker request belongs to one record, route and authorization context.
 * Reference identities additionally invalidate a local reset/reload that reuses IDs. */
export type PhotoSelectionScope = {
  horseId: string;
  routeKey: string;
  routeUrl: string;
  accountId: string;
  workspaceId: string;
  role: string;
  workspaceRecord: object;
  horseRecord: object;
};
export type PhotoSelectionTicket = { generation: number; scope: PhotoSelectionScope };

function sameScope(left: PhotoSelectionScope, right: PhotoSelectionScope) {
  return (Object.keys(left) as (keyof PhotoSelectionScope)[]).every((key) => left[key] === right[key]);
}

/** Invalidations are irreversible for a ticket: A → B → A cannot revive it.
 * Consumption is one-shot, including callbacks retained by an unmounted input. */
export function createPhotoSelectionGate() {
  let generation = 0;
  let active: PhotoSelectionTicket | null = null;
  return {
    open(scope: PhotoSelectionScope): PhotoSelectionTicket {
      active = { generation: ++generation, scope };
      return active;
    },
    invalidate() {
      generation += 1;
      active = null;
    },
    reconcile(scope: PhotoSelectionScope | null): boolean {
      if (!active) return false;
      if (scope && sameScope(active.scope, scope)) return false;
      this.invalidate();
      return true;
    },
    consume(ticket: PhotoSelectionTicket, scope: PhotoSelectionScope | null): string | null {
      if (active !== ticket || ticket.generation !== generation || !scope || !sameScope(ticket.scope, scope)) {
        // A stale callback must not invalidate a newer request.
        if (active === ticket) this.invalidate();
        return null;
      }
      this.invalidate();
      return ticket.scope.horseId;
    },
  };
}

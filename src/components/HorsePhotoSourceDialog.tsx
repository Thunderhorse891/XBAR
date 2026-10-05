import { useRef, type ChangeEvent } from 'react';
import { Camera, FolderOpen, Images } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { photoSources, takePhotoSelection } from '@/lib/photoSelection';

const sourceIcons = { library: Images, camera: Camera, files: FolderOpen };

export function HorsePhotoSourceDialog({
  open,
  onOpenChange,
  onFilesSelected,
  onRestoreFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFilesSelected: (files: File[]) => void;
  onRestoreFocus: () => void;
}) {
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  function selectFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = takePhotoSelection(event.currentTarget);
    // A cancelled native picker leaves the source choices open and does not
    // start an upload, show an error, or replace the horse's existing photo.
    if (!files.length) return;
    // The parent consumes the originating ticket before closing the dialog.
    onFilesSelected(files);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[calc(100vw-2rem)] sm:max-w-md"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onRestoreFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Add horse photos</DialogTitle>
          <DialogDescription>
            Choose existing photos or take a new one. The first uploaded photo becomes the profile image; additional
            photos join the gallery.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {photoSources.map((source) => {
            const Icon = sourceIcons[source.id];
            return (
              <div key={source.id}>
                <button
                  type="button"
                  className="xs-btn xs-btn--block"
                  style={{ minHeight: 44 }}
                  onClick={() => inputs.current[source.id]?.click()}
                >
                  <Icon size={18} aria-hidden="true" />
                  {source.label}
                </button>
                <input
                  ref={(input) => {
                    inputs.current[source.id] = input;
                  }}
                  type="file"
                  aria-label={`${source.label} photos`}
                  accept={source.accept}
                  capture={'capture' in source ? source.capture : undefined}
                  multiple={source.multiple}
                  hidden
                  onChange={selectFiles}
                />
              </div>
            );
          })}
        </div>
        <p className="text-sm text-muted-foreground">
          Available pickers depend on your device. Use Upload Doc for PDFs and other records.
        </p>
        <DialogFooter>
          <button type="button" className="xs-btn" style={{ minHeight: 44 }} onClick={() => onOpenChange(false)}>
            Cancel
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

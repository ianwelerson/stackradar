import { useEffect, useRef, type ReactNode } from 'react';

interface Props {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly labelledBy: string;
  readonly maxWidth: number;
  readonly children: ReactNode;
}

/**
 * Native <dialog> in modal mode: focus trapping, Escape-to-close, background
 * inerting and the top layer all come from the platform instead of being
 * approximated with a fixed-position div and a click-catcher.
 */
export function Modal({ open, onClose, labelledBy, maxWidth, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;

    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={labelledBy}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // Clicking the backdrop (the dialog element itself) closes; clicks on
        // the inner panel do not bubble to here as the target.
        if (event.target === ref.current) onClose();
      }}
      className="m-auto w-full bg-transparent p-4 backdrop:bg-scrim backdrop:backdrop-blur-[3px] open:animate-[sp-fade_.18s_ease_both]"
      style={{ maxWidth: `${maxWidth + 32}px` }}
    >
      <div className="bg-card border border-line-modal rounded-[14px] shadow-[0_24px_60px_oklch(0.08_0_0/0.6)] animate-[sp-in_.22s_ease_both] max-h-[86vh] flex flex-col overflow-hidden">
        {children}
      </div>
    </dialog>
  );
}

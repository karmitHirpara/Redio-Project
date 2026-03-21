import { Button } from './ui/button';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect } from 'react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const reduceMotion = useReducedMotion() ?? false;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onCancel]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[999] flex items-center justify-center bg-black/50 backdrop-blur-sm"
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={reduceMotion ? undefined : { opacity: 1 }}
          exit={reduceMotion ? undefined : { opacity: 0 }}
          transition={reduceMotion ? undefined : { duration: 0.16, ease: 'easeOut' }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onCancel();
          }}
        >
          <motion.div
            className="bg-background border border-border/60 rounded-xl shadow-2xl p-6 w-full max-w-sm"
            initial={reduceMotion ? false : { opacity: 0, scale: 0.98, y: 6 }}
            animate={reduceMotion ? undefined : { opacity: 1, scale: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, scale: 0.98, y: 6 }}
            transition={reduceMotion ? undefined : { duration: 0.18, ease: 'easeOut' }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="mb-6">
              <h2 className="text-base font-semibold mb-2 tracking-tight">{title}</h2>
              {description && (
                <p className="text-sm text-muted-foreground whitespace-pre-line leading-relaxed">
                  {description}
                </p>
              )}
            </div>
            <div className="flex justify-end gap-3 mt-4">
              <Button
                variant="outline"
                size="sm"
                onClick={onCancel}
                className="transition-all duration-200 hover:scale-105 active:scale-95"
              >
                {cancelLabel}
              </Button>
              <Button
                size="sm"
                onClick={onConfirm}
                className="transition-all duration-200 hover:scale-105 active:scale-95 px-6"
              >
                {confirmLabel}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}


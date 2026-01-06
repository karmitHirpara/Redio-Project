import { Button } from './ui/button';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

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

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={reduceMotion ? undefined : { opacity: 1 }}
          exit={reduceMotion ? undefined : { opacity: 0 }}
          transition={reduceMotion ? undefined : { duration: 0.16, ease: 'easeOut' }}
        >
          <motion.div
            className="bg-background border border-border rounded-md shadow-lg p-4 w-full max-w-sm"
            initial={reduceMotion ? false : { opacity: 0, scale: 0.98, y: 6 }}
            animate={reduceMotion ? undefined : { opacity: 1, scale: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, scale: 0.98, y: 6 }}
            transition={reduceMotion ? undefined : { duration: 0.18, ease: 'easeOut' }}
          >
            <div className="mb-3">
              <h2 className="text-sm font-semibold mb-1">{title}</h2>
              {description && (
                <p className="text-xs text-muted-foreground whitespace-pre-line">
                  {description}
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 mt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={onCancel}
              >
                {cancelLabel}
              </Button>
              <Button
                size="sm"
                onClick={onConfirm}
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

import { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Track } from '../types';
import { apiClient } from '../services/api';
import { toast } from 'sonner';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

interface RenameTrackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  track: Track | null;
  onTrackUpdated?: (track: Track) => void;
}

export function RenameTrackDialog({
  open,
  onOpenChange,
  track,
  onTrackUpdated,
}: RenameTrackDialogProps) {
  const [name, setName] = useState(track?.name || '');
  const [fileName, setFileName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const reduceMotion = useReducedMotion() ?? false;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onOpenChange(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open || !track) return;
    setName(track.name);
      // Extract just the filename without path and extension
      let filenameWithExt = track.filePath.split(/[/\\]/).pop() || '';
      let filenameNoExt = filenameWithExt.replace(/\.[^/.]+$/, "");
      setFileName(filenameNoExt);
      
      // Explicitly focus the input on open
      setTimeout(() => {
        document.getElementById('track-name')?.focus();
      }, 50);
  }, [open, track]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !fileName.trim() || !track) return;

    setIsSubmitting(true);
    try {
      const updatedTrack = await apiClient.json<Track>(`/tracks/${track.id}/rename`, {
        method: 'PUT',
        json: {
          name: name.trim(),
          fileName: fileName.trim(),
        },
      });

      toast.success('Track renamed successfully');
      if (onTrackUpdated) {
        onTrackUpdated(updatedTrack);
      }
      
      // Emit event so the rest of the app updates if needed
      window.dispatchEvent(new CustomEvent('redio:track-updated', { detail: updatedTrack }));
      
      onOpenChange(false);
    } catch (error: any) {
      console.error('Failed to rename track', error);
      toast.error(error.message || 'Failed to rename track');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => onOpenChange(false)}
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={reduceMotion ? undefined : { opacity: 1 }}
          exit={reduceMotion ? undefined : { opacity: 0 }}
          transition={reduceMotion ? undefined : { duration: 0.2, ease: 'easeOut' }}
        >
          <motion.div
            className="w-full max-w-lg rounded-xl border border-border/60 bg-background text-foreground shadow-2xl p-6"
            onClick={(e) => e.stopPropagation()}
            initial={reduceMotion ? false : { opacity: 0, scale: 0.96, y: 8 }}
            animate={reduceMotion ? undefined : { opacity: 1, scale: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, scale: 0.96, y: 8 }}
            transition={reduceMotion ? undefined : { duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          >
            <form onSubmit={handleSubmit}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-semibold tracking-tight text-foreground">
                  Rename Track
                </h3>
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="text-muted-foreground hover:text-foreground text-lg leading-none px-2"
                >
                  ×
                </button>
              </div>
              
              <p className="text-sm text-muted-foreground mb-6">
                This will irreversibly rename both the database record and the underlying physical file on your OS.
              </p>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="track-name" className="text-xs font-semibold text-muted-foreground">DATABASE TRACK NAME</Label>
                  <Input
                    id="track-name"
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Song Name"
                    required
                    className="bg-background text-foreground placeholder:text-muted-foreground border-input focus-visible:ring-primary/30 focus-visible:border-primary dark:bg-input/40 transition-all duration-200 focus:scale-[1.01]"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="file-name" className="text-xs font-semibold text-muted-foreground">PHYSICAL FILE NAME (WITHOUT EXTENSION)</Label>
                  <Input
                    id="file-name"
                    value={fileName}
                    onChange={(e) => setFileName(e.target.value)}
                    placeholder="File Name"
                    required
                    className="bg-background text-foreground placeholder:text-muted-foreground border-input focus-visible:ring-primary/30 focus-visible:border-primary dark:bg-input/40 transition-all duration-200 focus:scale-[1.01]"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1 px-1">
                    The original file extension will be preserved.
                  </p>
                </div>
              </div>
              
              <div className="flex justify-end gap-3 mt-8">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onOpenChange(false)}
                  disabled={isSubmitting}
                  className="transition-all duration-200 hover:scale-105 active:scale-95 px-6"
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  size="sm"
                  disabled={isSubmitting || !name.trim() || !fileName.trim()}
                  className="transition-all duration-200 hover:scale-105 active:scale-95 px-6"
                >
                  {isSubmitting ? 'Renaming...' : 'Rename File'}
                </Button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}


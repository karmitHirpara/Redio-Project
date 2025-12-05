import { useEffect, useState } from 'react';
import { Clock, AlertCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './ui/dialog';
import { Button } from './ui/button';
import { ScrollArea } from './ui/scroll-area';
import { cn } from './ui/utils';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from './ui/context-menu';
import { toast } from 'sonner';

interface HistoryEntry {
  id: string;
  track_id: string | null;
  played_at: string;
  position_start: number;
  position_end: number;
  completed: number | boolean;
  source: string;
  file_status: string;
  track_name?: string | null;
  track_artist?: string | null;
}

interface HistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function HistoryDialog({ open, onOpenChange }: HistoryDialogProps) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/history?limit=100');
        if (!res.ok) {
          throw new Error(`Failed to load history (${res.status})`);
        }
        const data: HistoryEntry[] = await res.json();
        if (!cancelled) {
          setEntries(data);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message || 'Failed to load history');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString();
  };

  const handleAction = async (entry: HistoryEntry, action: 'putBackToLibrary' | 'addToQueue' | 'delete') => {
    try {
      if (action === 'delete') {
        const res = await fetch(`/api/history/${entry.id}`, {
          method: 'DELETE',
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error || 'Failed to remove from history');
        }
        setEntries(prev => prev.filter(e => e.id !== entry.id));
        toast.success('Removed from history');
        return;
      }

      const res = await fetch(`/api/history/${entry.id}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: action === 'addToQueue' ? 'addToQueue' : 'putBackToLibrary' }),
      });

      const ok = res.ok;
      const data = await res.json().catch(() => null);
      if (!ok) {
        throw new Error(data?.error || 'Action failed');
      }

      if (action === 'addToQueue') {
        toast.success('Added back to queue');
      } else {
        toast.success(data?.message || 'Track is in library');
      }
    } catch (err: any) {
      toast.error(err.message || 'Action failed');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="w-4 h-4" />
            Playback History
          </DialogTitle>
          <DialogDescription>
            Recently played tracks with source and status.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 flex flex-col gap-3 text-sm">
          {error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-destructive text-xs">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {loading ? (
            <div className="py-8 text-center text-muted-foreground text-sm">
              Loading history...
            </div>
          ) : entries.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm">
              No playback history yet.
            </div>
          ) : (
            <ScrollArea className="max-h-80 mt-1">
              <div className="space-y-1 pr-2">
                {entries.map((entry) => {
                  const completed = Boolean(entry.completed);
                  const fileOk = entry.file_status === 'ok';
                  return (
                    <ContextMenu key={entry.id}>
                      <ContextMenuTrigger asChild>
                        <div className="flex items-start gap-3 rounded-md border border-border/60 bg-background/60 px-3 py-2 hover:bg-accent/40 cursor-default">
                          <div className="mt-1">
                            <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex justify-between gap-2">
                              <div className="truncate">
                                <div className="text-xs font-medium text-foreground truncate">
                                  {entry.track_name || 'Unknown track'}
                                </div>
                                <div className="text-[11px] text-muted-foreground truncate">
                                  {entry.track_artist || 'Unknown artist'}
                                </div>
                              </div>
                              <div className="text-[11px] text-muted-foreground whitespace-nowrap">
                                {formatTime(entry.played_at)}
                              </div>
                            </div>

                            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                              <span
                                className={cn(
                                  'px-1.5 py-0.5 rounded-full border border-border/70 bg-background/80',
                                )}
                              >
                                {entry.source}
                              </span>
                              <span
                                className={cn(
                                  'px-1.5 py-0.5 rounded-full border border-border/70 bg-background/80',
                                  completed
                                    ? 'text-emerald-500 border-emerald-500/40 bg-emerald-500/5'
                                    : 'text-amber-500 border-amber-500/40 bg-amber-500/5'
                                )}
                              >
                                {completed ? 'Completed' : 'Stopped early'}
                              </span>
                              <span
                                className={cn(
                                  'px-1.5 py-0.5 rounded-full border border-border/70 bg-background/80',
                                  fileOk
                                    ? 'text-emerald-500 border-emerald-500/40 bg-emerald-500/5'
                                    : 'text-destructive border-destructive/40 bg-destructive/5'
                                )}
                              >
                                File {entry.file_status}
                              </span>
                            </div>
                          </div>
                        </div>
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        <ContextMenuItem onClick={() => handleAction(entry, 'putBackToLibrary')}>
                          Put back into library
                        </ContextMenuItem>
                        <ContextMenuItem onClick={() => handleAction(entry, 'addToQueue')}>
                          Put back into queue
                        </ContextMenuItem>
                        <ContextMenuItem
                          onClick={() => handleAction(entry, 'delete')}
                          className="text-destructive"
                        >
                          Remove from history
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </div>

        <div className="mt-4 flex justify-end">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

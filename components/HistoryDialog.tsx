import { useEffect, useMemo, useState } from 'react';
import { Clock, AlertCircle, ChevronDown, ChevronRight, Download } from 'lucide-react';
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
import { motion, AnimatePresence } from 'framer-motion';

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

  const formatDateKey = (iso: string) => {
    const d = new Date(iso);
    return d.toISOString().slice(0, 10); // YYYY-MM-DD
  };

  const formatDateLabel = (dateKey: string) => {
    const [year, month, day] = dateKey.split('-').map(Number);
    const d = new Date(year, (month || 1) - 1, day || 1);
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const groupedByDate = useMemo(() => {
    const groups = new Map<string, HistoryEntry[]>();
    for (const entry of entries) {
      const key = formatDateKey(entry.played_at);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(entry);
    }
    // Sort dates descending (most recent first)
    return Array.from(groups.entries()).sort(([a], [b]) => (a < b ? 1 : -1));
  }, [entries]);

  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());

  useEffect(() => {
    // When entries load, auto-expand the most recent date for convenience
    if (groupedByDate.length > 0) {
      setExpandedDates(prev => {
        if (prev.size > 0) return prev;
        const next = new Set(prev);
        next.add(groupedByDate[0][0]);
        return next;
      });
    }
  }, [groupedByDate.length]);

  const toggleDate = (dateKey: string) => {
    setExpandedDates(prev => {
      const next = new Set(prev);
      if (next.has(dateKey)) {
        next.delete(dateKey);
      } else {
        next.add(dateKey);
      }
      return next;
    });
  };

  const downloadJson = (filename: string, payload: any) => {
    try {
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error('Failed to download history log', err);
      toast.error(err?.message || 'Failed to download history log');
    }
  };

  const downloadCsv = (filename: string, rows: HistoryEntry[]) => {
    try {
      const headers = ['No', 'Song Name', 'Starting Time', 'Ending Time'];

      const escape = (v: any) => {
        if (v === null || v === undefined) return '';
        const s = String(v).replace(/"/g, '""');
        return `"${s}` + `"`;
      };

      const formatDateTime = (iso: string, durationSeconds: number) => {
        const start = new Date(iso);
        const end = new Date(start.getTime() + Math.max(0, durationSeconds) * 1000);

        const toParts = (d: Date) => {
          const dd = String(d.getDate()).padStart(2, '0');
          const mm = String(d.getMonth() + 1).padStart(2, '0');
          const yyyy = d.getFullYear();
          const hh = String(d.getHours()).padStart(2, '0');
          const mi = String(d.getMinutes()).padStart(2, '0');
          const ss = String(d.getSeconds()).padStart(2, '0');
          // Note: time format requested with double colon between hour and minute
          const time = `${hh}::${mi}::${ss}`;
          const date = `${dd}/${mm}/${yyyy}`;
          return { date, time };
        };

        const s = toParts(start);
        const e = toParts(end);
        return {
          start: `${s.date} ${s.time}`,
          end: `${e.date} ${e.time}`,
        };
      };

      const csvLines = [
        headers.join(','),
        ...rows.map((r, index) => {
          const durationSeconds = (r.position_end ?? 0) - (r.position_start ?? 0);
          const times = formatDateTime(r.played_at, durationSeconds);
          const no = index + 1;
          const songName = r.track_name || 'Unknown track';
          return [no, songName, times.start, times.end].map(escape).join(',');
        }),
      ].join('\n');

      const blob = new Blob([csvLines], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error('Failed to download CSV history log', err);
      toast.error(err?.message || 'Failed to download CSV history log');
    }
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
      <DialogContent className="sm:max-w-3xl w-[96vw] max-w-3xl sm:p-6 p-4">
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
            <ScrollArea className="max-h-[26rem] mt-1">
              <div className="space-y-2 pr-1.5">
                {groupedByDate.map(([dateKey, dayEntries]) => {
                  const expanded = expandedDates.has(dateKey);
                  const label = formatDateLabel(dateKey);
                  const total = dayEntries.length;
                  return (
                    <div
                      key={dateKey}
                      className="rounded-lg border border-border/70 bg-background/60 overflow-hidden"
                    >
                      <div
                        role="button"
                        tabIndex={0}
                        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-3 py-2 text-xs hover:bg-accent/40 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent cursor-pointer"
                        onClick={() => toggleDate(dateKey)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            toggleDate(dateKey);
                          }
                        }}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {expanded ? (
                            <ChevronDown className="w-3 h-3 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="w-3 h-3 text-muted-foreground" />
                          )}
                          <span className="truncate font-medium text-foreground select-text">
                            {label}
                          </span>
                          <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                            {total} item{total === 1 ? '' : 's'}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 sm:self-auto self-start">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              const filename = `history-${dateKey}.xlsx`;
                              downloadCsv(filename, dayEntries);
                            }}
                            className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-background/80 px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent/60 hover:text-foreground transition-colors"
                          >
                            <Download className="w-3 h-3" />
                            <span>Excel</span>
                          </button>
                        </div>
                      </div>

                      <AnimatePresence initial={false}>
                        {expanded && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.16, ease: 'easeOut' }}
                            className="border-t border-border/60 bg-background/40"
                          >
                            <div className="py-1.5 space-y-1.5">
                              {/* Column header */}
                              <div className="px-3 pb-1 pt-0.5 text-[11px] text-muted-foreground border-b border-border/40 hidden sm:grid sm:grid-cols-[40px,minmax(0,2fr),minmax(0,1.4fr),minmax(0,1.4fr)] gap-2">
                                <span className="uppercase tracking-wide">No</span>
                                <span className="uppercase tracking-wide">Song</span>
                                <span className="uppercase tracking-wide">Start</span>
                                <span className="uppercase tracking-wide">End</span>
                              </div>

                              {dayEntries.map((entry, idx) => {
                                const durationSeconds = (entry.position_end ?? 0) - (entry.position_start ?? 0);
                                const start = new Date(entry.played_at);
                                const end = new Date(start.getTime() + Math.max(0, durationSeconds) * 1000);
                                const startTime = start.toLocaleTimeString(undefined, {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  second: '2-digit',
                                  hour12: true,
                                });
                                const endTime = end.toLocaleTimeString(undefined, {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  second: '2-digit',
                                  hour12: true,
                                });

                                return (
                                  <ContextMenu key={entry.id}>
                                    <ContextMenuTrigger asChild>
                                      <div className="px-3 py-1.5 hover:bg-accent/40 cursor-default">
                                        <div className="hidden sm:grid sm:grid-cols-[40px,minmax(0,2fr),minmax(0,1.4fr),minmax(0,1.4fr)] gap-2 items-center text-[12px]">
                                          <div className="flex items-center gap-1 text-muted-foreground">
                                            <Clock className="w-3.5 h-3.5" />
                                            <span className="tabular-nums">{idx + 1}</span>
                                          </div>
                                          <div className="truncate">
                                            <div className="text-xs font-medium text-foreground truncate select-text">
                                              {entry.track_name || 'Unknown track'}
                                            </div>
                                          </div>
                                          <div className="text-[11px] text-muted-foreground truncate select-text tabular-nums">
                                            {startTime}
                                          </div>
                                          <div className="text-[11px] text-muted-foreground truncate select-text tabular-nums">
                                            {endTime}
                                          </div>
                                        </div>

                                        {/* Mobile-friendly stacked layout */}
                                        <div className="sm:hidden flex items-start gap-3">
                                          <div className="mt-1">
                                            <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                                          </div>
                                          <div className="flex-1 min-w-0">
                                            <div className="text-xs font-medium text-foreground truncate select-text">
                                              {idx + 1}. {entry.track_name || 'Unknown track'}
                                            </div>
                                            <div className="mt-0.5 flex flex-col gap-0.5 text-[11px] text-muted-foreground">
                                              <span className="select-text">Start: {startTime}</span>
                                              <span className="select-text">End: {endTime}</span>
                                            </div>
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
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
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

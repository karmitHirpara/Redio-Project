import { useEffect, useMemo, useState } from 'react';
import { Clock, AlertCircle, ChevronDown, ChevronRight, Download, Trash, History, Music } from 'lucide-react';
import type { Cell, Row } from 'exceljs';
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
import { historyAPI } from '../services/api';

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

// Module-level persistence to survive dialog unmounts within the same app session
let persistentExpandedDates = new Set<string>();
let persistentScrollTop = 0;

export function HistoryDialog({ open, onOpenChange }: HistoryDialogProps) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  const istDateTimeFormatter = useMemo(() => {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const load = async (showSpinner: boolean) => {
      setError(null);
      try {
        if (!cancelled && showSpinner) setLoading(true);
        const data: HistoryEntry[] = await historyAPI.get(100);
        if (!cancelled) {
          setEntries(data);
          if (showSpinner && !hasLoadedOnce) {
            setHasLoadedOnce(true);
          }
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message || 'Failed to load history');
        }
      } finally {
        if (!cancelled && showSpinner) setLoading(false);
      }
    };

    // Initial load when dialog opens: show spinner only if we haven't loaded before
    load(!hasLoadedOnce);
    // Poll periodically while open so history stays in sync as songs play, without spinner
    const intervalId = window.setInterval(() => load(false), 5000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [open, hasLoadedOnce]);

  useEffect(() => {
    if (hasLoadedOnce) return;
    let cancelled = false;
    const prefetch = async () => {
      try {
        const data: HistoryEntry[] = await historyAPI.get(100);
        if (!cancelled) {
          setEntries(data);
          setHasLoadedOnce(true);
        }
      } catch {
        // ignore background prefetch errors
      }
    };

    const idle = (window as any).requestIdleCallback as
      | ((cb: () => void, opts?: { timeout: number }) => number)
      | undefined;
    const cancelIdle = (window as any).cancelIdleCallback as ((id: number) => void) | undefined;

    if (idle) {
      const id = idle(() => void prefetch(), { timeout: 1500 });
      return () => {
        cancelled = true;
        if (cancelIdle) cancelIdle(id);
      };
    }

    const id = window.setTimeout(() => void prefetch(), 350);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [hasLoadedOnce]);

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return istDateTimeFormatter.format(d);
  };

  const formatDateKey = (iso: string) => {
    const d = new Date(iso);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    // YYYY-MM-DD in the user's local calendar, so "today" groups correctly
    return `${year}-${month}-${day}`;
  };

  const formatDateLabel = (dateKey: string) => {
    const [year, month, day] = dateKey.split('-').map(Number);
    const d = new Date(year, (month || 1) - 1, day || 1);

    // Safari style: "Today", "Yesterday", or "October 12, 2023"
    const today = new Date();
    const isToday = d.getDate() === today.getDate() &&
      d.getMonth() === today.getMonth() &&
      d.getFullYear() === today.getFullYear();

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = d.getDate() === yesterday.getDate() &&
      d.getMonth() === yesterday.getMonth() &&
      d.getFullYear() === yesterday.getFullYear();

    if (isToday) return 'Today';
    if (isYesterday) return 'Yesterday';

    return d.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const groupedByDate = useMemo(() => {
    const groups = new Map<string, HistoryEntry[]>();
    for (const entry of entries) {
      const key = formatDateKey(entry.played_at);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(entry);
    }
    // Sort entries within each day: Descending (Newest first)
    for (const [, dayEntries] of groups) {
      dayEntries.sort((a, b) => new Date(b.played_at).getTime() - new Date(a.played_at).getTime());
    }
    // Sort dates Descending (Newest day first) - "Today" at the top
    return Array.from(groups.entries()).sort(([a], [b]) => (a < b ? 1 : -1));
  }, [entries]);

  const [expandedDates, setExpandedDates] = useState<Set<string>>(persistentExpandedDates);

  // Synchronize local state to persistent variable
  useEffect(() => {
    persistentExpandedDates = expandedDates;
  }, [expandedDates]);

  // Restore and save scroll position
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    persistentScrollTop = e.currentTarget.scrollTop;
  };

  useEffect(() => {
    if (open) {
      // Small delay to ensure content is rendered before scrolling
      const timer = setTimeout(() => {
        const viewport = document.querySelector('[data-history-viewport]');
        if (viewport) viewport.scrollTop = persistentScrollTop;
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [open]);

  useEffect(() => {
    // When entries load, auto-expand the most recent date for convenience
    if (groupedByDate.length > 0 && expandedDates.size === 0) {
      setExpandedDates(new Set([groupedByDate[0][0]]));
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

  const downloadXlsx = async (filename: string, rows: HistoryEntry[]) => {
    try {
      const ExcelJSImport = await import('exceljs');
      const ExcelJS: any = (ExcelJSImport as any).default ?? ExcelJSImport;
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Redio';
      workbook.created = new Date();

      const sheet = workbook.addWorksheet('Playback History', {
        views: [{ state: 'frozen', ySplit: 1 }],
      });

      sheet.columns = [
        { header: 'No.', key: 'no', width: 6 },
        { header: 'Program Files', key: 'programFile', width: 44 },
        { header: 'Start Time', key: 'startTime', width: 18 },
        { header: 'End Time', key: 'endTime', width: 18 },
        { header: 'Status', key: 'status', width: 15 },
      ];

      const headerRow = sheet.getRow(1);
      headerRow.height = 20;
      headerRow.eachCell((cell: Cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF4F46E5' },
        };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        };
      });

      const formatTimeOnly = (d: Date) =>
        d.toLocaleTimeString('en-IN', {
          timeZone: 'Asia/Kolkata',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        });

      // Sort specifically for Excel: Oldest -> Newest
      const sortedRows = [...rows].sort((a, b) => new Date(a.played_at).getTime() - new Date(b.played_at).getTime());

      sortedRows.forEach((r, index) => {
        const durationSeconds = (r.position_end ?? 0) - (r.position_start ?? 0);
        const start = new Date(r.played_at);
        const end = new Date(start.getTime() + Math.max(0, durationSeconds) * 1000);

        const row = sheet.addRow({
          no: index + 1,
          programFile: r.track_name || 'Unknown track',
          startTime: formatTimeOnly(start),
          endTime: formatTimeOnly(end),
          status: r.completed ? 'Completed' : 'Skipped',
        });
        row.height = 18;
      });

      // Styling: borders + alignment for all data rows
      sheet.eachRow((row: Row, rowNumber: number) => {
        if (rowNumber === 1) return;
        row.eachCell((cell: Cell, colNumber: number) => {
          cell.font = { name: 'Calibri', size: 11 };
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          };
          cell.alignment = {
            vertical: 'middle',
            horizontal: colNumber === 1 ? 'center' : colNumber === 2 ? 'left' : 'center',
            wrapText: colNumber === 2,
          };

          if (rowNumber % 2 === 0) {
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFF8FAFC' },
            };
          }
        });
      });

      // Auto filter across all columns
      sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: Math.max(1, sheet.rowCount), column: 5 },
      };

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
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
      console.error('Failed to download XLSX history log', err);
      toast.error(err?.message || 'Failed to download XLSX history log');
    }
  };

  const handleAction = async (entry: HistoryEntry, action: 'putBackToLibrary' | 'addToQueue' | 'delete') => {
    try {
      if (action === 'delete') {
        await historyAPI.delete(entry.id);
        setEntries(prev => prev.filter(e => e.id !== entry.id));
        toast.success('Removed from history');
        return;
      }

      const data = await historyAPI.action(entry.id, action === 'addToQueue' ? 'addToQueue' : 'putBackToLibrary');

      if (action === 'addToQueue') {
        toast.success('Added back to queue');
      } else {
        toast.success(data?.message || 'Track is in library');
      }
    } catch (err: any) {
      toast.error(err.message || 'Action failed');
    }
  };

  // Calculate stats for the header
  const totalEntries = entries.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl w-[95vw] gap-0 p-0 overflow-hidden bg-background border-border shadow-xl rounded-lg">
        <DialogHeader className="px-5 py-3.5 border-b border-border bg-muted/40 flex flex-row items-center justify-between space-y-0">
          <div className="flex flex-col">
            <DialogTitle className="flex items-center gap-2 text-base font-semibold tracking-tight text-foreground">
              <History className="w-4 h-4 text-primary" />
              History
            </DialogTitle>
          </div>
          <div className="flex items-center gap-2 px-6">
            <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full border border-border">
              {totalEntries} tracks
            </span>
            
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-hidden bg-background">
          {error && (
            <div className="m-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-400">
              <AlertCircle className="w-4 h-4" />
              <span>{error}</span>
            </div>
          )}

          {loading && entries.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground animate-pulse">
              Loading your history...
            </div>
          ) : entries.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No playback history found.
            </div>
          ) : (
            <ScrollArea
              className="h-[60vh]"
              viewportProps={{
                onScroll: handleScroll,
                'data-history-viewport': ''
              } as any}
            >
              <div className="flex flex-col pb-10">
                {groupedByDate.map(([dateKey, dayEntries]) => {
                  const expanded = expandedDates.has(dateKey);
                  const label = formatDateLabel(dateKey);

                  return (
                    <div key={dateKey} className="group">
                      <div
                        className="sticky top-0 z-10 flex items-center justify-between px-4 py-2 bg-muted/90 backdrop-blur-sm border-b border-border/60 text-xs font-medium text-muted-foreground cursor-pointer hover:bg-muted transition-colors"
                        onClick={() => toggleDate(dateKey)}
                      >
                        <div className="flex items-center gap-2">
                          <span className={cn("transition-transform duration-200 text-muted-foreground/60", expanded ? "rotate-90" : "")}>
                            <ChevronRight className="w-3.5 h-3.5" />
                          </span>
                          <span className="font-semibold text-foreground uppercase tracking-wide text-[11px]">{label}</span>
                        </div>

                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-5 gap-1.5 px-2 text-[10px] text-muted-foreground/70 hover:text-primary hover:bg-primary/5"
                          onClick={(e) => {
                            e.stopPropagation();
                            void downloadXlsx(`History ${label}.xlsx`, dayEntries);
                          }}
                        >
                          <Download className="w-3 h-3" />
                          <span className="">Download Excel</span>
                        </Button>
                      </div>

                      <AnimatePresence initial={false}>
                        {expanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2, ease: "easeInOut" }}
                            className="overflow-hidden"
                          >
                            <div className="divide-y divide-border/40">
                              {dayEntries.map((entry) => {
                                const start = new Date(entry.played_at);
                                const startTime = start.toLocaleTimeString('en-IN', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  hour12: true
                                });

                                const durationSeconds = (entry.position_end ?? 0) - (entry.position_start ?? 0);
                                const endTime = durationSeconds > 0
                                  ? new Date(start.getTime() + Math.max(0, durationSeconds) * 1000).toLocaleTimeString(
                                    'en-IN',
                                    {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                      hour12: true,
                                    },
                                  )
                                  : '-';

                                return (
                                  <ContextMenu key={entry.id}>
                                    <ContextMenuTrigger>
                                      <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent/40 dark:hover:bg-accent/20 transition-colors text-sm group/item">
                                        <div className="flex-1 min-w-0">
                                          <div className="font-medium text-foreground truncate text-[13px] leading-tight group-hover/item:text-primary transition-colors">
                                            {entry.track_name || 'Unknown Track'}
                                          </div>
                                          <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                                            {entry.track_artist || 'Unknown Artist'}
                                          </div>
                                        </div>

                                        <div className="flex flex-col items-end gap-0.5 text-[10px] font-mono text-muted-foreground/60 min-w-[5.5rem]">
                                          <span className="flex items-center justify-end gap-1.5 w-full" title="Start Time">
                                            <span>{startTime}</span>
                                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500/70" />
                                          </span>
                                          <span className="flex items-center justify-end gap-1.5 w-full opacity-70" title="End Time">
                                            <span>{endTime}</span>
                                            <div className="w-1.5 h-1.5 rounded-full bg-rose-500/70" />
                                          </span>
                                        </div>
                                      </div>
                                    </ContextMenuTrigger>
                                    <ContextMenuContent>
                                      <ContextMenuItem onClick={() => handleAction(entry, 'addToQueue')} className="gap-2">
                                        <History className="w-4 h-4" />
                                        Play Again
                                      </ContextMenuItem>
                                      <ContextMenuItem onClick={() => handleAction(entry, 'putBackToLibrary')} className="gap-2">
                                        <Music className="w-4 h-4" />
                                        Show in Library
                                      </ContextMenuItem>
                                      <ContextMenuItem
                                        onClick={() => handleAction(entry, 'delete')}
                                        className="text-destructive focus:text-destructive gap-2"
                                      >
                                        <Trash className="w-4 h-4" />
                                        Remove
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

        <div className="p-3 bg-muted/30 border-t border-border flex justify-end">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} className="h-7 text-xs">
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

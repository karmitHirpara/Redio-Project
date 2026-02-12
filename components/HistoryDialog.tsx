import { useEffect, useMemo, useState } from 'react';
import { Clock, AlertCircle, ChevronDown, ChevronRight, Download, Trash } from 'lucide-react';
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
    for (const [, dayEntries] of groups) {
      dayEntries.sort((a, b) => new Date(a.played_at).getTime() - new Date(b.played_at).getTime());
    }
    // Sort dates ascending (oldest first)
    return Array.from(groups.entries()).sort(([a], [b]) => (a > b ? 1 : -1));
  }, [entries]);

  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());

  useEffect(() => {
    // When entries load, auto-expand the most recent date for convenience
    if (groupedByDate.length > 0) {
      setExpandedDates(prev => {
        if (prev.size > 0) return prev;
        const next = new Set(prev);
        next.add(groupedByDate[groupedByDate.length - 1][0]);
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
        { header: 'Programs File', key: 'programFile', width: 44 },
        { header: 'Start Time', key: 'startTime', width: 18 },
        { header: 'End Time', key: 'endTime', width: 18 },
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

      rows.forEach((r, index) => {
        const durationSeconds = (r.position_end ?? 0) - (r.position_start ?? 0);
        const start = new Date(r.played_at);
        const end = new Date(start.getTime() + Math.max(0, durationSeconds) * 1000);

        const row = sheet.addRow({
          no: index + 1,
          programFile: r.track_name || 'Unknown track',
          startTime: formatTimeOnly(start),
          endTime: formatTimeOnly(end),
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
        to: { row: Math.max(1, sheet.rowCount), column: 4 },
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

  const clearAllHistory = async () => {
    if (!window.confirm('Are you sure you want to clear all playback history? This action cannot be undone.')) {
      return;
    }

    try {
      await historyAPI.clearAll();
      setEntries([]);
      toast.success('All history cleared');
    } catch (err: any) {
      toast.error(err.message || 'Failed to clear history');
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
                              void downloadXlsx(filename, dayEntries);
                            }}
                            className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-background/80 px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent/60 hover:text-foreground transition-colors"
                          >
                            <Download className="w-3 h-3" />
                            <span>Download</span>
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
                                const startTime = start.toLocaleTimeString('en-IN', {
                                  timeZone: 'Asia/Kolkata',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  second: '2-digit',
                                  hour12: true,
                                });

                                // Only show '-' while a track is still in progress (no finalized duration yet).
                                // Interrupted tracks should still show an end time once position_end is updated.
                                const endTime = durationSeconds > 0
                                  ? new Date(start.getTime() + Math.max(0, durationSeconds) * 1000).toLocaleTimeString(
                                      'en-IN',
                                      {
                                        timeZone: 'Asia/Kolkata',
                                        hour: '2-digit',
                                        minute: '2-digit',
                                        second: '2-digit',
                                        hour12: true,
                                      },
                                    )
                                  : '-';

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

        <div className="mt-4 flex justify-between items-center">
          <Button
            variant="destructive"
            size="sm"
            onClick={clearAllHistory}
            disabled={entries.length === 0}
            className="flex items-center gap-2"
          >
            <Trash className="w-4 h-4" />
            Clear History
          </Button>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

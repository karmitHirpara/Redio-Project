import { useMemo, useState, useEffect } from 'react';
import { Calendar, Clock, Lock, Music, Info, History } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';
import { Label } from './ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { Input } from './ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { QueueItem } from '../types';
import { cn } from './ui/utils';

interface SchedulePlaylistDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  playlistName: string;
  queue: QueueItem[];
  onSchedule: (config: ScheduleConfig) => void;
  existingSchedule?: {
    type: 'datetime' | 'song-trigger' | string;
    dateTime?: Date;
  } | null;
}

export interface ScheduleConfig {
  mode: 'datetime' | 'song-trigger';
  dateTime?: Date;
  queueSongId?: string;
  triggerPosition?: 'before' | 'after';
  lockPlaylist?: boolean;
}

export function SchedulePlaylistDialog({
  open,
  onOpenChange,
  playlistName,
  queue,
  onSchedule,
  existingSchedule = null,
}: SchedulePlaylistDialogProps) {
  const [mode, setMode] = useState<'datetime' | 'song-trigger'>('datetime');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [selectedSongId, setSelectedSongId] = useState('');
  const [triggerPosition, setTriggerPosition] = useState<'before' | 'after'>('after');
  const [lockPlaylist, setLockPlaylist] = useState(false);
  const reduceMotion = useReducedMotion() ?? false;

  const selectedSong = useMemo(() => {
    if (!selectedSongId) return null;
    return queue.find((q) => q.id === selectedSongId) ?? null;
  }, [queue, selectedSongId]);

  const getIstParts = (dt: Date) => {
    const parts = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(dt);

    const lookup: Record<string, string> = {};
    parts.forEach((p) => {
      if (p.type !== 'literal') lookup[p.type] = p.value;
    });

    return {
      yyyy: lookup.year,
      mm: lookup.month,
      dd: lookup.day,
      hh: lookup.hour,
      mi: lookup.minute,
      ss: lookup.second,
    };
  };

  const istDateFromInputs = (dateStr: string, timeStr: string) => {
    const d = String(dateStr || '').split('-');
    const t = String(timeStr || '').split(':');
    if (d.length !== 3 || t.length < 2) return null;

    const year = Number(d[0]);
    const month = Number(d[1]);
    const day = Number(d[2]);
    const hour = Number(t[0]);
    const minute = Number(t[1]);
    const second = t.length >= 3 ? Number(t[2]) : 0;

    if (
      !Number.isFinite(year) ||
      !Number.isFinite(month) ||
      !Number.isFinite(day) ||
      !Number.isFinite(hour) ||
      !Number.isFinite(minute) ||
      !Number.isFinite(second)
    ) {
      return null;
    }

    const utcMs = Date.UTC(year, month - 1, day, hour, minute, second) - 330 * 60 * 1000;
    const dt = new Date(utcMs);
    return Number.isNaN(dt.getTime()) ? null : dt;
  };

  const computedDateTime = useMemo(() => {
    if (!date || !time) return null;
    const normalizedTime = time.length === 5 ? `${time}:00` : time;
    return istDateFromInputs(date, normalizedTime);
  }, [date, time]);

  const isDateTimeInPast = useMemo(() => {
    if (!computedDateTime) return false;
    return computedDateTime.getTime() < Date.now() - 1000;
  }, [computedDateTime]);

  const scheduleSummary = useMemo(() => {
    if (mode === 'datetime') {
      if (!computedDateTime) return 'Pick a date and time for automation.';
      return `Will start on ${computedDateTime.toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        weekday: 'short',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      })} (IST)`;
    }

    if (!selectedSong) return 'Select a queue song to use as a trigger point.';

    const position = triggerPosition === 'after' ? 'after' : 'before';
    return `Will start ${position} “${selectedSong.track.name}”. Queue will resume after the playlist completes.`;
  }, [computedDateTime, mode, selectedSong, triggerPosition]);

  const setDateTimeFrom = (dt: Date) => {
    const { yyyy, mm, dd, hh, mi, ss } = getIstParts(dt);
    if (!yyyy || !mm || !dd || !hh || !mi || !ss) return;
    setDate(`${yyyy}-${mm}-${dd}`);
    setTime(`${hh}:${mi}:${ss}`);
  };

  const addMinutes = (mins: number) => {
    const base = computedDateTime ?? new Date();
    setDateTimeFrom(new Date(base.getTime() + mins * 60 * 1000));
  };

  useEffect(() => {
    if (!open) {
      setMode('datetime');
      setDate('');
      setTime('');
      setSelectedSongId('');
      setTriggerPosition('after');
      setLockPlaylist(false);
      return;
    }

    if (open) {
      const base = new Date(Date.now() + 5 * 60 * 1000);
      setDateTimeFrom(base);
    }
  }, [open]);

  const handleSchedule = () => {
    if (existingSchedule) return;
    if (mode === 'datetime') {
      if (!computedDateTime) return;
      if (isDateTimeInPast) return;
      onSchedule({ mode: 'datetime', dateTime: computedDateTime, lockPlaylist });
    } else {
      if (!selectedSongId) return;
      onSchedule({
        mode: 'song-trigger',
        queueSongId: selectedSongId,
        triggerPosition,
        lockPlaylist,
      });
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[540px] border-none shadow-2xl bg-slate-950 text-white p-0 overflow-hidden">
        <DialogHeader className="p-6 pb-0">
          <DialogTitle className="text-xl font-bold flex items-center gap-2 text-white">
            <History className="w-5 h-5 text-sky-400" />
            Schedule Playlist
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Set up precise automation for <span className="text-sky-300 font-medium">"{playlistName}"</span>
          </DialogDescription>
        </DialogHeader>

        <div className="p-6 space-y-6">
          {existingSchedule && (
            <motion.div
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-sm"
            >
              <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div className="leading-snug">
                <div className="font-semibold">This playlist is already scheduled.</div>
                {existingSchedule.type === 'datetime' && existingSchedule.dateTime ? (
                  <div className="text-[12px] text-amber-200/80 mt-0.5">
                    Scheduled for {existingSchedule.dateTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} (IST)
                  </div>
                ) : (
                  <div className="text-[12px] text-amber-200/80 mt-0.5">
                    Cancel the schedule or wait for it to trigger before scheduling again.
                  </div>
                )}
              </div>
            </motion.div>
          )}

          <Tabs value={mode} onValueChange={(v) => setMode(v as any)} className="w-full">
            <TabsList className="grid w-full grid-cols-2 bg-slate-900 border border-slate-800">
              <TabsTrigger value="datetime" className="data-[state=active]:bg-sky-600 data-[state=active]:text-white gap-2">
                <Calendar className="w-4 h-4" />
                Time-Based
              </TabsTrigger>
              <TabsTrigger value="song-trigger" className="data-[state=active]:bg-sky-600 data-[state=active]:text-white gap-2">
                <Music className="w-4 h-4" />
                Song-Triggered
              </TabsTrigger>
            </TabsList>

            <div className="mt-6">
              <TabsContent value="datetime" className="space-y-6 mt-0">
                <div className="flex flex-wrap gap-2">
                  {[
                    { label: 'Now', action: () => setDateTimeFrom(new Date()) },
                    { label: 'Tomorrow', action: () => { const d = new Date(); d.setDate(d.getDate() + 1); setDateTimeFrom(d); } },
                    { label: '+15m', action: () => addMinutes(15) },
                    { label: '+1h', action: () => addMinutes(60) },
                    { label: '+4h', action: () => addMinutes(240) },
                  ].map((btn) => (
                    <Button
                      key={btn.label}
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 px-3 text-xs bg-slate-900 border-slate-800 hover:bg-slate-800 text-slate-300 transition-all duration-200"
                      onClick={btn.action}
                    >
                      {btn.label}
                    </Button>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Date</Label>
                    <Input
                      type="date"
                      className="bg-slate-900 border-slate-800 text-white focus-visible:ring-sky-500 h-11 text-base font-medium"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Time</Label>
                    <Input
                      type="time"
                      step={1}
                      className="bg-slate-900 border-slate-800 text-white focus-visible:ring-sky-500 h-11 text-base font-medium"
                      value={time}
                      onChange={(e) => setTime(e.target.value)}
                    />
                  </div>
                </div>

                {isDateTimeInPast && (
                  <motion.div
                    initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }}
                    className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm"
                  >
                    <Info className="w-4 h-4 flex-shrink-0" />
                    <span>Warning: Selected time has already passed.</span>
                  </motion.div>
                )}
              </TabsContent>

              <TabsContent value="song-trigger" className="space-y-6 mt-0">
                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Trigger Track</Label>
                  <Select value={selectedSongId} onValueChange={setSelectedSongId}>
                    <SelectTrigger className="bg-slate-900 border-slate-800 h-11 text-white focus:ring-sky-500">
                      <SelectValue placeholder="Select a song from the queue..." />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-900 border-slate-800 text-white">
                      {queue.length === 0 ? (
                        <div className="p-3 text-center text-slate-500 text-sm italic">Queue is currently empty</div>
                      ) : (
                        queue.map((item, idx) => (
                          <SelectItem key={item.id} value={item.id} className="focus:bg-sky-600 focus:text-white">
                            <span className="opacity-50 mr-2 tabular-nums">{idx + 1}.</span>
                            {item.track.name}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-3">
                  <Label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Positioning</Label>
                  <div className="grid grid-cols-2 gap-3">
                    <Button
                      variant="outline"
                      className={cn(
                        "h-14 border-slate-800 bg-slate-900 text-sm justify-start px-4 gap-3 transition-all",
                        triggerPosition === 'before' ? "border-sky-500 bg-sky-500/10 text-sky-400 ring-1 ring-sky-500" : "hover:bg-slate-800"
                      )}
                      onClick={() => setTriggerPosition('before')}
                    >
                      <div className={cn("w-4 h-4 rounded-full border-2 flex items-center justify-center", triggerPosition === 'before' ? "border-sky-500 bg-sky-500" : "border-slate-600")}>
                        {triggerPosition === 'before' && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                      </div>
                      <div className="text-left">
                        <div className="font-semibold">Before</div>
                        <div className="text-[11px] opacity-70">Pre-empt selection</div>
                      </div>
                    </Button>
                    <Button
                      variant="outline"
                      className={cn(
                        "h-14 border-slate-800 bg-slate-900 text-sm justify-start px-4 gap-3 transition-all",
                        triggerPosition === 'after' ? "border-sky-500 bg-sky-500/10 text-sky-400 ring-1 ring-sky-500" : "hover:bg-slate-800"
                      )}
                      onClick={() => setTriggerPosition('after')}
                    >
                      <div className={cn("w-4 h-4 rounded-full border-2 flex items-center justify-center", triggerPosition === 'after' ? "border-sky-500 bg-sky-500" : "border-slate-600")}>
                        {triggerPosition === 'after' && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                      </div>
                      <div className="text-left">
                        <div className="font-semibold">After</div>
                        <div className="text-[11px] opacity-70">Follow selection</div>
                      </div>
                    </Button>
                  </div>
                </div>
              </TabsContent>
            </div>
          </Tabs>

          <div className="p-4 rounded-xl bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800/50 shadow-inner">
            <div className="flex items-center gap-2 mb-2">
              <div className="px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-400 text-[10px] font-bold uppercase tracking-tighter">Plan</div>
            </div>
            <div className="text-sm font-medium leading-relaxed text-slate-200">
              {scheduleSummary}
            </div>
          </div>
        </div>

        <DialogFooter className="p-6 bg-slate-900/50 border-t border-slate-800/50">
          <div className="flex w-full items-center justify-between">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setLockPlaylist(!lockPlaylist)}
              className={cn(
                "h-10 w-10 rounded-full transition-all",
                lockPlaylist ? "bg-amber-500/10 text-amber-500 hover:bg-amber-500/20" : "text-slate-500 hover:bg-slate-800"
              )}
              title={lockPlaylist ? "Auto-lock enabled" : "Enable auto-lock for this playlist"}
            >
              <Lock className={cn("w-5 h-5", lockPlaylist ? "fill-current" : "")} />
            </Button>

            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                className="text-slate-400 hover:text-white hover:bg-slate-800"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                className="bg-sky-600 hover:bg-sky-500 text-white px-6 font-bold shadow-lg shadow-sky-900/40"
                onClick={handleSchedule}
                disabled={
                  Boolean(existingSchedule) ||
                  (mode === 'datetime' && (!date || !time || !computedDateTime || isDateTimeInPast)) ||
                  (mode === 'song-trigger' && !selectedSongId)
                }
              >
                Schedule Now
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

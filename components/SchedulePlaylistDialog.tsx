import { useMemo, useState, useEffect } from 'react';
import { Calendar, Clock, Lock, Music } from 'lucide-react';
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
import { RadioGroup, RadioGroupItem } from './ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { Input } from './ui/input';
import { QueueItem } from '../types';

interface SchedulePlaylistDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  playlistName: string;
  queue: QueueItem[];
  onSchedule: (config: ScheduleConfig) => void;
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
  onSchedule
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
      if (!computedDateTime) return 'Pick a date and time.';
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

    if (!selectedSong) return 'Select a queue song to use as a trigger.';

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

  // Reset form state whenever the dialog is closed so it reopens cleanly
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

    // When opening: set a sensible default for Date & Time.
    // (now + 5 minutes) so the user can schedule quickly without typing.
    if (open) {
      const base = new Date(Date.now() + 5 * 60 * 1000);
      setDateTimeFrom(base);
    }
  }, [open]);

  const handleSchedule = () => {
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
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Schedule Playlist</DialogTitle>
          <DialogDescription>
            Configure when "{playlistName}" should automatically play
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Scheduling Mode Selection */}
          <div className="space-y-3">
            <Label>Scheduling Method</Label>
            <RadioGroup value={mode} onValueChange={(value) => setMode(value as 'datetime' | 'song-trigger')}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="datetime" id="datetime" />
                <Label htmlFor="datetime" className="flex items-center gap-2 cursor-pointer">
                  <Calendar className="w-4 h-4" />
                  Date & Time
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="song-trigger" id="song-trigger" />
                <Label htmlFor="song-trigger" className="flex items-center gap-2 cursor-pointer">
                  <Music className="w-4 h-4" />
                  Song Trigger
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* Mode Content */}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={mode}
              initial={reduceMotion ? false : { opacity: 0, height: 0 }}
              animate={reduceMotion ? undefined : { opacity: 1, height: 'auto' }}
              exit={reduceMotion ? undefined : { opacity: 0, height: 0 }}
              transition={
                reduceMotion
                  ? undefined
                  : {
                      type: 'spring',
                      stiffness: 320,
                      damping: 30,
                      mass: 0.9,
                    }
              }
              className="overflow-hidden"
            >
              <div className="space-y-4">
                {mode === 'datetime' ? (
                  <>
                    <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-[11px]"
                    onClick={() => setDateTimeFrom(new Date())}
                  >
                    Today
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-[11px]"
                    onClick={() => {
                      const d = new Date();
                      d.setDate(d.getDate() + 1);
                      setDateTimeFrom(d);
                    }}
                  >
                    Tomorrow
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-[11px]"
                    onClick={() => addMinutes(15)}
                  >
                    +15m
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-[11px]"
                    onClick={() => addMinutes(30)}
                  >
                    +30m
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-[11px]"
                    onClick={() => addMinutes(60)}
                  >
                    +1h
                  </Button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="date">Date</Label>
                    <Input
                      id="date"
                      type="date"
                      className="schedule-datetime-input font-semibold text-base"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="time">Time</Label>
                    <Input
                      id="time"
                      type="time"
                      value={time}
                      step={1}
                      className="schedule-datetime-input font-semibold text-base"
                      onChange={(e) => setTime(e.target.value)}
                    />
                  </div>
                </div>

                {isDateTimeInPast && (
                  <div className="text-[12px] text-destructive">
                    Selected time is in the past. Please choose a future time.
                  </div>
                )}
                  </>
                ) : (
                  <>
                    <div className="space-y-2">
                      <Label>Select Song in Queue</Label>
                      <Select value={selectedSongId} onValueChange={setSelectedSongId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Choose a queue song..." />
                        </SelectTrigger>
                        <SelectContent>
                          {queue.length === 0 ? (
                            <div className="p-2 text-sm text-muted-foreground">
                              No songs in queue
                            </div>
                          ) : (
                            queue.map((item, index) => (
                              <SelectItem key={item.id} value={item.id}>
                                {index + 1}. {item.track.name} - {item.track.artist}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Trigger Position</Label>
                      <RadioGroup
                        value={triggerPosition}
                        onValueChange={(value) => setTriggerPosition(value as 'before' | 'after')}
                      >
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="after" id="after" />
                          <Label htmlFor="after" className="cursor-pointer">
                            After selected song finishes
                          </Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="before" id="before" />
                          <Label htmlFor="before" className="cursor-pointer">
                            Before selected song plays
                          </Label>
                        </div>
                      </RadioGroup>
                    </div>

                    {selectedSongId && (
                      <div className="p-3 bg-accent/20 rounded-md text-sm text-muted-foreground">
                        {triggerPosition === 'after'
                          ? `Playlist will start automatically after the selected song finishes playing.`
                          : `Playlist will start automatically before the selected song begins.`}
                        {' '}Queue will resume after the playlist completes.
                      </div>
                    )}
                  </>
                )}
              </div>
            </motion.div>
          </AnimatePresence>

          <div className="rounded-md border border-border/60 bg-accent/10 px-3 py-2">
            <div className="text-[11px] text-muted-foreground">Summary</div>
            <div className="text-sm text-foreground mt-0.5">{scheduleSummary}</div>
          </div>
        </div>

        <DialogFooter className="w-full">
          <div className="flex w-full items-center justify-between gap-3">
            <Button
              type="button"
              variant={lockPlaylist ? 'secondary' : 'ghost'}
              size="icon"
              onClick={() => setLockPlaylist((v) => !v)}
              aria-pressed={lockPlaylist}
              title={lockPlaylist ? 'Auto-lock enabled' : 'Enable auto-lock'}
              className="h-9 w-9"
            >
              <Lock className={lockPlaylist ? 'h-4 w-4 text-foreground' : 'h-4 w-4 text-muted-foreground'} />
            </Button>

            <div className="flex items-center gap-3">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleSchedule}
                disabled={
                  (mode === 'datetime' && (!date || !time || !computedDateTime || isDateTimeInPast)) ||
                  (mode === 'song-trigger' && !selectedSongId)
                }
              >
                Schedule Playlist
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

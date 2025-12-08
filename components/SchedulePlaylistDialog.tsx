import { useState, useEffect } from 'react';
import { Calendar, Clock, Music } from 'lucide-react';
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

  // Reset form state whenever the dialog is closed so it reopens cleanly
  useEffect(() => {
    if (!open) {
      setMode('datetime');
      setDate('');
      setTime('');
      setSelectedSongId('');
      setTriggerPosition('after');
    }
  }, [open]);

  const handleSchedule = () => {
    if (mode === 'datetime') {
      if (!date || !time) return;
      const dateTime = new Date(`${date}T${time}`);
      onSchedule({ mode: 'datetime', dateTime });
    } else {
      if (!selectedSongId) return;
      onSchedule({
        mode: 'song-trigger',
        queueSongId: selectedSongId,
        triggerPosition
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

          {/* Date & Time Mode */}
          {mode === 'datetime' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="date">Date</Label>
                <Input
                  id="date"
                  type="date"
                  className="text-foreground"
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
                  className="text-foreground"
                  onChange={(e) => setTime(e.target.value)}
                />
              </div>
            </div>
          )}

          {/* Song Trigger Mode */}
          {mode === 'song-trigger' && (
            <div className="space-y-4">
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
                <RadioGroup value={triggerPosition} onValueChange={(value) => setTriggerPosition(value as 'before' | 'after')}>
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
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button 
            onClick={handleSchedule}
            disabled={
              (mode === 'datetime' && (!date || !time)) ||
              (mode === 'song-trigger' && !selectedSongId)
            }
          >
            Schedule Playlist
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

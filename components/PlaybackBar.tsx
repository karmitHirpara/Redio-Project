import { useEffect, useState } from 'react';
import type React from 'react';
import {
  Lock as LockIcon,
  Pause,
  Play,
  Radio,
  SkipForward,
  SlidersHorizontal,
  Unlock as UnlockIcon,
} from 'lucide-react';
import { Button } from './ui/button';
import { Slider } from './ui/slider';
import { Track } from '../types';
import { formatDuration } from '../lib/utils';
import { useAudioEngine } from '../hooks/useAudioEngine';
import type { UseAudioDevicesResult } from '../hooks/useAudioDevices';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { StepperInput } from './ui/stepper-input';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';

interface PlaybackBarProps {
  currentTrack: Track | null;
  /**
   * The upcoming track in the queue, used for future enhancements.
   */
  nextTrack: Track | null;
  isPlaying: boolean;
  onPlayPause: () => void;
  onNext: () => void;
  onPrevious: () => void;
  isLive: boolean;
  transitionMode: 'gap' | 'crossfade';
  onTransitionModeChange: (value: 'gap' | 'crossfade') => void;
  gapSeconds: number;
  onGapSecondsChange: (value: number) => void;
  crossfadeSeconds: number;
  onCrossfadeSecondsChange: (value: number) => void;
  audioDevices: UseAudioDevicesResult;
  onSeek?: (seconds: number) => void;
  onProgress?: (seconds: number) => void;
}

export function PlaybackBar({
  currentTrack,
  nextTrack,
  isPlaying,
  onPlayPause,
  onNext,
  onPrevious,
  isLive,
  transitionMode,
  onTransitionModeChange,
  gapSeconds,
  onGapSecondsChange,
  crossfadeSeconds,
  onCrossfadeSecondsChange,
  audioDevices,
  onSeek,
  onProgress,
}: PlaybackBarProps) {
  const [showPauseConfirm, setShowPauseConfirm] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [volume, setVolume] = useState(1);
  const SEEK_LOCK_KEY = 'redio.playback.seekLocked';
  const [seekLocked, setSeekLocked] = useState(false);

  const { primaryAudioRef, secondaryAudioRef, currentTime, duration, handleSeek } = useAudioEngine({
    currentTrack,
    nextTrack,
    isPlaying,
    transitionMode,
    gapSeconds,
    crossfadeSeconds,
    onNext,
  });

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SEEK_LOCK_KEY);
      setSeekLocked(raw === '1');
    } catch {
      // ignore
    }
  }, []);

  const toggleSeekLock = () => {
    setSeekLocked((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SEEK_LOCK_KEY, next ? '1' : '0');
      } catch {
        // ignore
      }
      return next;
    });
  };

  useEffect(() => {
    const v = Number.isFinite(volume) ? Math.min(Math.max(volume, 0), 1) : 1;
    const a = primaryAudioRef.current;
    const b = secondaryAudioRef.current;
    if (a) a.volume = v;
    if (b) b.volume = v;
  }, [volume, primaryAudioRef, secondaryAudioRef]);

  const volumePercent = Math.round(volume * 100);

  useEffect(() => {
    if (!onProgress) return;
    onProgress(currentTime);
  }, [currentTime, onProgress]);

  // Wire the global Audio Guard selection (from the header Output control)
  // into the actual audio elements used for playback. This keeps the
  // playback bar visually simple while still honoring device choices.
  const { selectedDeviceId, applyToAudioElements } = audioDevices;

  useEffect(() => {
    const a = primaryAudioRef.current;
    const b = secondaryAudioRef.current;
    if (!a && !b) return;
    applyToAudioElements([a, b]);
  }, [applyToAudioElements, primaryAudioRef, secondaryAudioRef, selectedDeviceId]);

  const handlePlayPause = () => {
    if (isLive && isPlaying) {
      setShowPauseConfirm(true);
    } else {
      onPlayPause();
    }
  };

  return (
    <>
      <audio ref={primaryAudioRef} className="hidden" />
      <audio ref={secondaryAudioRef} className="hidden" />
      <div className="h-20 bg-background border-t border-border flex items-center px-5 gap-5 relative">
        {/* Current Track Info */}
        <div className="flex items-center gap-3 w-64 min-w-[12rem]">
          {currentTrack ? (
            <>
              <div className="w-12 h-12 bg-accent rounded flex items-center justify-center">
                <Radio className="w-6 h-6 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <TooltipProvider delayDuration={300}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="text-sm text-foreground truncate cursor-default">
                        {currentTrack.name}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs text-xs leading-snug">
                      {currentTrack.name}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <div className="text-xs text-muted-foreground truncate">{currentTrack.artist}</div>
              </div>
            </>
          ) : (
            <div className="text-sm text-muted-foreground">No track playing</div>
          )}
        </div>

        {/* Playback Controls */}
        <div className="flex-1 flex flex-col gap-1.5">
          {/* Seek Bar */}
          {currentTrack && (
            <div className="flex items-center gap-2.5">
              <span className="text-[11px] text-muted-foreground w-12 text-right tabular-nums">
                {formatDuration(currentTime)}
              </span>
              <Slider
                value={[currentTime]}
                max={duration || currentTrack.duration || 0}
                step={1}
                disabled={seekLocked}
                onValueChange={seekLocked ? undefined : handleSeek}
                onValueCommit={
                  seekLocked
                    ? undefined
                    : (vals: number[]) => {
                        const seconds = vals[0] ?? 0;
                        if (onSeek) {
                          onSeek(seconds);
                        }
                      }
                }
                className="flex-1 h-1.5"
              />
              <span className="text-[11px] text-muted-foreground w-12 text-left tabular-nums">
                {formatDuration(duration || currentTrack.duration || 0)}
              </span>
            </div>
          )}

          {/* Media Buttons (below seek bar) */}
          <div className="flex items-center justify-center gap-1.5">
            <Button
              size="lg"
              onClick={handlePlayPause}
              className="w-10 h-10 rounded-full"
            >
              {isPlaying ? (
                <Pause className="w-5 h-5" />
              ) : (
                <Play className="w-5 h-5 ml-0.5" />
              )}
            </Button>
            <Button size="sm" variant="ghost" onClick={onNext}>
              <SkipForward className="w-4 h-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={toggleSeekLock}
              className="ml-1"
              title={seekLocked ? 'Unlock seek (allow changing position)' : 'Lock seek (prevent changing position)'}
            >
              {seekLocked ? <LockIcon className="w-4 h-4" /> : <UnlockIcon className="w-4 h-4" />}
            </Button>
          </div>
        </div>

        {/* Compact settings */}
        <div className="flex items-center gap-2">

          <div className="relative">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-9 gap-2"
              onClick={() => setAdjustOpen((v) => !v)}
            >
              <SlidersHorizontal className="h-4 w-4" />
              Adjust
            </Button>

            {adjustOpen && (
              <div
                className="absolute right-0 bottom-[calc(100%+10px)] z-[1000] w-[18rem] rounded-md border bg-popover p-2 shadow-md"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div className="px-1">
                  <div className="text-xs font-medium">Playback Adjust</div>
                </div>
                <div className="my-2 h-px bg-border" />
                <div className="grid grid-cols-[1fr,auto] items-center gap-x-3 gap-y-3 px-1 py-1">
                  <div className="text-xs text-muted-foreground">Gap</div>
                  <StepperInput
                    value={gapSeconds}
                    min={0}
                    max={8}
                    step={1}
                    showButtons={false}
                    onChange={(v) => {
                      onGapSecondsChange(v);
                      onTransitionModeChange('gap');
                    }}
                  />

                  <div className="text-xs text-muted-foreground">Sound</div>
                  <StepperInput
                    value={volumePercent}
                    min={0}
                    max={100}
                    step={1}
                    showButtons={false}
                    onChange={(v) => setVolume(Math.min(1, Math.max(0, v / 100)))}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Pause Confirmation Dialog */}
      <AlertDialog open={showPauseConfirm} onOpenChange={setShowPauseConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Pause Live Broadcast?</AlertDialogTitle>
            <AlertDialogDescription>
              You are currently broadcasting live. Pausing will interrupt the broadcast and may cause dead air.
              Are you sure you want to pause?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onPlayPause();
                setShowPauseConfirm(false);
              }}
              className="bg-destructive hover:bg-destructive/90"
            >
              Pause Broadcast
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

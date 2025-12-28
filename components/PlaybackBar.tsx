import { useEffect, useState } from 'react';
import { Play, Pause, SkipForward, SkipBack, Radio } from 'lucide-react';
import { Button } from './ui/button';
import { Slider } from './ui/slider';
import { Track } from '../types';
import { formatDuration } from '../lib/utils';
import { useAudioEngine } from '../hooks/useAudioEngine';
import type { UseAudioDevicesResult } from '../hooks/useAudioDevices';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
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
  crossfadeSeconds: number;
  onCrossfadeChange: (value: number) => void;
  audioDevices: UseAudioDevicesResult;
  onSeek?: (seconds: number) => void;
}

export function PlaybackBar({
  currentTrack,
  nextTrack,
  isPlaying,
  onPlayPause,
  onNext,
  onPrevious,
  isLive,
  crossfadeSeconds,
  onCrossfadeChange,
  audioDevices,
  onSeek,
}: PlaybackBarProps) {
  const [showPauseConfirm, setShowPauseConfirm] = useState(false);
  const { primaryAudioRef, secondaryAudioRef, currentTime, duration, handleSeek } = useAudioEngine({
    currentTrack,
    isPlaying,
    crossfadeSeconds,
    onNext,
    onSeek,
  });

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
      <div className="h-20 bg-background border-t border-border flex items-center px-5 gap-5">
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
          <div className="flex items-center justify-center gap-1.5">
            <Button size="sm" variant="ghost" onClick={onPrevious}>
              <SkipBack className="w-4 h-4" />
            </Button>
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
          </div>

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
                onValueChange={handleSeek}
                className="flex-1 h-1.5"
              />
              <span className="text-[11px] text-muted-foreground w-12 text-left tabular-nums">
                {formatDuration(duration || currentTrack.duration || 0)}
              </span>
            </div>
          )}
        </div>

        {/* Additional Controls */}
        <div className="flex items-center gap-4">
          {/* Gap between songs */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">Gap</span>
            <Slider
              value={[crossfadeSeconds]}
              max={12}
              step={1}
              onValueChange={(vals) => onCrossfadeChange(vals[0] ?? 0)}
              className="w-24 h-1.5"
            />
            <span className="text-[11px] text-muted-foreground w-6 text-right tabular-nums">{crossfadeSeconds}s</span>
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

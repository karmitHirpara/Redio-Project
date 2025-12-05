import { useState, useEffect, useRef } from 'react';
import { Play, Pause, SkipForward, SkipBack, Radio } from 'lucide-react';
import { Button } from './ui/button';
import { Slider } from './ui/slider';
import { Track } from '../types';
import { formatDuration } from '../lib/utils';
import { motion } from 'framer-motion';
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
  isPlaying: boolean;
  onPlayPause: () => void;
  onNext: () => void;
  onPrevious: () => void;
  isLive: boolean;
  repeatQueue: boolean;
  onToggleRepeatQueue: () => void;
  crossfadeSeconds: number;
  onCrossfadeChange: (value: number) => void;
}

export function PlaybackBar({
  currentTrack,
  isPlaying,
  onPlayPause,
  onNext,
  onPrevious,
  isLive,
  repeatQueue,
  onToggleRepeatQueue,
  crossfadeSeconds,
  onCrossfadeChange,
}: PlaybackBarProps) {
  const [currentTime, setCurrentTime] = useState(0);
  const [showPauseConfirm, setShowPauseConfirm] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [duration, setDuration] = useState(0);
  const fadeOutStartedRef = useRef(false);
  const fadeOutIntervalRef = useRef<number | null>(null);

  // Sync audio element with current track
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (currentTrack) {
      audio.src = currentTrack.filePath;
      audio.currentTime = 0;
      audio.volume = 0;
      setCurrentTime(0);
      // Prefer track.duration from metadata if available; otherwise will be updated from loadedmetadata
      setDuration(currentTrack.duration || 0);
      // Reset any previous fades when track changes
      fadeOutStartedRef.current = false;
      if (fadeOutIntervalRef.current !== null) {
        window.clearInterval(fadeOutIntervalRef.current);
        fadeOutIntervalRef.current = null;
      }
      if (isPlaying) {
        audio.play().catch(() => {
          // Playback might be blocked by browser autoplay policies
        });
      }
    } else {
      audio.removeAttribute('src');
      setCurrentTime(0);
    }
  }, [currentTrack]);

  // Play / pause audio when isPlaying changes
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!currentTrack) return;

    if (isPlaying) {
      audio.play().catch(() => {
        // Ignore play failures here; user interaction may be required
      });
    } else {
      audio.pause();
    }
  }, [isPlaying, currentTrack]);

  // Attach timeupdate and ended listeners
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);

      const effectiveDuration = duration || audio.duration || 0;
      const sliderSeconds = crossfadeSeconds ?? 0;
      // Use a short 2–3s window derived from slider for both fade-in and fade-out
      const fadeWindow = Math.min(sliderSeconds > 0 ? sliderSeconds : 2, 3);

      // Fade-in at the start: first fadeWindow seconds ramp volume 0 → 1
      if (fadeWindow > 0 && audio.currentTime <= fadeWindow) {
        const ratio = Math.max(0, Math.min(1, audio.currentTime / fadeWindow));
        try {
          audio.volume = ratio;
        } catch {
          // ignore
        }
      } else {
        // Ensure full volume outside the fade-in window unless fade-out overrides
        try {
          audio.volume = 1;
        } catch {
          // ignore
        }
      }

      // Smart end-fade: last fadeWindow seconds fade 1 → 0
      if (
        effectiveDuration > 0 &&
        fadeWindow > 0 &&
        audio.currentTime >= effectiveDuration - fadeWindow
      ) {
        const remaining = Math.max(0, effectiveDuration - audio.currentTime);
        const ratio = Math.max(0, Math.min(1, remaining / fadeWindow));
        try {
          audio.volume = ratio;
        } catch {
          // ignore
        }
      }
    };

    const handleLoadedMetadata = () => {
      if (!isNaN(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
      }
    };

    const handleEnded = () => {
      if (repeatQueue && currentTrack) {
        // Loop the same track seamlessly when repeat is enabled
        audio.currentTime = 0;
        setCurrentTime(0);
        audio.play().catch(() => {
          // ignore autoplay issues
        });
        return;
      }
      setCurrentTime(0);
      onNext();
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('ended', handleEnded);

      if (fadeOutIntervalRef.current !== null) {
        window.clearInterval(fadeOutIntervalRef.current);
        fadeOutIntervalRef.current = null;
      }
    };
  }, [onNext, duration, crossfadeSeconds, repeatQueue, currentTrack]);

  const handlePlayPause = () => {
    if (isLive && isPlaying) {
      setShowPauseConfirm(true);
    } else {
      onPlayPause();
    }
  };

  const handleSeek = (value: number[]) => {
    const newTime = value[0];
    setCurrentTime(newTime);
    const audio = audioRef.current;
    if (audio && currentTrack) {
      audio.currentTime = newTime;
    }
  };

  return (
    <>
      <audio ref={audioRef} className="hidden" />
      <div className="h-24 bg-background border-t border-border flex items-center px-6 gap-6">
        {/* Current Track Info */}
        <div className="flex items-center gap-3 w-64">
          {currentTrack ? (
            <>
              <div className="w-12 h-12 bg-accent rounded flex items-center justify-center">
                <Radio className="w-6 h-6 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-foreground truncate">{currentTrack.name}</div>
                <div className="text-xs text-muted-foreground truncate">{currentTrack.artist}</div>
              </div>
            </>
          ) : (
            <div className="text-sm text-muted-foreground">No track playing</div>
          )}
        </div>

        {/* Playback Controls */}
        <div className="flex-1 flex flex-col gap-2">
          <div className="flex items-center justify-center gap-2">
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
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground w-12 text-right">
                {formatDuration(currentTime)}
              </span>
              <Slider
                value={[currentTime]}
                max={duration || currentTrack.duration || 0}
                step={1}
                onValueChange={handleSeek}
                className="flex-1"
              />
              <span className="text-xs text-muted-foreground w-12">
                {formatDuration(duration || currentTrack.duration || 0)}
              </span>
            </div>
          )}
        </div>

        {/* Additional Controls */}
        <div className="flex items-center gap-6">
          {/* Crossfade */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Crossfade</span>
            <Slider
              value={[crossfadeSeconds]}
              max={12}
              step={1}
              onValueChange={(vals) => onCrossfadeChange(vals[0] ?? 0)}
              className="w-24"
            />
            <span className="text-xs text-muted-foreground w-6">{crossfadeSeconds}s</span>
          </div>
          {/* Repeat Queue */}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={repeatQueue ? "default" : "outline"}
              onClick={onToggleRepeatQueue}
            >
              Repeat
            </Button>
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

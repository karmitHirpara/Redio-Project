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
}: PlaybackBarProps) {
  const [currentTime, setCurrentTime] = useState(0);
  const [showPauseConfirm, setShowPauseConfirm] = useState(false);
  const primaryAudioRef = useRef<HTMLAudioElement | null>(null);
  const [duration, setDuration] = useState(0);
  const lastTrackIdRef = useRef<string | null>(null);

  // Simple fade state for single-audio playback
  const fadeRafRef = useRef<number | null>(null);
  const endDelayTimeoutRef = useRef<number | null>(null);

  const getActiveAudio = () => primaryAudioRef.current;

  // Sync audio element with current track. Only reset position when the track changes,
  // so pausing and resuming continues from the same spot.
  useEffect(() => {
    const audio = getActiveAudio();
    if (!audio) return;

    if (currentTrack) {
      const trackChanged = currentTrack.id !== lastTrackIdRef.current;
      if (trackChanged) {
        lastTrackIdRef.current = currentTrack.id;
        audio.src = currentTrack.filePath;
        audio.currentTime = 0;
        setCurrentTime(0);
        setDuration(currentTrack.duration || 0);
      }

      // Only run a fade-in if we are actively playing when a brand new track
      // is loaded. Start from a small, audible volume so there is no "dead"
      // first second.
      if (trackChanged && isPlaying) {
        audio.play().catch(() => {
          // Playback might be blocked by browser autoplay policies
        });

        if (fadeRafRef.current !== null) {
          cancelAnimationFrame(fadeRafRef.current);
        }

        const minFadeSeconds = 0.4;
        const maxFadeSeconds = 3;
        const fadeSeconds = Math.min(
          maxFadeSeconds,
          Math.max(minFadeSeconds, (crossfadeSeconds || 1.5) / 2),
        );
        const fadeDurationMs = fadeSeconds * 1000;
        const start = performance.now();
        const startVolume = 0.2; // immediately audible
        const targetVolume = 1;
        try {
          audio.volume = startVolume;
        } catch {}

        const step = () => {
          const now = performance.now();
          const ratio = Math.min(1, Math.max(0, (now - start) / fadeDurationMs));
          const eased = 1 - Math.cos((ratio * Math.PI) / 2);
          const v = startVolume + (targetVolume - startVolume) * eased;
          try {
            audio.volume = v;
          } catch {}

          if (ratio < 1 && isPlaying) {
            fadeRafRef.current = requestAnimationFrame(step);
          } else {
            fadeRafRef.current = null;
            try {
              audio.volume = 1;
            } catch {}
          }
        };

        fadeRafRef.current = requestAnimationFrame(step);
      } else if (!isPlaying) {
        // If we're not playing yet, keep the track at normal volume so the
        // first play click feels instant.
        try {
          audio.volume = 1;
        } catch {}
      }
    } else {
      audio.removeAttribute('src');
      setCurrentTime(0);
      lastTrackIdRef.current = null;
    }
  }, [currentTrack, isPlaying, crossfadeSeconds]);

  // Play / pause audio when isPlaying changes
  useEffect(() => {
    const audio = getActiveAudio();
    if (!audio) return;
    if (!currentTrack) return;

    if (isPlaying) {
      try {
        // Ensure volume is at full when starting/resuming playback
        audio.volume = 1;
      } catch {
        // ignore volume set errors
      }

      audio.play().catch(() => {
        // Ignore play failures here; user interaction may be required
      });
    } else {
      audio.pause();
    }
  }, [isPlaying, currentTrack]);

  // Attach timeupdate and ended listeners
  useEffect(() => {
    const audio = getActiveAudio();
    if (!audio) return;

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);

      // Gentle fade-out near the end of the track. We use an eased curve so the
      // tail sounds smooth rather than mechanical.
      const effectiveDuration = duration || audio.duration || 0;
      const baseWindow = Math.min(5, Math.max(1, crossfadeSeconds || 2));
      const fadeWindow = baseWindow; // seconds

      if (!isPlaying) return;

      if (effectiveDuration > 0 && audio.currentTime > 0) {
        const remaining = effectiveDuration - audio.currentTime;
        if (remaining <= fadeWindow && remaining >= 0) {
          const linear = Math.max(0, Math.min(1, remaining / fadeWindow));
          const eased = (Math.sin((linear * Math.PI) / 2)); // slow, smooth tail
          try {
            audio.volume = eased;
          } catch {}
        } else {
          try {
            audio.volume = 1;
          } catch {}
        }
      }
    };

    const handleLoadedMetadata = () => {
      if (!isNaN(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
      }
    };

    const handleEnded = () => {
      // Clear any existing end-delay timer
      if (endDelayTimeoutRef.current !== null) {
        window.clearTimeout(endDelayTimeoutRef.current);
        endDelayTimeoutRef.current = null;
      }

      setCurrentTime(0);

      const delayMs = Math.max(0, (crossfadeSeconds ?? 0) * 1000);
      endDelayTimeoutRef.current = window.setTimeout(() => {
        endDelayTimeoutRef.current = null;
        onNext();
      }, delayMs);
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [onNext, duration, crossfadeSeconds, currentTrack, nextTrack]);

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
    const audio = getActiveAudio();
    if (audio && currentTrack) {
      audio.currentTime = newTime;
    }
  };

  return (
    <>
      <audio ref={primaryAudioRef} className="hidden" />
      <div className="h-20 bg-background border-t border-border flex items-center px-5 gap-5">
        {/* Current Track Info */}
        <div className="flex items-center gap-3 w-64 min-w-[12rem]">
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
          {/* Crossfade */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">Crossfade</span>
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

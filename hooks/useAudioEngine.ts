import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import type { Track } from '../types';

interface UseAudioEngineOptions {
  currentTrack: Track | null;
  isPlaying: boolean;
  crossfadeSeconds: number;
  onNext: () => void;
}

interface UseAudioEngineResult {
  audioRef: React.RefObject<HTMLAudioElement>;
  currentTime: number;
  duration: number;
  handleSeek: (value: number[]) => void;
}

// Extracted single-audio playback engine used by PlaybackBar. This preserves all
// existing behaviour: fade-in on new track, gentle fade-out near the end, and a
// small delay before advancing to the next track on ended.
export function useAudioEngine({
  currentTrack,
  isPlaying,
  crossfadeSeconds,
  onNext,
}: UseAudioEngineOptions): UseAudioEngineResult {
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const primaryAudioRef = useRef<HTMLAudioElement>(null);
  const lastTrackIdRef = useRef<string | null>(null);

  // Simple fade state for single-audio playback
  const fadeRafRef = useRef<number | null>(null);
  const endDelayTimeoutRef = useRef<number | null>(null);

  const getActiveAudio = () => primaryAudioRef.current;

  // Sync audio element with current track. Only reset position when the track
  // actually changes, so pausing and resuming continues from the same spot.
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
  }, [onNext, duration, crossfadeSeconds, currentTrack, isPlaying]);

  const handleSeek = (value: number[]) => {
    const newTime = value[0];
    setCurrentTime(newTime);
    const audio = getActiveAudio();
    if (audio && currentTrack) {
      audio.currentTime = newTime;
    }
  };

  return {
    audioRef: primaryAudioRef,
    currentTime,
    duration,
    handleSeek,
  };
}

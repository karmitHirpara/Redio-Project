import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import type { Track } from '../types';
import { resolveUploadsUrl } from '../services/api';

interface UseAudioEngineOptions {
  currentTrack: Track | null;
  isPlaying: boolean;
  crossfadeSeconds: number;
  onNext: () => void;
}

interface UseAudioEngineResult {
  primaryAudioRef: React.RefObject<HTMLAudioElement>;
  secondaryAudioRef: React.RefObject<HTMLAudioElement>;
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
  const secondaryAudioRef = useRef<HTMLAudioElement>(null);
  const lastTrackIdRef = useRef<string | null>(null);

  // Edge fade state: we use a small RAF loop to fade in the first 0.5s of a
  // new track, and a time-based computation for the last 0.5s.
  const fadeRafRef = useRef<number | null>(null);
  const endDelayTimeoutRef = useRef<number | null>(null);
  const autoAdvanceRef = useRef(false);
  const pendingAdvanceUntilMsRef = useRef<number | null>(null);

  const activeIndexRef = useRef<0 | 1>(0);

  const getAudioByIndex = (index: 0 | 1) =>
    index === 0 ? primaryAudioRef.current : secondaryAudioRef.current;

  const getActiveAudio = () => getAudioByIndex(activeIndexRef.current);
  const getInactiveAudio = () => getAudioByIndex(activeIndexRef.current === 0 ? 1 : 0);

  // Sync audio element with current track. Only reset position when the track
  // actually changes, so pausing and resuming continues from the same spot.
  useEffect(() => {
    const activeAudio = getActiveAudio();
    const inactiveAudio = getInactiveAudio();

    if (!primaryAudioRef.current || !secondaryAudioRef.current) return;

    if (!currentTrack) {
      if (fadeRafRef.current !== null) {
        cancelAnimationFrame(fadeRafRef.current);
        fadeRafRef.current = null;
      }

      [primaryAudioRef.current, secondaryAudioRef.current].forEach((audioEl) => {
        if (!audioEl) return;
        audioEl.pause();
        audioEl.removeAttribute('src');
        try {
          audioEl.volume = 1;
        } catch {}
      });
      setCurrentTime(0);
      setDuration(0);
      lastTrackIdRef.current = null;
      return;
    }

    const trackChanged = currentTrack.id !== lastTrackIdRef.current;

    // First track: just load it on the active element.
    if (!lastTrackIdRef.current && currentTrack && activeAudio) {
      lastTrackIdRef.current = currentTrack.id;
      activeAudio.src = resolveUploadsUrl(currentTrack.filePath);
      activeAudio.currentTime = 0;
      setCurrentTime(0);
      setDuration(currentTrack.duration || 0);

      try {
        activeAudio.volume = 0;
      } catch {}

      if (isPlaying) {
        activeAudio.play().catch(() => {
          // Playback might be blocked by browser autoplay policies
        });

        if (typeof document !== 'undefined' && document.hidden) {
          try {
            activeAudio.volume = 1;
          } catch {}
          return;
        }

        // Fade in the first ~0.5s of the newly started track.
        if (fadeRafRef.current !== null) {
          cancelAnimationFrame(fadeRafRef.current);
        }

        const fadeDurationMs = 500;
        const start = performance.now();

        const step = () => {
          const now = performance.now();
          const ratio = Math.min(1, Math.max(0, (now - start) / fadeDurationMs));
          const eased = 1 - Math.cos((ratio * Math.PI) / 2);

          try {
            activeAudio.volume = eased;
          } catch {}

          if (ratio < 1 && isPlaying) {
            fadeRafRef.current = requestAnimationFrame(step);
          } else {
            fadeRafRef.current = null;
            try {
              activeAudio.volume = 1;
            } catch {}
          }
        };

        fadeRafRef.current = requestAnimationFrame(step);
      }
      return;
    }

    if (!trackChanged || !currentTrack || !activeAudio || !inactiveAudio) {
      return;
    }

    // Any subsequent track change (auto-advance, preempt, manual Next):
    // stop both, clear the inactive, and hard-switch the host element to the
    // new track with full volume and a short fade-in.
    autoAdvanceRef.current = false;

    const host = activeAudio || inactiveAudio;
    const other = host === activeAudio ? inactiveAudio : activeAudio;

    if (other) {
      other.pause();
      other.removeAttribute('src');
      try {
        other.volume = 1;
      } catch {}
    }

    if (host) {
      host.pause();
      host.src = resolveUploadsUrl(currentTrack.filePath);
      host.currentTime = 0;
      try {
        host.volume = 0;
      } catch {}

      if (isPlaying) {
        host.play().catch(() => {
          // Playback might be blocked by browser autoplay policies
        });

        if (typeof document !== 'undefined' && document.hidden) {
          try {
            host.volume = 1;
          } catch {}
          return;
        }

        // Fade in the first ~0.5s of the newly started track.
        if (fadeRafRef.current !== null) {
          cancelAnimationFrame(fadeRafRef.current);
        }

        const fadeDurationMs = 500;
        const start = performance.now();

        const step = () => {
          const now = performance.now();
          const ratio = Math.min(1, Math.max(0, (now - start) / fadeDurationMs));
          const eased = 1 - Math.cos((ratio * Math.PI) / 2);

          try {
            host.volume = eased;
          } catch {}

          if (ratio < 1 && isPlaying) {
            fadeRafRef.current = requestAnimationFrame(step);
          } else {
            fadeRafRef.current = null;
            try {
              host.volume = 1;
            } catch {}
          }
        };

        fadeRafRef.current = requestAnimationFrame(step);
      }
    }

    activeIndexRef.current = host === primaryAudioRef.current ? 0 : 1;
    lastTrackIdRef.current = currentTrack.id;
    setCurrentTime(0);
    setDuration(currentTrack.duration || 0);
  }, [currentTrack, isPlaying, crossfadeSeconds]);

  // Play / pause audio when isPlaying changes
  useEffect(() => {
    const activeAudio = getActiveAudio();
    const inactiveAudio = getInactiveAudio();
    if (!activeAudio && !inactiveAudio) return;
    if (!currentTrack) {
      [activeAudio, inactiveAudio].forEach((audioEl) => {
        if (!audioEl) return;
        audioEl.pause();
      });
      return;
    }

    if (isPlaying) {
      try {
        if (activeAudio) {
          // Do not override any in-progress fade; just resume playback.
          activeAudio.play().catch(() => {
            // Ignore play failures here; user interaction may be required
          });
        }
      } catch {
        // ignore volume set errors
      }
    } else {
      [activeAudio, inactiveAudio].forEach((audioEl) => {
        if (!audioEl) return;
        audioEl.pause();
      });
    }
  }, [isPlaying, currentTrack]);

  // Attach timeupdate and ended listeners
  useEffect(() => {
    const audioA = primaryAudioRef.current;
    const audioB = secondaryAudioRef.current;
    if (!audioA && !audioB) return;

    const handleTimeUpdate = (audio: HTMLAudioElement) => {
      if (audio !== getActiveAudio()) return;
      setCurrentTime(audio.currentTime);

      // Apply a gentle fade-out over the last ~0.5s of the track so tails
      // sound smooth and avoid abrupt stops.
      const effectiveDuration = duration || audio.duration || 0;
      const fadeWindow = 0.5; // seconds

      if (!isPlaying) return;

      if (effectiveDuration > 0 && audio.currentTime > 0) {
        const remaining = effectiveDuration - audio.currentTime;
        if (remaining <= fadeWindow && remaining >= 0) {
          const linear = Math.max(0, Math.min(1, remaining / fadeWindow));
          const eased = Math.sin((linear * Math.PI) / 2);
          try {
            audio.volume = eased;
          } catch {}
        } else if (fadeRafRef.current === null) {
          // Only reset volume to 1 when no fade-in is in progress.
          try {
            audio.volume = 1;
          } catch {}
        }
      }
    };

    const handleLoadedMetadata = (audio: HTMLAudioElement) => {
      if (audio !== getActiveAudio()) return;
      if (!isNaN(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
      }
    };

    const handleEnded = (audio: HTMLAudioElement) => {
      if (audio !== getActiveAudio()) return;

      // Clear any existing end-delay timer
      if (endDelayTimeoutRef.current !== null) {
        window.clearTimeout(endDelayTimeoutRef.current);
        endDelayTimeoutRef.current = null;
      }

      setCurrentTime(0);

      // Use crossfadeSeconds as a gap duration (in seconds) so there is
      // configurable silence between songs before advancing to the next
      // track.
      const delayMs = Math.max(0, (crossfadeSeconds ?? 0) * 1000);
      pendingAdvanceUntilMsRef.current = Date.now() + delayMs;
      endDelayTimeoutRef.current = window.setTimeout(() => {
        endDelayTimeoutRef.current = null;
        const until = pendingAdvanceUntilMsRef.current;
        if (until != null && Date.now() < until) {
          return;
        }
        pendingAdvanceUntilMsRef.current = null;
        autoAdvanceRef.current = true;
        onNext();
      }, delayMs);
    };

    const attach = (audio: HTMLAudioElement | null) => {
      if (!audio) return;
      const onTimeUpdate = () => handleTimeUpdate(audio);
      const onLoadedMetadata = () => handleLoadedMetadata(audio);
      const onEnded = () => handleEnded(audio);
      audio.addEventListener('timeupdate', onTimeUpdate);
      audio.addEventListener('loadedmetadata', onLoadedMetadata);
      audio.addEventListener('ended', onEnded);
      return () => {
        audio.removeEventListener('timeupdate', onTimeUpdate);
        audio.removeEventListener('loadedmetadata', onLoadedMetadata);
        audio.removeEventListener('ended', onEnded);
      };
    };

    const detachA = attach(audioA);
    const detachB = attach(audioB);

    return () => {
      detachA?.();
      detachB?.();
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

  // Some environments may suspend media/timers when backgrounded. When the
  // user returns to the app, try to resume playback if it should be playing.
  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;

    const tryResume = () => {
      if (!isPlaying || !currentTrack) return;
      const audio = getActiveAudio();
      if (!audio) return;

      const pendingUntil = pendingAdvanceUntilMsRef.current;
      if (pendingUntil != null && Date.now() >= pendingUntil) {
        pendingAdvanceUntilMsRef.current = null;
        autoAdvanceRef.current = true;
        onNext();
        return;
      }

      if (!audio.paused) return;
      audio.play().catch(() => {
        // Ignore: browser autoplay policies may still require user gesture.
      });

      // Always re-sync UI timing from the media element when returning to the
      // foreground. Background throttling can pause timeupdate events, which
      // would otherwise leave the UI and scheduling logic stale.
      try {
        if (Number.isFinite(audio.currentTime)) {
          setCurrentTime(audio.currentTime);
        }
        if (Number.isFinite(audio.duration) && audio.duration > 0) {
          setDuration(audio.duration);
        }
      } catch {
        // ignore
      }

      if (!audio.paused && audio.volume === 0) {
        try {
          audio.volume = 1;
        } catch {}
      }
    };

    const onVisibility = () => {
      if (!document.hidden) {
        tryResume();
      }
    };

    window.addEventListener('focus', tryResume);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', tryResume);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [isPlaying, currentTrack]);

  return {
    primaryAudioRef,
    secondaryAudioRef,
    currentTime,
    duration,
    handleSeek,
  };
}

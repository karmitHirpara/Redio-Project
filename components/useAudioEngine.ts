import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import type { Track } from '../types';
import { resolveUploadsUrl } from '../services/api';

interface UseAudioEngineOptions {
  currentTrack: Track | null;
  nextTrack?: Track | null;
  isPlaying: boolean;
  transitionMode: 'gap' | 'crossfade';
  gapSeconds: number;
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
  nextTrack,
  isPlaying,
  transitionMode,
  gapSeconds,
  crossfadeSeconds,
  onNext,
}: UseAudioEngineOptions): UseAudioEngineResult {
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const transitionModeRef = useRef<'gap' | 'crossfade'>(transitionMode);
  const gapSecondsRef = useRef<number>(gapSeconds);
  const crossfadeSecondsRef = useRef<number>(crossfadeSeconds);
  const nextTrackRef = useRef<Track | null>(nextTrack ?? null);
  useEffect(() => {
    transitionModeRef.current = transitionMode;
  }, [transitionMode]);
  useEffect(() => {
    gapSecondsRef.current = gapSeconds;
  }, [gapSeconds]);
  useEffect(() => {
    crossfadeSecondsRef.current = crossfadeSeconds;
  }, [crossfadeSeconds]);
  useEffect(() => {
    nextTrackRef.current = nextTrack ?? null;
  }, [nextTrack]);

  const primaryAudioRef = useRef<HTMLAudioElement>(null);
  const secondaryAudioRef = useRef<HTMLAudioElement>(null);
  const lastTrackIdRef = useRef<string | null>(null);

  // Edge fade state: we use a small RAF loop to fade in the first 0.5s of a
  // new track, and a time-based computation for the last 0.5s.
  const fadeRafRef = useRef<number | null>(null);
  const endDelayTimeoutRef = useRef<number | null>(null);
  const autoAdvanceRef = useRef(false);
  const pendingAdvanceUntilMsRef = useRef<number | null>(null);
  const crossfadeStateRef = useRef<
    | { phase: 'idle' }
    | { phase: 'fading'; startedAtMs: number; durationMs: number; outgoingIndex: 0 | 1; incomingIndex: 0 | 1 }
  >({ phase: 'idle' });

  const activeIndexRef = useRef<0 | 1>(0);
  const retryCountRef = useRef<Record<string, number>>({});

  const getAudioByIndex = (index: 0 | 1) =>
    index === 0 ? primaryAudioRef.current : secondaryAudioRef.current;

  const getActiveAudio = () => getAudioByIndex(activeIndexRef.current);
  const getInactiveAudio = () => getAudioByIndex(activeIndexRef.current === 0 ? 1 : 0);

  const clearPendingAdvance = () => {
    if (endDelayTimeoutRef.current !== null) {
      window.clearTimeout(endDelayTimeoutRef.current);
      endDelayTimeoutRef.current = null;
    }
    pendingAdvanceUntilMsRef.current = null;
  };

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

      clearPendingAdvance();

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
      clearPendingAdvance();
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

    // If we already performed an internal crossfade into this track, do NOT
    // reinitialize playback here; just let the UI props catch up.
    if (autoAdvanceRef.current && currentTrack.id === lastTrackIdRef.current) {
      autoAdvanceRef.current = false;
      return;
    }

    // Any subsequent track change (auto-advance, preempt, manual Next):
    // stop both, clear the inactive, and hard-switch the host element to the
    // new track with full volume and a short fade-in.
    autoAdvanceRef.current = false;
    clearPendingAdvance();

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
  }, [currentTrack, isPlaying, transitionMode, gapSeconds, crossfadeSeconds, nextTrack]);

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

      const effectiveDuration = duration || audio.duration || 0;
      if (!isPlaying) return;

      // True crossfade: start incoming track N seconds before end, fade volumes.
      const mode = transitionModeRef.current;
      const cfSeconds = Number.isFinite(crossfadeSecondsRef.current)
        ? Math.max(0, crossfadeSecondsRef.current)
        : 0;

      const next = nextTrackRef.current;
      if (mode === 'crossfade' && cfSeconds > 0 && effectiveDuration > 0 && next && next.filePath) {
        const remaining = effectiveDuration - audio.currentTime;
        const state = crossfadeStateRef.current;
        if (remaining <= cfSeconds && remaining >= 0 && state.phase === 'idle') {
          const outgoingIndex = activeIndexRef.current;
          const incomingIndex = outgoingIndex === 0 ? 1 : 0;
          const incomingAudio = getAudioByIndex(incomingIndex);
          const outgoingAudio = getAudioByIndex(outgoingIndex);
          if (incomingAudio && outgoingAudio) {
            // Cancel any gap timer that might be queued.
            if (endDelayTimeoutRef.current !== null) {
              window.clearTimeout(endDelayTimeoutRef.current);
              endDelayTimeoutRef.current = null;
            }
            pendingAdvanceUntilMsRef.current = null;

            // Load + start incoming.
            incomingAudio.pause();
            incomingAudio.src = resolveUploadsUrl(next.filePath);
            incomingAudio.currentTime = 0;
            try {
              incomingAudio.volume = 0;
              outgoingAudio.volume = 1;
            } catch {}
            if (isPlaying) {
              incomingAudio.play().catch(() => {});
            }

            const durationMs = cfSeconds * 1000;
            crossfadeStateRef.current = {
              phase: 'fading',
              startedAtMs: performance.now(),
              durationMs,
              outgoingIndex,
              incomingIndex,
            };

            const step = () => {
              const st = crossfadeStateRef.current;
              if (st.phase !== 'fading') return;
              const now = performance.now();
              const t = Math.min(1, Math.max(0, (now - st.startedAtMs) / st.durationMs));
              const eased = 1 - Math.cos((t * Math.PI) / 2);
              const outVol = 1 - eased;
              const inVol = eased;
              const outEl = getAudioByIndex(st.outgoingIndex);
              const inEl = getAudioByIndex(st.incomingIndex);
              if (outEl) {
                try {
                  outEl.volume = outVol;
                } catch {}
              }
              if (inEl) {
                try {
                  inEl.volume = inVol;
                } catch {}
              }

              if (t < 1 && isPlaying) {
                fadeRafRef.current = requestAnimationFrame(step);
                return;
              }

              // Crossfade complete: swap active audio, stop outgoing, and
              // advance app queue state.
              fadeRafRef.current = null;
              crossfadeStateRef.current = { phase: 'idle' };

              if (outEl) {
                outEl.pause();
                outEl.removeAttribute('src');
                try {
                  outEl.volume = 1;
                } catch {}
              }
              if (inEl) {
                try {
                  inEl.volume = 1;
                } catch {}
              }

              activeIndexRef.current = st.incomingIndex;
              lastTrackIdRef.current = next.id;
              setCurrentTime(0);
              setDuration(next.duration || 0);

              autoAdvanceRef.current = true;
              onNext();
            };

            if (fadeRafRef.current !== null) {
              cancelAnimationFrame(fadeRafRef.current);
            }
            fadeRafRef.current = requestAnimationFrame(step);
            return;
          }
        }
      }

      // Fallback gentle tail fade only when not crossfading.
      const tailFadeWindow = 0.5;
      if (effectiveDuration > 0 && audio.currentTime > 0) {
        const remaining = effectiveDuration - audio.currentTime;
        if (remaining <= tailFadeWindow && remaining >= 0) {
          const linear = Math.max(0, Math.min(1, remaining / tailFadeWindow));
          const eased = Math.sin((linear * Math.PI) / 2);
          try {
            audio.volume = eased;
          } catch {}
        } else if (fadeRafRef.current === null && crossfadeStateRef.current.phase === 'idle') {
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

      // If a crossfade is in progress, ended is not authoritative (we may have
      // already swapped to the incoming track).
      if (crossfadeStateRef.current.phase !== 'idle') {
        return;
      }

      clearPendingAdvance();

      setCurrentTime(0);

      const mode = transitionModeRef.current;
      const gap = Number.isFinite(gapSecondsRef.current) ? Math.max(0, gapSecondsRef.current) : 0;
      const hasNext = Boolean(nextTrackRef.current);
      const delayMs = mode === 'gap' && hasNext ? Math.max(0, gap * 1000) : 0;

      if (delayMs <= 0) {
        autoAdvanceRef.current = true;
        onNext();
        return;
      }

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

    const handleAudioError = (audio: HTMLAudioElement) => {
      if (audio !== getActiveAudio() || !currentTrack) return;

      const trackId = currentTrack.id;
      const currentRetries = retryCountRef.current[trackId] || 0;

      if (currentRetries < 3) {
        const backoffMs = Math.pow(2, currentRetries) * 1000;
        console.warn(`[AudioEngine] Playback error for track ${currentTrack.name}. Retrying in ${backoffMs}ms (attempt ${currentRetries + 1}/3)...`, audio.error);
        
        retryCountRef.current[trackId] = currentRetries + 1;
        
        setTimeout(() => {
          if (currentTrack?.id === trackId && isPlaying) {
             audio.load();
             audio.play().catch(e => console.error("[AudioEngine] Retry play failed", e));
          }
        }, backoffMs);
      } else {
        console.error(`[AudioEngine] Critical playback error for track ${currentTrack.name} after 3 retries.`, audio.error);
        // On ultimate failure in live mode, maybe we should skip to next? 
        // For now just log, but in a real radio app, silence is the enemy.
        // autoAdvanceRef.current = true;
        // onNext();
      }
    };

    const attach = (audio: HTMLAudioElement | null) => {
      if (!audio) return;
      const onTimeUpdate = () => handleTimeUpdate(audio);
      const onLoadedMetadata = () => handleLoadedMetadata(audio);
      const onEnded = () => handleEnded(audio);
      const onError = () => handleAudioError(audio);
      
      audio.addEventListener('timeupdate', onTimeUpdate);
      audio.addEventListener('loadedmetadata', onLoadedMetadata);
      audio.addEventListener('ended', onEnded);
      audio.addEventListener('error', onError);
      
      return () => {
        audio.removeEventListener('timeupdate', onTimeUpdate);
        audio.removeEventListener('loadedmetadata', onLoadedMetadata);
        audio.removeEventListener('ended', onEnded);
        audio.removeEventListener('error', onError);
      };
    };

    const detachA = attach(audioA);
    const detachB = attach(audioB);

    return () => {
      detachA?.();
      detachB?.();
    };
  }, [onNext, duration, currentTrack, isPlaying]);

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

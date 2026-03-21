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
  onNext: (isAutoAdvance?: boolean) => void;
}

interface UseAudioEngineResult {
  primaryAudioRef: React.RefObject<HTMLAudioElement>;
  secondaryAudioRef: React.RefObject<HTMLAudioElement>;
  currentTime: number;
  duration: number;
  isInGap: boolean;
  gapRemainingSeconds: number;
  handleSeek: (value: number[]) => void;
  handleSoftRestart: () => void;
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
  const [isInGap, setIsInGap] = useState(false);
  const [gapRemainingSeconds, setGapRemainingSeconds] = useState(0);

  const gapSecondsRef = useRef<number>(gapSeconds);
  const nextTrackRef = useRef<Track | null>(nextTrack ?? null);
  useEffect(() => {
    gapSecondsRef.current = gapSeconds;
  }, [gapSeconds]);
  useEffect(() => {
    nextTrackRef.current = nextTrack ?? null;
  }, [nextTrack]);

  const primaryAudioRef = useRef<HTMLAudioElement>(null);
  const secondaryAudioRef = useRef<HTMLAudioElement>(null);
  const lastTrackIdRef = useRef<string | null>(null);

  const endDelayTimeoutRef = useRef<number | null>(null);
  const pollIntervalRef = useRef<number | null>(null);
  const autoAdvanceRef = useRef(false);
  const pendingAdvanceRemainingMsRef = useRef<number | null>(null);
  const pendingAdvanceLastTickMsRef = useRef<number | null>(null);
  const audioWorkerRef = useRef<Worker | null>(null);

  // Initialize Audio Worker
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const worker = new Worker('/audio-worker.js');
    audioWorkerRef.current = worker;

    return () => {
      worker.postMessage({ type: 'STOP_TIMER' });
      worker.terminate();
      audioWorkerRef.current = null;
    };
  }, []);

  // Prefetch the next track to guarantee zero-ms interruption
  useEffect(() => {
    if (nextTrack && audioWorkerRef.current) {
      const url = resolveUploadsUrl(nextTrack.filePath);
      audioWorkerRef.current.postMessage({ type: 'PREFETCH_TRACK', payload: { url } });
    }
  }, [nextTrack]);

  const getActiveAudio = () => primaryAudioRef.current;
  const getInactiveAudio = () => secondaryAudioRef.current;

  const clearPendingAdvance = () => {
    if (endDelayTimeoutRef.current !== null) {
      window.clearTimeout(endDelayTimeoutRef.current);
      endDelayTimeoutRef.current = null;
    }
    if (pollIntervalRef.current !== null) {
      window.clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    pendingAdvanceRemainingMsRef.current = null;
    pendingAdvanceLastTickMsRef.current = null;
    setIsInGap(false);
    setGapRemainingSeconds(0);
  };

  // Sync audio element with current track. Only reset position when the track
  // actually changes, so pausing and resuming continues from the same spot.
  useEffect(() => {
    const activeAudio = getActiveAudio();
    const inactiveAudio = getInactiveAudio();

    if (!primaryAudioRef.current || !secondaryAudioRef.current) return;

    if (!currentTrack) {
      clearPendingAdvance();

      [primaryAudioRef.current, secondaryAudioRef.current].forEach((audioEl) => {
        if (!audioEl) return;
        audioEl.pause();
        audioEl.removeAttribute('src');
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
      
      const startPos = currentTrack.cueIn || 0;
      activeAudio.currentTime = startPos;
      setCurrentTime(startPos);
      
      setDuration(currentTrack.duration || 0);
      setIsInGap(false);
      setGapRemainingSeconds(0);

      if (isPlaying) {
        activeAudio.play().catch(() => {
          // Playback might be blocked by browser autoplay policies
        });
      }
      return;
    }

    if (!trackChanged || !currentTrack || !activeAudio || !inactiveAudio) {
      return;
    }

    // Any subsequent track change (auto-advance, preempt, manual Next):
    // stop both, clear the inactive, and hard-switch the host element to the
    // new track with no fades and no overlap.
    autoAdvanceRef.current = false;
    clearPendingAdvance();

    const host = activeAudio || inactiveAudio;
    const other = host === activeAudio ? inactiveAudio : activeAudio;

    if (other) {
      other.pause();
      other.removeAttribute('src');
      try {
        other.volume = 1;
      } catch (error) {
        // ignore volume set errors
      }
    }

    if (host) {
      host.pause();
      host.src = resolveUploadsUrl(currentTrack.filePath);
      
      const startPos = currentTrack.cueIn || 0;
      host.currentTime = startPos;

      if (isPlaying) {
        host.play().catch(() => {
          // Playback might be blocked by browser autoplay policies
        });
      }
    }
    lastTrackIdRef.current = currentTrack.id;
    const startPos = currentTrack.cueIn || 0;
    setCurrentTime(startPos);
    setDuration(currentTrack.duration || 0);
    setIsInGap(false);
    setGapRemainingSeconds(0);
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
      } catch (_err) {
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

      const effectiveDuration = currentTrack?.cueOut || duration || audio.duration || 0;
      if (!isPlaying) return;

      // Check if we hit the non-destructive cue trigger
      if (audio.currentTime >= effectiveDuration - 0.05) {
        if (!isInGap) handleEnded(audio);
      }
    };

    const handleProgress = (audio: HTMLAudioElement) => {
      if (audio !== getActiveAudio()) return;
      // Heartbeat signal
    };

    const handleError = (audio: HTMLAudioElement) => {
      if (audio !== getActiveAudio()) return;
      console.error(`[AudioEngine] Playback error:`, audio.error);
    };

    const handleLoadedMetadata = (audio: HTMLAudioElement) => {
      if (audio !== getActiveAudio()) return;
      if (!isNaN(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
      }
    };

    const handleEnded = (audio: HTMLAudioElement) => {
      if (audio !== getActiveAudio()) return;

      clearPendingAdvance();

      // Keep the playhead pinned at the end during the gap, so the UI doesn't
      // jump back to 0:00 while we're waiting to advance.
      try {
        const effectiveDuration = currentTrack?.cueOut || duration || audio.duration || 0;
        if (Number.isFinite(effectiveDuration) && effectiveDuration > 0) {
          setCurrentTime(effectiveDuration);
        } else {
          setCurrentTime(currentTrack?.cueIn || 0);
        }
      } catch (_err) {
        setCurrentTime(currentTrack?.cueIn || 0);
      }

      const gap = Number.isFinite(gapSecondsRef.current) ? Math.max(0, gapSecondsRef.current) : 0;
      const hasNext = Boolean(nextTrackRef.current);
      const delayMs = hasNext ? Math.max(0, gap * 1000) : 0;

      if (delayMs <= 0) {
        autoAdvanceRef.current = true;
        onNext(true);
        return;
      }

      pendingAdvanceRemainingMsRef.current = delayMs;
      pendingAdvanceLastTickMsRef.current = Date.now();
      setIsInGap(true);
      setGapRemainingSeconds(Math.max(0, Math.ceil(delayMs / 1000)));
    };

    const ensurePoll = () => {
      if (pollIntervalRef.current !== null) return;

      const tick = (now: number) => {
        if (!currentTrack) return;
        const audio = getActiveAudio();
        if (!audio) return;

        const remaining = pendingAdvanceRemainingMsRef.current;
        if (remaining != null) {
          const lastTick = pendingAdvanceLastTickMsRef.current ?? now;
          const dt = Math.max(0, now - lastTick);
          pendingAdvanceLastTickMsRef.current = now;

          if (isPlaying) {
            const nextRemaining = remaining - dt;
            pendingAdvanceRemainingMsRef.current = nextRemaining;

            const secondsLeft = Math.max(0, Math.ceil(nextRemaining / 1000));
            setIsInGap(secondsLeft > 0);
            setGapRemainingSeconds(secondsLeft);

            if (nextRemaining <= 0) {
              pendingAdvanceRemainingMsRef.current = null;
              pendingAdvanceLastTickMsRef.current = null;
              setIsInGap(false);
              setGapRemainingSeconds(0);
              autoAdvanceRef.current = true;
              onNext(true);
            }
          } else {
            const secondsLeft = Math.max(0, Math.ceil(remaining / 1000));
            setIsInGap(secondsLeft > 0);
            setGapRemainingSeconds(secondsLeft);
          }
          return;
        }

        if (isPlaying) {
          handleTimeUpdate(audio);
        }
      };

      if (!audioWorkerRef.current) return;
      
      const worker = audioWorkerRef.current;
      worker.onmessage = (e) => {
        if (e.data.type === 'TIMER_TICK') {
           tick(e.data.timestamp);
        }
      };
      worker.postMessage({ type: 'START_TIMER' });
      pollIntervalRef.current = 1 as any; // Mark as active
    };

    const attach = (audio: HTMLAudioElement | null) => {
      if (!audio) return;
      const onTimeUpdate = () => handleTimeUpdate(audio);
      const onLoadedMetadata = () => handleLoadedMetadata(audio);
      const onEnded = () => handleEnded(audio);
      const onProgress = () => handleProgress(audio);
      const onError = () => handleError(audio);

      audio.addEventListener('timeupdate', onTimeUpdate);
      audio.addEventListener('loadedmetadata', onLoadedMetadata);
      audio.addEventListener('ended', onEnded);
      audio.addEventListener('progress', onProgress);
      audio.addEventListener('error', onError);

      ensurePoll();
      return () => {
        audio.removeEventListener('timeupdate', onTimeUpdate);
        audio.removeEventListener('loadedmetadata', onLoadedMetadata);
        audio.removeEventListener('ended', onEnded);
        audio.removeEventListener('progress', onProgress);
        audio.removeEventListener('error', onError);
      };
    };

    const detachA = attach(audioA);
    const detachB = attach(audioB);

    return () => {
      detachA?.();
      detachB?.();
      if (pollIntervalRef.current !== null && audioWorkerRef.current) {
        audioWorkerRef.current.postMessage({ type: 'STOP_TIMER' });
        pollIntervalRef.current = null;
      }
    };
  }, [onNext, duration, currentTrack, isPlaying]);

  const handleSeek = (value: number[]) => {
    let newTime = value[0];
    if (currentTrack?.cueIn !== undefined && newTime < currentTrack.cueIn) newTime = currentTrack.cueIn;
    if (currentTrack?.cueOut !== undefined && newTime > currentTrack.cueOut) newTime = currentTrack.cueOut;

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
        } catch (_err) { }
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

  const handleSoftRestart = () => {
    const audio = getActiveAudio();
    if (!audio || !currentTrack) return;

    console.log('[AudioEngine] Soft restart triggered');
    const lastPos = audio.currentTime;
    const currentSrc = audio.src;

    audio.pause();
    audio.src = '';
    audio.load();
    audio.src = currentSrc;
    audio.currentTime = lastPos;

    if (isPlaying) {
      audio.play().catch(err => console.error('[AudioEngine] Soft restart play failed:', err));
    }
  };

  return {
    primaryAudioRef,
    secondaryAudioRef,
    currentTime,
    duration,
    isInGap,
    gapRemainingSeconds,
    handleSeek,
    handleSoftRestart,
  };
}

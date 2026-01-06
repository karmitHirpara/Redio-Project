import { useEffect, useMemo, useState } from 'react';
import { QueueItem, Track } from '../types';

interface UseQueueTimingInput {
  queue: QueueItem[];
  currentTrack: Track | null;
  currentQueueItemId: string | null;
  isPlaying: boolean;
  nowPlayingStart: Date | null;
  crossfadeSeconds: number;
  seekAnchor?: { seconds: number; at: Date } | null;
}

export interface NowPlayingTiming {
  track: Track | null;
  start: Date | null;
  end: Date | null;
}

export interface QueueItemTiming {
  item: QueueItem;
  index: number;
  start: Date;
  end: Date;
}

export interface QueueTimingResult {
  nowPlaying: NowPlayingTiming;
  queueTimings: QueueItemTiming[];
}

function adjustedDurationSeconds(track: Track | null, crossfadeSeconds: number): number {
  if (!track || !track.duration || track.duration <= 0) return 0;
  const base = track.duration;
  const adjusted = base - crossfadeSeconds;
  return adjusted > 0 ? adjusted : base; // never go below original duration completely
}

export function useQueueTiming({
  queue,
  currentTrack,
  currentQueueItemId,
  isPlaying,
  nowPlayingStart,
  crossfadeSeconds,
  seekAnchor,
}: UseQueueTimingInput): QueueTimingResult {
  const [tick, setTick] = useState(0);

  // Lightweight 1s tick to keep panel in sync with wall-clock
  useEffect(() => {
    const id = window.setInterval(() => {
      setTick((t) => t + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  const { nowPlaying, queueTimings } = useMemo(() => {
    const now = new Date();

    let nowStart: Date | null = null;
    let nowEnd: Date | null = null;

    if (currentTrack && currentQueueItemId) {
      // Anchor the start time to the original nowPlayingStart so the
      // operator sees when the song began. Seeking should only adjust
      // the expected end time (and therefore the timing of subsequent
      // queue items), not rewrite the displayed start.
      const baseStart = nowPlayingStart ?? now;
      const total = adjustedDurationSeconds(currentTrack, crossfadeSeconds);
      const effectiveTotal = Math.max(0, total);

      let remaining: number;

      if (!seekAnchor) {
        // No active seek override: derive remaining time from how long the
        // track has actually been playing according to wall-clock.
        const elapsedMs = Math.max(0, now.getTime() - baseStart.getTime());
        const elapsedSec = Math.min(effectiveTotal, Math.floor(elapsedMs / 1000));
        remaining = Math.max(0, effectiveTotal - elapsedSec);
      } else {
        // Seek override: keep the start time immutable, but recompute the
        // remaining time based on the playhead at the seek moment plus any
        // elapsed time since then.
        const rawSeek = seekAnchor.seconds;
        const clampedSeek = Math.max(0, Math.min(rawSeek, effectiveTotal));
        const elapsedSinceSeekSeconds = isPlaying
          ? Math.max(0, Math.floor((now.getTime() - seekAnchor.at.getTime()) / 1000))
          : 0;
        const playheadSeconds = Math.min(effectiveTotal, clampedSeek + elapsedSinceSeekSeconds);
        remaining = effectiveTotal > 0 ? Math.max(0, effectiveTotal - playheadSeconds) : 0;
      }

      nowStart = baseStart;
      nowEnd = new Date(now.getTime() + remaining * 1000);
    }

    const np: NowPlayingTiming = {
      track: currentTrack,
      start: nowStart,
      end: nowEnd,
    };

    // Future queue: start after nowEnd if available, otherwise start now.
    // IMPORTANT: do NOT include the currently playing item in queueTimings,
    // otherwise every downstream item gets shifted by one track.
    let cursor = nowEnd ?? now;

    const qTimings: QueueItemTiming[] = [];
    const currentIndex = currentQueueItemId
      ? queue.findIndex((item) => item.id === currentQueueItemId)
      : -1;
    const startIndex = currentIndex >= 0 ? currentIndex + 1 : 0;

    for (let index = startIndex; index < queue.length; index += 1) {
      const item = queue[index];
      const adj = adjustedDurationSeconds(item.track, crossfadeSeconds);
      const start = cursor;
      const end = adj > 0 ? new Date(start.getTime() + adj * 1000) : start;
      qTimings.push({ item, index, start, end });
      cursor = end;
    }

    return { nowPlaying: np, queueTimings: qTimings };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    queue,
    currentTrack,
    currentQueueItemId,
    isPlaying,
    nowPlayingStart,
    crossfadeSeconds,
    seekAnchor,
    tick,
  ]);

  return { nowPlaying, queueTimings };
}

import { useEffect, useMemo, useState } from 'react';
import { QueueItem, Track } from '../types';

interface UseQueueTimingInput {
  queue: QueueItem[];
  currentTrack: Track | null;
  currentTrackId: string | null;
  isPlaying: boolean;
  nowPlayingStart: Date | null;
  crossfadeSeconds: number;
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
  currentTrackId,
  isPlaying,
  nowPlayingStart,
  crossfadeSeconds,
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

    if (currentTrack && currentTrackId) {
      // Always derive timing from nowPlayingStart when available so that
      // seeking within the track immediately re-anchors both the current
      // song and all subsequent queue items, regardless of play/pause
      // state. Fall back to the current wall-clock only if we do not yet
      // have a stable nowPlayingStart.
      const baseStart = nowPlayingStart ?? now;
      const adj = adjustedDurationSeconds(currentTrack, crossfadeSeconds);
      nowStart = baseStart;
      nowEnd = new Date(baseStart.getTime() + adj * 1000);
    }

    const np: NowPlayingTiming = {
      track: currentTrack,
      start: nowStart,
      end: nowEnd,
    };

    // Future queue: start after nowEnd if available, otherwise start now
    let cursor = nowEnd ?? now;

    const qTimings: QueueItemTiming[] = [];

    queue.forEach((item, index) => {
      const adj = adjustedDurationSeconds(item.track, crossfadeSeconds);
      const start = cursor;
      const end = adj > 0 ? new Date(start.getTime() + adj * 1000) : start;
      qTimings.push({ item, index, start, end });
      cursor = end;
    });

    return { nowPlaying: np, queueTimings: qTimings };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    queue,
    currentTrack,
    currentTrackId,
    isPlaying,
    nowPlayingStart,
    crossfadeSeconds,
    tick,
  ]);

  return { nowPlaying, queueTimings };
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Scissors } from 'lucide-react';
import { Track } from '../types';
import { resolveUploadsUrl } from '../services/api';
import { Button } from './ui/button';
import { StepperInput } from './ui/stepper-input';
import { Slider } from './ui/slider';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { tracksAPI } from '../services/api';
import { ConfirmDialog } from './ConfirmDialog';

type SilenceDetectionResult = {
  leadingSilenceSeconds: number;
  trailingSilenceSeconds: number;
};

type Segment = { startSeconds: number; endSeconds: number };

type EditSnapshot = {
  segments: Segment[];
  startSeconds: number;
  endSeconds: number;
  playheadSeconds: number;
  zoomWindowSeconds: number;
};

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

function splitSegmentsAtTime(segments: Segment[], t: number): Segment[] {
  const out: Segment[] = [];
  let didSplit = false;

  for (const s of segments) {
    if (t <= s.startSeconds || t >= s.endSeconds) {
      out.push(s);
      continue;
    }

    // split
    didSplit = true;
    out.push({ startSeconds: s.startSeconds, endSeconds: roundMs(t) });
    out.push({ startSeconds: roundMs(t), endSeconds: s.endSeconds });
  }

  if (!didSplit) return segments;
  return out
    .filter((s) => s.endSeconds - s.startSeconds > 0.001)
    .sort((a, b) => a.startSeconds - b.startSeconds);
}

function segmentContainsTime(seg: Segment, t: number) {
  return t >= seg.startSeconds && t < seg.endSeconds;
}

function roundMs(v: number) {
  return Math.round(v * 1000) / 1000;
}

function subtractRangeFromSegments(segments: Segment[], cut: Segment): Segment[] {
  const cutStart = Math.min(cut.startSeconds, cut.endSeconds);
  const cutEnd = Math.max(cut.startSeconds, cut.endSeconds);

  const out: Segment[] = [];
  for (const s of segments) {
    const sStart = Math.min(s.startSeconds, s.endSeconds);
    const sEnd = Math.max(s.startSeconds, s.endSeconds);

    // no overlap
    if (cutEnd <= sStart || cutStart >= sEnd) {
      out.push({ startSeconds: sStart, endSeconds: sEnd });
      continue;
    }

    // left remainder
    if (cutStart > sStart) {
      out.push({ startSeconds: sStart, endSeconds: cutStart });
    }
    // right remainder
    if (cutEnd < sEnd) {
      out.push({ startSeconds: cutEnd, endSeconds: sEnd });
    }
  }

  return out
    .map((s) => ({ startSeconds: roundMs(s.startSeconds), endSeconds: roundMs(s.endSeconds) }))
    .filter((s) => s.endSeconds - s.startSeconds > 0.001)
    .sort((a, b) => a.startSeconds - b.startSeconds);
}

async function decodeToAudioBuffer(url: string, signal?: AbortSignal): Promise<AudioBuffer> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`Failed to fetch audio (${res.status})`);
  }
  const arr = await res.arrayBuffer();
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  try {
    const buf = await ctx.decodeAudioData(arr.slice(0));
    return buf;
  } finally {
    ctx.close().catch(() => {
      // ignore
    });
  }
}

function detectSilence(buffer: AudioBuffer, opts: { threshold: number; minSilenceSeconds: number }): SilenceDetectionResult {
  const threshold = Math.max(0, Math.min(1, opts.threshold));
  const minSilenceSamples = Math.max(1, Math.floor(opts.minSilenceSeconds * buffer.sampleRate));

  const channels = Math.max(1, buffer.numberOfChannels);
  const len = buffer.length;

  const sampleIsSilent = (i: number) => {
    for (let c = 0; c < channels; c += 1) {
      const data = buffer.getChannelData(c);
      if (Math.abs(data[i] || 0) > threshold) return false;
    }
    return true;
  };

  let lead = 0;
  let silentRun = 0;
  for (let i = 0; i < len; i += 1) {
    if (sampleIsSilent(i)) {
      silentRun += 1;
    } else {
      if (silentRun >= minSilenceSamples) {
        lead += silentRun;
      }
      break;
    }
  }

  let trail = 0;
  silentRun = 0;
  for (let i = len - 1; i >= 0; i -= 1) {
    if (sampleIsSilent(i)) {
      silentRun += 1;
    } else {
      if (silentRun >= minSilenceSamples) {
        trail += silentRun;
      }
      break;
    }
  }

  return {
    leadingSilenceSeconds: lead / buffer.sampleRate,
    trailingSilenceSeconds: trail / buffer.sampleRate,
  };
}

export function EditSongDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  track: Track;
  onTrackUpdated?: (track: Track) => void;
}) {
  const { open, onOpenChange, track, onTrackUpdated } = props;

  const [startSeconds, setStartSeconds] = useState(0);
  const [endSeconds, setEndSeconds] = useState<number>(() => Math.max(0, Number(track.duration || 0)));

  const [segments, setSegments] = useState<Segment[]>([{ startSeconds: 0, endSeconds: Math.max(0, Number(track.duration || 0)) }]);

  const [autoSkipEnabled, setAutoSkipEnabled] = useState(false);
  const [autoSkipPadSeconds, setAutoSkipPadSeconds] = useState(0);

  const [autoGapEnabled, setAutoGapEnabled] = useState(false);
  const [autoGapPadSeconds, setAutoGapPadSeconds] = useState(0);

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<SilenceDetectionResult | null>(null);

  const [devices, setDevices] = useState<Array<{ deviceId: string; label: string }>>([]);
  const [testDeviceId, setTestDeviceId] = useState<string>('default');

  const [isTesting, setIsTesting] = useState(false);
  const testAudioRef = useRef<HTMLAudioElement | null>(null);

  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const waveformCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [waveformPeaks, setWaveformPeaks] = useState<Float32Array | null>(null);
  const [isWaveformLoading, setIsWaveformLoading] = useState(false);
  const waveformDrawRafRef = useRef<number | null>(null);

  const [playheadSeconds, setPlayheadSeconds] = useState(0);
  const [zoomWindowSeconds, setZoomWindowSeconds] = useState<number>(() => Math.max(5, Math.min(30, Number(track.duration || 0) || 30)));
  const [activeEditTarget, setActiveEditTarget] = useState<'start' | 'end'>('start');
  const isScrubbingRef = useRef(false);
  const keyScopeRef = useRef<HTMLDivElement | null>(null);

  const historyRef = useRef<{ past: EditSnapshot[]; future: EditSnapshot[] }>({ past: [], future: [] });

  const duration = useMemo(() => Math.max(0, Number(track.duration || 0)), [track.duration]);

  const editedDuration = useMemo(() => {
    return segments.reduce((sum, s) => sum + Math.max(0, s.endSeconds - s.startSeconds), 0);
  }, [segments]);

  useEffect(() => {
    if (!open) return;
    setStartSeconds(0);
    setEndSeconds(duration);
    setSegments([{ startSeconds: 0, endSeconds: duration }]);
    setPlayheadSeconds(0);
    setZoomWindowSeconds(Math.max(5, Math.min(30, duration || 30)));
    setActiveEditTarget('start');
    historyRef.current = { past: [], future: [] };
    setAutoSkipEnabled(false);
    setAutoGapEnabled(false);
    setAutoSkipPadSeconds(0);
    setAutoGapPadSeconds(0);
    setAnalysis(null);

    // Ensure the dialog captures keyboard shortcuts and blocks background hotkeys.
    window.setTimeout(() => {
      keyScopeRef.current?.focus();
    }, 0);
  }, [duration, open]);

  const snapshotCurrent = useCallback((): EditSnapshot => {
    return {
      segments: segments.map((s) => ({ startSeconds: s.startSeconds, endSeconds: s.endSeconds })),
      startSeconds,
      endSeconds,
      playheadSeconds,
      zoomWindowSeconds,
    };
  }, [endSeconds, playheadSeconds, segments, startSeconds, zoomWindowSeconds]);

  const restoreSnapshot = useCallback((snap: EditSnapshot) => {
    setSegments(snap.segments);
    setStartSeconds(snap.startSeconds);
    setEndSeconds(snap.endSeconds);
    setPlayheadSeconds(snap.playheadSeconds);
    setZoomWindowSeconds(snap.zoomWindowSeconds);
  }, []);

  const commitEdit = useCallback(
    (apply: () => void) => {
      const hist = historyRef.current;
      hist.past.push(snapshotCurrent());
      hist.future = [];
      apply();
    },
    [snapshotCurrent],
  );

  const canUndo = historyRef.current.past.length > 0;
  const canRedo = historyRef.current.future.length > 0;

  const handleUndo = useCallback(() => {
    const hist = historyRef.current;
    const prev = hist.past.pop();
    if (!prev) return;
    hist.future.push(snapshotCurrent());
    restoreSnapshot(prev);
  }, [restoreSnapshot, snapshotCurrent]);

  const handleRedo = useCallback(() => {
    const hist = historyRef.current;
    const next = hist.future.pop();
    if (!next) return;
    hist.past.push(snapshotCurrent());
    restoreSnapshot(next);
  }, [restoreSnapshot, snapshotCurrent]);

  const loadAudioForAnalysis = useCallback(async () => {
    if (!open) return;
    if (audioBuffer) return;
    const url = resolveUploadsUrl(track.filePath);
    const controller = new AbortController();
    setIsWaveformLoading(true);
    try {
      const buf = await decodeToAudioBuffer(url, controller.signal);
      setAudioBuffer(buf);
      return buf;
    } catch {
      return null;
    } finally {
      setIsWaveformLoading(false);
    }
  }, [audioBuffer, open, track.filePath]);

  useEffect(() => {
    if (!open) return;
    void loadAudioForAnalysis();
  }, [loadAudioForAnalysis, open]);

  useEffect(() => {
    const canvas = waveformCanvasRef.current;
    const buf = audioBuffer;
    if (!open || !canvas || !buf) return;

    const resize = () => {
      const width = Math.max(600, Math.floor(canvas.clientWidth || 0));
      const height = Math.max(90, Math.floor(canvas.clientHeight || 0));
      canvas.width = width;
      canvas.height = height;

      const samplesPerBucket = Math.max(1, Math.floor(buf.length / width));
      const peaks = new Float32Array(width);
      const channels = Math.max(1, buf.numberOfChannels);
      for (let x = 0; x < width; x += 1) {
        const start = x * samplesPerBucket;
        const end = Math.min(buf.length, start + samplesPerBucket);
        let peak = 0;
        for (let i = start; i < end; i += 1) {
          let v = 0;
          for (let c = 0; c < channels; c += 1) {
            const data = buf.getChannelData(c);
            v = Math.max(v, Math.abs(data[i] || 0));
          }
          if (v > peak) peak = v;
        }
        peaks[x] = peak;
      }
      setWaveformPeaks(peaks);
    };

    resize();
    const ro = new ResizeObserver(() => resize());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [audioBuffer, open]);

  const effectiveStart = Math.max(0, Math.min(startSeconds, duration));
  const effectiveEnd = Math.max(effectiveStart, Math.min(endSeconds, duration));

  const viewRange = useMemo(() => {
    const center = clamp(playheadSeconds || (effectiveStart + effectiveEnd) / 2, 0, duration);
    const windowSec = clamp(zoomWindowSeconds, 1, Math.max(1, duration));
    const half = windowSec / 2;
    const start = clamp(center - half, 0, Math.max(0, duration - windowSec));
    const end = Math.min(duration, start + windowSec);
    return { start, end };
  }, [duration, effectiveEnd, effectiveStart, playheadSeconds, zoomWindowSeconds]);

  const drawWaveform = useCallback(() => {
    const canvas = waveformCanvasRef.current;
    const peaks = waveformPeaks;
    if (!open || !canvas || !peaks) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    // background
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillRect(0, 0, w, h);

    const mid = Math.floor(h / 2);
    const ampScale = (h / 2) * 0.92;

    // draw cut mask first (areas not in segments are slightly dimmed)
    ctx.fillStyle = 'rgba(128,128,128,0.10)';
    ctx.fillRect(0, 0, w, h);

    const toX = (sec: number) => {
      const { start, end } = viewRange;
      const span = Math.max(0.001, end - start);
      const t = (sec - start) / span;
      return clamp(Math.round(t * w), 0, w);
    };

    const toAbsSec = (x: number) => {
      const { start, end } = viewRange;
      const span = Math.max(0.001, end - start);
      return start + (clamp(x, 0, w) / w) * span;
    };

    // clear mask for kept segments (within current view range)
    ctx.globalCompositeOperation = 'destination-out';
    for (const s of segments) {
      const x1 = toX(s.startSeconds);
      const x2 = toX(s.endSeconds);
      ctx.fillRect(x1, 0, Math.max(1, x2 - x1), h);
    }
    ctx.globalCompositeOperation = 'source-over';

    // waveform
    ctx.strokeStyle = 'rgba(30, 64, 175, 0.85)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < w; x += 1) {
      const absSec = toAbsSec(x);
      const srcX = duration > 0 ? Math.floor((absSec / duration) * peaks.length) : 0;
      const peak = peaks[clamp(srcX, 0, peaks.length - 1)] || 0;
      const y = Math.max(1, Math.floor(peak * ampScale));
      ctx.moveTo(x + 0.5, mid - y);
      ctx.lineTo(x + 0.5, mid + y);
    }
    ctx.stroke();

    // selection overlay
    const selX1 = toX(startSeconds);
    const selX2 = toX(endSeconds);
    const left = Math.min(selX1, selX2);
    const right = Math.max(selX1, selX2);
    ctx.fillStyle = 'rgba(34, 197, 94, 0.12)';
    ctx.fillRect(left, 0, Math.max(1, right - left), h);
    ctx.fillStyle = 'rgba(34, 197, 94, 0.55)';
    ctx.fillRect(left, 0, 1, h);
    ctx.fillRect(right, 0, 1, h);

    // playhead
    const ph = toX(playheadSeconds);
    ctx.fillStyle = 'rgba(249, 115, 22, 0.9)';
    ctx.fillRect(ph, 0, 1, h);
  }, [duration, endSeconds, open, segments, startSeconds, waveformPeaks, playheadSeconds, viewRange]);

  useEffect(() => {
    if (!open) return;
    if (waveformDrawRafRef.current) {
      cancelAnimationFrame(waveformDrawRafRef.current);
      waveformDrawRafRef.current = null;
    }
    waveformDrawRafRef.current = requestAnimationFrame(() => {
      waveformDrawRafRef.current = null;
      drawWaveform();
    });
    return () => {
      if (waveformDrawRafRef.current) {
        cancelAnimationFrame(waveformDrawRafRef.current);
        waveformDrawRafRef.current = null;
      }
    };
  }, [drawWaveform, open]);

  const enumerateOutputs = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setDevices([]);
      return;
    }
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      const outputs = list
        .filter((d) => d.kind === 'audiooutput' && d.deviceId)
        .filter((d) => d.deviceId !== 'communications')
        .map((d) => ({ deviceId: d.deviceId, label: d.label || `Audio output (${d.deviceId.slice(0, 6)})` }));
      setDevices(outputs);
    } catch {
      setDevices([]);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void enumerateOutputs();
  }, [enumerateOutputs, open]);

  const applyTestSink = useCallback(async () => {
    const el = testAudioRef.current as any;
    if (!el) return;
    if (typeof el.setSinkId !== 'function') return;
    try {
      await el.setSinkId(testDeviceId);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to set output device for test');
    }
  }, [testDeviceId]);

  useEffect(() => {
    if (!open) return;
    void applyTestSink();
  }, [applyTestSink, open]);

  const analyzeSilence = useCallback(async () => {
    const url = resolveUploadsUrl(track.filePath);
    const controller = new AbortController();
    setIsAnalyzing(true);
    try {
      const buffer = audioBuffer ?? (await decodeToAudioBuffer(url, controller.signal));
      if (!audioBuffer) setAudioBuffer(buffer);
      const result = detectSilence(buffer, { threshold: 0.0025, minSilenceSeconds: 0.08 });
      setAnalysis(result);
      return result;
    } catch (e: any) {
      toast.error(e?.message || 'Failed to analyze audio');
      return null;
    } finally {
      setIsAnalyzing(false);
    }
  }, [audioBuffer, track.filePath]);

  const handleAutoSkip = useCallback(async () => {
    setAutoSkipEnabled((prev) => !prev);
    const nextEnabled = !autoSkipEnabled;
    if (!nextEnabled) return;

    const res = analysis ?? (await analyzeSilence());
    if (!res) return;

    const detected = Math.max(0, res.leadingSilenceSeconds);
    const nextStart = Math.min(duration, Math.max(0, Math.floor(detected + autoSkipPadSeconds)));
    setStartSeconds(nextStart);
  }, [analysis, analyzeSilence, autoSkipEnabled, autoSkipPadSeconds, duration]);

  const handleAutoGap = useCallback(async () => {
    setAutoGapEnabled((prev) => !prev);
    const nextEnabled = !autoGapEnabled;
    if (!nextEnabled) return;

    const res = analysis ?? (await analyzeSilence());
    if (!res) return;

    const detected = Math.max(0, res.trailingSilenceSeconds);
    const nextEnd = Math.max(0, Math.min(duration, Math.floor(duration - detected - autoGapPadSeconds)));
    setEndSeconds(Math.max(nextEnd, startSeconds));
  }, [analysis, analyzeSilence, autoGapEnabled, autoGapPadSeconds, duration, startSeconds]);

  const handleNextCut = useCallback(() => {
    if (effectiveEnd - effectiveStart <= 0.001) {
      toast.error('Select a non-zero range to cut');
      return;
    }
    commitEdit(() => {
      setSegments((prev) => {
        const next = subtractRangeFromSegments(prev, { startSeconds: effectiveStart, endSeconds: effectiveEnd });
        if (next.length === 0) {
          toast.error('Cut would remove the entire track');
          return prev;
        }
        return next;
      });
    });
  }, [effectiveEnd, effectiveStart]);

  const handleDeleteSelection = useCallback(() => {
    handleNextCut();
  }, [handleNextCut]);

  const handleSplitAtPlayhead = useCallback(() => {
    const t = roundMs(clamp(playheadSeconds, 0, duration));
    commitEdit(() => {
      setSegments((prev) => {
        const next = splitSegmentsAtTime(prev, t);
        if (next === prev) {
          toast.error('Playhead is not inside a kept segment');
          return prev;
        }
        return next;
      });
    });
  }, [commitEdit, duration, playheadSeconds]);

  const handleResetEdits = useCallback(() => {
    commitEdit(() => {
      setSegments([{ startSeconds: 0, endSeconds: duration }]);
      setStartSeconds(0);
      setEndSeconds(duration);
      setPlayheadSeconds(0);
      setZoomWindowSeconds(Math.max(5, Math.min(30, duration || 30)));
      setActiveEditTarget('start');
    });
  }, [commitEdit, duration]);

  const handleDialogKeyDownCapture = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      // Block all key events from reaching window-level handlers (background hotkeys).
      e.stopPropagation();

      // Allow IME composition.
      if ((e as any).isComposing) return;

      // Undo/Redo
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        handleRedo();
        return;
      }

      // Delete selection
      if (e.key === 'Delete') {
        e.preventDefault();
        handleDeleteSelection();
        return;
      }

      // Nudge selection points
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (e.metaKey) return;
        const dir = e.key === 'ArrowLeft' ? -1 : 1;
        const step = e.shiftKey ? 0.01 : e.ctrlKey ? 0.1 : 0.001;
        const delta = dir * step;
        e.preventDefault();

        if (activeEditTarget === 'start') {
          setStartSeconds((prev) => roundMs(clamp(prev + delta, 0, duration)));
        } else {
          setEndSeconds((prev) => roundMs(clamp(prev + delta, 0, duration)));
        }
      }
    },
    [activeEditTarget, duration, handleDeleteSelection, handleRedo, handleUndo],
  );

  const nextKeptStartAtOrAfter = useCallback((t: number) => {
    for (const s of segments) {
      if (t < s.startSeconds) return s.startSeconds;
      if (t >= s.startSeconds && t < s.endSeconds) return t;
    }
    return null;
  }, [segments]);

  const nextSegmentAfterTime = useCallback((t: number) => {
    for (const s of segments) {
      if (t < s.startSeconds) return s;
      if (t >= s.startSeconds && t < s.endSeconds) return s;
    }
    return null;
  }, [segments]);

  const handleTest = useCallback(async () => {
    const el = testAudioRef.current;
    if (!el) return;

    const url = resolveUploadsUrl(track.filePath);
    setIsTesting(true);
    try {
      el.pause();
      el.src = url;
      await applyTestSink();

      const previewStart = nextKeptStartAtOrAfter(effectiveStart);
      if (previewStart === null) {
        toast.error('Nothing to preview after current edits');
        return;
      }

      const previewEnd = effectiveEnd;

      let rafId = 0;
      const tick = () => {
        rafId = requestAnimationFrame(tick);

        // Prefer rAF checks for segment skipping; timeupdate can be coarse.
        const t = el.currentTime;
        if (!isScrubbingRef.current) setPlayheadSeconds(t);

        if (Number.isFinite(previewEnd) && t >= previewEnd) {
          el.pause();
          cancelAnimationFrame(rafId);
          return;
        }

        const seg = nextSegmentAfterTime(t);
        if (!seg) {
          el.pause();
          cancelAnimationFrame(rafId);
          return;
        }

        if (t < seg.startSeconds) {
          try {
            el.currentTime = seg.startSeconds;
          } catch {
            // ignore
          }
          return;
        }

        if (t >= seg.endSeconds) {
          const next = nextSegmentAfterTime(seg.endSeconds + 0.0005);
          if (!next) {
            el.pause();
            cancelAnimationFrame(rafId);
            return;
          }
          try {
            el.currentTime = next.startSeconds;
          } catch {
            // ignore
          }
        }
      };

      const onLoaded = async () => {
        try {
          el.currentTime = previewStart;
        } catch {
          // ignore
        }
        try {
          await el.play();
        } catch {
          // ignore
        }
      };

      el.addEventListener('loadedmetadata', onLoaded, { once: true });
      rafId = requestAnimationFrame(tick);

      const cleanup = () => {
        if (rafId) cancelAnimationFrame(rafId);
      };

      window.setTimeout(cleanup, Math.max(250, (previewEnd - previewStart) * 1000 + 750));
    } finally {
      setIsTesting(false);
    }
  }, [applyTestSink, effectiveEnd, effectiveStart, nextKeptStartAtOrAfter, nextSegmentAfterTime, track.filePath]);

  const [isSaving, setIsSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const triggerSave = useCallback(() => {
    if (segments.length === 0) {
      toast.error('No remaining audio after cuts');
      return;
    }
    setConfirmOpen(true);
  }, [segments.length]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      const updated = await tracksAPI.edit(track.id, {
        segments,
        autoSkipEnabled,
        autoGapEnabled,
      });
      toast.success('Song updated');
      if (onTrackUpdated) {
        const t: any = updated as any;
        onTrackUpdated({
          id: String(t.id),
          name: String(t.name || ''),
          artist: String(t.artist || ''),
          duration: Number(t.duration || 0),
          size: Number(t.size || 0),
          filePath: String(t.filePath || t.file_path || track.filePath),
          hash: String(t.hash || ''),
          dateAdded: t.dateAdded ? new Date(t.dateAdded) : t.date_added ? new Date(t.date_added) : track.dateAdded,
        });
      }
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save song edits');
    } finally {
      setIsSaving(false);
    }
  }, [autoGapEnabled, autoSkipEnabled, onOpenChange, onTrackUpdated, segments, track.dateAdded, track.filePath, track.id]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit Song</DialogTitle>
          <DialogDescription>{track.name}</DialogDescription>
        </DialogHeader>

        <ConfirmDialog
          open={confirmOpen}
          title="Overwrite this audio file?"
          description={`This will permanently overwrite the existing file on disk.\n\nEdited length: ${editedDuration.toFixed(3)}s`}
          confirmLabel="Overwrite"
          cancelLabel="Cancel"
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => {
            setConfirmOpen(false);
            void handleSave();
          }}
        />

        <audio ref={testAudioRef} className="hidden" />

        <div
          ref={keyScopeRef}
          tabIndex={0}
          className="space-y-4 outline-none"
          onKeyDownCapture={handleDialogKeyDownCapture}
        >
          <div className="rounded-md border bg-popover p-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium">Waveform</div>
              <div className="text-[11px] text-muted-foreground">
                {isWaveformLoading ? 'Loading…' : `Kept: ${editedDuration.toFixed(3)}s / ${duration.toFixed(3)}s`}
              </div>
            </div>
            <div className="my-2 h-px bg-border" />
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-[11px]"
                  onClick={() => setZoomWindowSeconds((prev) => clamp(prev / 1.5, 1, Math.max(1, duration)))}
                >
                  Zoom In
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-[11px]"
                  onClick={() => setZoomWindowSeconds((prev) => clamp(prev * 1.5, 1, Math.max(1, duration)))}
                >
                  Zoom Out
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-[11px]"
                  onClick={() => setPlayheadSeconds(clamp((effectiveStart + effectiveEnd) / 2, 0, duration))}
                >
                  Center
                </Button>
              </div>
              <div className="text-[11px] text-muted-foreground">
                View {viewRange.start.toFixed(3)}s–{viewRange.end.toFixed(3)}s
              </div>
            </div>
            <div className="w-full">
              <canvas
                ref={waveformCanvasRef}
                className="w-full h-[96px] cursor-crosshair"
                onMouseDown={(e) => {
                  const canvas = waveformCanvasRef.current;
                  const el = testAudioRef.current;
                  if (!canvas) return;
                  const rect = canvas.getBoundingClientRect();
                  const x = e.clientX - rect.left;
                  const w = rect.width || 1;
                  const t = viewRange.start + (clamp(x, 0, w) / w) * (viewRange.end - viewRange.start);
                  const next = roundMs(clamp(t, 0, duration));
                  isScrubbingRef.current = true;
                  setPlayheadSeconds(next);
                  if (el) {
                    try {
                      el.currentTime = next;
                    } catch {
                      // ignore
                    }
                  }
                }}
                onMouseMove={(e) => {
                  if (!isScrubbingRef.current) return;
                  const canvas = waveformCanvasRef.current;
                  const el = testAudioRef.current;
                  if (!canvas) return;
                  const rect = canvas.getBoundingClientRect();
                  const x = e.clientX - rect.left;
                  const w = rect.width || 1;
                  const t = viewRange.start + (clamp(x, 0, w) / w) * (viewRange.end - viewRange.start);
                  const next = roundMs(clamp(t, 0, duration));
                  setPlayheadSeconds(next);
                  if (el) {
                    try {
                      el.currentTime = next;
                    } catch {
                      // ignore
                    }
                  }
                }}
                onMouseUp={() => {
                  isScrubbingRef.current = false;
                }}
                onMouseLeave={() => {
                  isScrubbingRef.current = false;
                }}
                onDoubleClick={() => {
                  const el = testAudioRef.current;
                  if (!el) return;
                  if (!segmentContainsTime({ startSeconds: effectiveStart, endSeconds: effectiveEnd }, playheadSeconds)) {
                    return;
                  }
                }}
              />
            </div>
            <div className="mt-3 space-y-2">
              <div className="text-[11px] text-muted-foreground">Trim selection (ms precision)</div>
              <Slider
                value={[effectiveStart, effectiveEnd]}
                min={0}
                max={duration}
                step={0.001}
                onValueChange={(v) => {
                  const s = roundMs(Number(v?.[0] ?? 0));
                  const e = roundMs(Number(v?.[1] ?? 0));
                  setStartSeconds(clamp(s, 0, duration));
                  setEndSeconds(clamp(e, 0, duration));
                }}
              />
              <div className="flex items-center justify-between">
                <div className="text-[11px] text-muted-foreground">{effectiveStart.toFixed(3)}s</div>
                <div className="text-[11px] text-muted-foreground">{effectiveEnd.toFixed(3)}s</div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="text-xs font-medium">Start point (sec)</div>
              <div onFocusCapture={() => setActiveEditTarget('start')}>
                <StepperInput value={startSeconds} min={0} max={duration} step={0.001} showButtons={false} onChange={(v) => setStartSeconds(roundMs(v))} />
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-xs font-medium">End point (sec)</div>
              <div onFocusCapture={() => setActiveEditTarget('end')}>
                <StepperInput value={endSeconds} min={0} max={duration} step={0.001} showButtons={false} onChange={(v) => setEndSeconds(roundMs(v))} />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border bg-popover p-3">
            <div className="space-y-0.5">
              <div className="text-xs font-medium">Cut tools</div>
              <div className="text-[11px] text-muted-foreground">Cuts are non-destructive until you Save.</div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 px-2 text-xs"
                disabled={!canUndo}
                onClick={handleUndo}
              >
                Undo
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 px-2 text-xs"
                disabled={!canRedo}
                onClick={handleRedo}
              >
                Redo
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 px-2 text-xs"
                onClick={handleSplitAtPlayhead}
              >
                Split
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 px-2 text-xs"
                onClick={handleDeleteSelection}
              >
                <Scissors className="h-3.5 w-3.5 mr-1" />
                Delete
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 px-2 text-xs"
                onClick={handleResetEdits}
              >
                Reset
              </Button>
            </div>
          </div>

          <div className="rounded-md border bg-popover p-3">
            <div className="text-xs font-medium">Auto controls</div>
            <div className="my-2 h-px bg-border" />
            <div className="grid grid-cols-[1fr,auto] items-center gap-x-3 gap-y-3">
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={autoSkipEnabled ? 'default' : 'outline'}
                  className="h-8 px-2 text-xs"
                  disabled={isAnalyzing}
                  onClick={() => void handleAutoSkip()}
                >
                  Auto Skip
                </Button>
                <div className="text-[11px] text-muted-foreground">+ sec</div>
                <StepperInput value={autoSkipPadSeconds} min={0} max={8} step={1} showButtons={false} onChange={setAutoSkipPadSeconds} />
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 px-2 text-xs justify-start"
                disabled={isAnalyzing}
                onClick={() => void analyzeSilence()}
              >
                {isAnalyzing ? 'Analyzing…' : 'Analyze'}
              </Button>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={autoGapEnabled ? 'default' : 'outline'}
                  className="h-8 px-2 text-xs"
                  disabled={isAnalyzing}
                  onClick={() => void handleAutoGap()}
                >
                  Auto Gap
                </Button>
                <div className="text-[11px] text-muted-foreground">+ sec</div>
                <StepperInput value={autoGapPadSeconds} min={0} max={8} step={1} showButtons={false} onChange={setAutoGapPadSeconds} />
              </div>
              <div className="text-[11px] text-muted-foreground text-right">
                {analysis ? `Lead ${analysis.leadingSilenceSeconds.toFixed(2)}s • Tail ${analysis.trailingSilenceSeconds.toFixed(2)}s` : ''}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 items-end">
            <div className="space-y-2">
              <div className="text-xs font-medium">Test output device</div>
              <Select value={testDeviceId} onValueChange={(v) => setTestDeviceId(v)}>
                <SelectTrigger size="sm" className="h-9 text-xs">
                  <SelectValue placeholder="System default" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">System default (OS)</SelectItem>
                  {devices.map((d) => (
                    <SelectItem key={d.deviceId} value={d.deviceId}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" className="h-9" disabled={isTesting} onClick={() => void handleTest()}>
                Test
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button type="button" onClick={triggerSave} disabled={isSaving}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

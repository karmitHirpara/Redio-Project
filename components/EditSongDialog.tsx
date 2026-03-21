import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Track } from '../types';
import { resolveUploadsUrl, tracksAPI } from '../services/api';
import { Button } from './ui/button';
import { StepperInput } from './ui/stepper-input';
import { Slider } from './ui/slider';
import { Switch } from './ui/switch';
import { Label } from './ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { ConfirmDialog } from './ConfirmDialog';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

type SilenceDetectionResult = {
  leadingSilenceSeconds: number;
  trailingSilenceSeconds: number;
};

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

function roundMs(v: number) {
  return Math.round(v * 1000) / 1000;
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
    ctx.close().catch(() => { });
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
      if (silentRun >= minSilenceSamples) lead += silentRun;
      break;
    }
  }

  let trail = 0;
  silentRun = 0;
  for (let i = len - 1; i >= 0; i -= 1) {
    if (sampleIsSilent(i)) {
      silentRun += 1;
    } else {
      if (silentRun >= minSilenceSamples) trail += silentRun;
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
  playlistContext?: { playlistId: string; position: number };
}) {
  const { open, onOpenChange, track, onTrackUpdated, playlistContext } = props;
  const isDark = typeof window !== 'undefined' && document.documentElement.classList.contains('dark');
  const theme = isDark ? 'dark' : 'light';
  const reduceMotion = useReducedMotion() ?? false;

  const duration = useMemo(() => Math.max(0, Number(track.duration || 0)), [track.duration]);

  const [startSeconds, setStartSeconds] = useState(0);
  const [endSeconds, setEndSeconds] = useState<number>(() => Math.max(0, Number(track.duration || 0)));

  // Adobe-express/RadioDJ style auto-skip
  const [autoRemoveSilence, setAutoRemoveSilence] = useState(true);
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

  const editedDuration = Math.max(0, endSeconds - startSeconds);

  // Analyze audio automatically when opened
  useEffect(() => {
    if (!open) return;
    setStartSeconds(0);
    setEndSeconds(duration);
    setPlayheadSeconds(0);
    setAutoRemoveSilence(true);
    setAnalysis(null);

    let isSubscribed = true;
    const controller = new AbortController();

    setIsWaveformLoading(true);
    const url = resolveUploadsUrl(track.filePath);

    decodeToAudioBuffer(url, controller.signal)
      .then((buf) => {
        if (!isSubscribed) return;
        setAudioBuffer(buf);

        // As soon as we have the buffer, run silence detection
        const result = detectSilence(buf, { threshold: 0.0025, minSilenceSeconds: 0.08 });
        setAnalysis(result);

        // Automatically snap
        if (autoRemoveSilence) {
          const skipStart = Math.min(duration, Math.max(0, result.leadingSilenceSeconds));
          const skipEnd = Math.max(0, Math.min(duration, duration - result.trailingSilenceSeconds));
          setStartSeconds(skipStart);
          setEndSeconds(Math.max(skipEnd, skipStart));
        }
      })
      .catch(() => {
        if (!isSubscribed) return;
        toast.error('Failed to load audio for analysis');
      })
      .finally(() => {
        if (isSubscribed) setIsWaveformLoading(false);
      });

    return () => {
      isSubscribed = false;
      controller.abort();
    };
  }, [duration, open, track.filePath]); // autoRemoveSilence deliberately omitted to only snap on initial mount/load


  // Handle Toggle Switch for Auto Silence
  useEffect(() => {
    if (!open || !analysis) return;
    if (autoRemoveSilence) {
      const skipStart = Math.min(duration, Math.max(0, analysis.leadingSilenceSeconds));
      const skipEnd = Math.max(0, Math.min(duration, duration - analysis.trailingSilenceSeconds));
      setStartSeconds(skipStart);
      setEndSeconds(Math.max(skipEnd, skipStart));
    } else {
      setStartSeconds(0);
      setEndSeconds(duration);
    }
  }, [autoRemoveSilence, analysis, duration, open]);


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


  const drawWaveform = useCallback(() => {
    const canvas = waveformCanvasRef.current;
    const peaks = waveformPeaks;
    if (!open || !canvas || !peaks) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    const style = getComputedStyle(document.body);
    const primaryColor = `hsl(${style.getPropertyValue('--primary').trim()})`;
    const destructiveColor = `hsl(${style.getPropertyValue('--destructive').trim()})`;

    ctx.clearRect(0, 0, w, h);

    const mid = Math.floor(h / 2);
    const ampScale = (h / 2) * 0.92;

    const toX = (sec: number) => {
      const t = sec / duration;
      return clamp(Math.round(t * w), 0, w);
    };

    const selX1 = toX(startSeconds);
    const selX2 = toX(endSeconds);
    const leftPx = Math.min(selX1, selX2);
    const rightPx = Math.max(selX1, selX2);

    // Dim areas outside trim
    ctx.fillStyle = theme === 'dark' ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.7)';
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillRect(leftPx, 0, Math.max(1, rightPx - leftPx), h);
    ctx.globalCompositeOperation = 'source-over';

    // Waveform
    ctx.strokeStyle = primaryColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = 0; x < w; x += 1) {
      const srcX = duration > 0 ? Math.floor((x / w) * peaks.length) : 0;
      const peak = peaks[clamp(srcX, 0, peaks.length - 1)] || 0;
      const y = Math.max(1, Math.floor(peak * ampScale));
      ctx.moveTo(x + 0.5, mid - y);
      ctx.lineTo(x + 0.5, mid + y);
    }
    ctx.stroke();

    // Trim bounding box for the active area to mimic video editors
    ctx.strokeStyle = primaryColor;
    ctx.lineWidth = 2;
    ctx.strokeRect(leftPx, 0, Math.max(1, rightPx - leftPx), h);

    ctx.fillStyle = `hsl(${style.getPropertyValue('--primary').trim()} / 0.15)`;
    ctx.fillRect(leftPx, 0, Math.max(1, rightPx - leftPx), h);

    // Playhead
    const ph = toX(playheadSeconds);
    ctx.fillStyle = destructiveColor;
    ctx.fillRect(ph, 0, 2, h);
  }, [duration, endSeconds, open, startSeconds, waveformPeaks, playheadSeconds, theme]);

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
      // Get the actively selected broadcast device to filter it out from test options
      const currentlyActiveId = window.localStorage.getItem('radio.selectedOutputDevice') || 'default';

      const list = await navigator.mediaDevices.enumerateDevices();
      const outputs = list
        .filter((d) => d.kind === 'audiooutput' && d.deviceId)
        .filter((d) => d.deviceId !== 'communications')
        // Filter out the active broadcast device
        .filter((d) => d.deviceId !== currentlyActiveId)
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

  const handleTest = useCallback(async () => {
    const el = testAudioRef.current;
    if (!el) return;

    if (isTesting) {
      el.pause();
      setIsTesting(false);
      return;
    }

    setIsTesting(true);
    try {
      el.pause();
      el.src = resolveUploadsUrl(track.filePath);
      await applyTestSink();

      let rafId = 0;
      const tick = () => {
        rafId = requestAnimationFrame(tick);
        const t = el.currentTime;
        setPlayheadSeconds(t);

        if (Number.isFinite(endSeconds) && t >= endSeconds) {
          el.pause();
          cancelAnimationFrame(rafId);
          setIsTesting(false);
          setPlayheadSeconds(startSeconds); // Reset playhead
        }
      };

      const onLoaded = async () => {
        try {
          el.currentTime = startSeconds;
          await el.play();
        } catch {
          setIsTesting(false);
        }
      };

      el.addEventListener('loadedmetadata', onLoaded, { once: true });
      rafId = requestAnimationFrame(tick);

      const cleanup = () => {
        if (rafId) cancelAnimationFrame(rafId);
      };

      window.setTimeout(cleanup, Math.max(250, (endSeconds - startSeconds) * 1000 + 750));
    } catch {
      setIsTesting(false);
    }
  }, [applyTestSink, endSeconds, startSeconds, track.filePath, isTesting]);

  const [isSaving, setIsSaving] = useState(false);
  const [saveConfirmOpen, setSaveConfirmOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      setSaveConfirmOpen(false);
      return;
    }
    setSaveConfirmOpen(false);
  }, [open]);

  const handleSave = useCallback(async (mode: 'overwrite' | 'duplicate') => {
    setIsSaving(true);
    try {
      const updated = await tracksAPI.edit(track.id, {
        startSeconds,
        endSeconds,
        mode,
        playlistContext,
      } as any);

      toast.success(mode === 'duplicate' ? 'Song duplicated and trimmed' : 'Song updated');
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
  }, [endSeconds, onOpenChange, onTrackUpdated, startSeconds, track.dateAdded, track.filePath, track.id]);

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={reduceMotion ? undefined : { opacity: 1 }}
            exit={reduceMotion ? undefined : { opacity: 0 }}
            transition={reduceMotion ? undefined : { duration: 0.2, ease: 'easeOut' }}
          >
            <motion.div
              className="w-full max-w-4xl rounded-xl border border-border/60 bg-background text-foreground shadow-2xl p-6"
              onClick={(e) => e.stopPropagation()}
              initial={reduceMotion ? false : { opacity: 0, scale: 0.98, y: 8 }}
              animate={reduceMotion ? undefined : { opacity: 1, scale: 1, y: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, scale: 0.98, y: 8 }}
              transition={reduceMotion ? undefined : { duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h3 className="text-base font-semibold tracking-tight text-foreground">
                    Trim boundaries
                  </h3>
                  <p className="text-[10px] font-mono opacity-70 truncate max-w-xl text-muted-foreground mt-0.5">
                    {track.name}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="text-muted-foreground hover:text-foreground text-xl leading-none px-2 h-8 w-8 flex items-center justify-center rounded-full hover:bg-muted/50 transition-colors"
                >
                  ×
                </button>
              </div>

              <audio ref={testAudioRef} className="hidden" />

              <div className="space-y-6 pt-4">
                {/* Header Controls Block */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Switch
                      id="auto-silence"
                      checked={autoRemoveSilence}
                      onCheckedChange={setAutoRemoveSilence}
                      disabled={!analysis || isWaveformLoading}
                    />
                    <Label htmlFor="auto-silence" className="text-xs font-semibold cursor-pointer select-none">
                      Auto-remove silence
                    </Label>
                    {isWaveformLoading && (
                      <span className="text-[11px] text-muted-foreground animate-pulse ml-2">Analyzing...</span>
                    )}
                  </div>

                  <div className="text-[11px] text-muted-foreground font-mono bg-muted/50 px-3 py-1.5 rounded-md border border-border/40">
                    <span className="text-primary font-bold">{editedDuration.toFixed(3)}s</span>
                    <span className="mx-2 opacity-30">/</span>
                    <span className="opacity-70">{duration.toFixed(3)}s</span>
                  </div>
                </div>

                {/* Master Timeline Editor */}
                <div className="relative w-full h-[140px] rounded-xl border border-border/60 bg-black/[0.02] dark:bg-black/20 overflow-hidden shadow-inner">
                  {/* Embedded visually-matched canvas */}
                  <canvas
                    ref={waveformCanvasRef}
                    className="absolute inset-0 w-full h-full"
                  />
                  {/* Transparent overlay slider styled to act as the direct bounding box editor */}
                  <Slider
                    className="absolute inset-0 w-full h-full opacity-0 hover:opacity-100 transition-opacity [&_[role=slider]]:h-full [&_[role=slider]]:w-4 [&_[role=slider]]:rounded-[2px] [&_[role=slider]]:bg-primary [&_[role=slider]]:shadow-lg [&_[role=slider]]:border-x [&_[role=slider]]:border-primary-foreground/20 cursor-ew-resize mix-blend-overlay"
                    value={[startSeconds, endSeconds]}
                    min={0}
                    max={duration}
                    step={0.001}
                    onValueChange={(v) => {
                      const s = roundMs(Number(v?.[0] ?? 0));
                      const e = roundMs(Number(v?.[1] ?? 0));
                      if (autoRemoveSilence) setAutoRemoveSilence(false);
                      setStartSeconds(clamp(s, 0, duration));
                      setEndSeconds(clamp(e, s, duration));
                      setPlayheadSeconds(s);
                    }}
                  />
                </div>

                <div className="grid grid-cols-2 gap-8 px-1">
                  <div className="space-y-2">
                    <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest pl-1">START POINT</div>
                    <StepperInput 
                      value={startSeconds} 
                      min={0} 
                      max={endSeconds} 
                      step={0.001} 
                      showButtons={false} 
                      onChange={(v) => {
                        setStartSeconds(roundMs(v));
                        if (autoRemoveSilence) setAutoRemoveSilence(false);
                      }}
                      className="bg-background border-border/60 focus:scale-[1.01] transition-transform"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest pl-1">END POINT</div>
                    <StepperInput 
                      value={endSeconds} 
                      min={startSeconds} 
                      max={duration} 
                      step={0.001} 
                      showButtons={false} 
                      onChange={(v) => {
                        setEndSeconds(roundMs(v));
                        if (autoRemoveSilence) setAutoRemoveSilence(false);
                      }}
                      className="bg-background border-border/60 focus:scale-[1.01] transition-transform"
                    />
                  </div>
                </div>

                <div className="bg-muted/30 rounded-xl p-4 grid grid-cols-[1fr_auto] gap-6 items-end mt-4 border border-border/40">
                  <div className="space-y-2">
                    <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1 px-1">PREVIEW OUTPUT</div>
                    <Select value={testDeviceId} onValueChange={(v) => setTestDeviceId(v)}>
                      <SelectTrigger size="sm" className="h-9 text-xs bg-background border-border/60 hover:border-primary/50 transition-colors">
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
                  <div className="flex justify-end h-9">
                    <Button 
                      type="button" 
                      variant="outline" 
                      size="sm" 
                      className="h-full px-8 shadow-sm font-semibold hover:border-primary/50 transition-all active:scale-95" 
                      onClick={() => void handleTest()}
                    >
                      {isTesting ? '⏹ Stop' : '▶ Preview'}
                    </Button>
                  </div>
                </div>
              </div>

              <div className="mt-8 flex flex-col sm:flex-row gap-3 pt-6 border-t border-border/40">
                <Button 
                  type="button" 
                  variant="ghost" 
                  size="sm"
                  onClick={() => onOpenChange(false)} 
                  disabled={isSaving} 
                  className="sm:mr-auto h-9 px-6 hover:bg-muted transition-all"
                >
                  Close
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="h-9 px-6 shadow-sm font-semibold transition-all hover:scale-105 active:scale-95"
                  disabled={isSaving || editedDuration === 0}
                  onClick={() => handleSave('duplicate')}
                >
                  Duplicate & Save
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="h-9 px-8 shadow-sm font-bold transition-all hover:scale-105 active:scale-95"
                  disabled={isSaving || editedDuration === 0}
                  onClick={() => setSaveConfirmOpen(true)}
                >
                  Save file
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={saveConfirmOpen}
        title="Overwrite this audio file?"
        description={`Edited length: ${editedDuration.toFixed(3)}s\n\nNote: If you want to keep the original file untouched, choose 'Duplicate & Save'.`}
        confirmLabel="Overwrite"
        cancelLabel="Cancel"
        onCancel={() => setSaveConfirmOpen(false)}
        onConfirm={() => {
          setSaveConfirmOpen(false);
          void handleSave('overwrite');
        }}
      />
    </>
  );
}


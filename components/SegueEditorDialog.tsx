import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Track } from '../types';
import { resolveUploadsUrl, tracksAPI } from '../services/api';
import { cn } from '../lib/utils';

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
import { Checkbox } from './ui/checkbox';
import { ConfirmDialog } from './ConfirmDialog';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { 
  Play, 
  Pause, 
  Square, 
  SkipBack, 
  SkipForward, 
  FastForward, 
  ZoomIn, 
  ZoomOut, 
  Circle, 
  Trash2,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';

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

function formatTimecode(seconds: number) {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100); // hundredths for broadcast
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 2)}`;
  return `${pad(m)}:${pad(s)}.${pad(ms, 2)}`;
}

// Generates a mock VU meter scale array
const vuMeterBars = Array.from({length: 40});

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

export function SegueEditorDialog(props: {
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

  // Segue Sidebar States
  const [segueStyle, setSegueStyle] = useState('crossfade');
  const [duckTracks, setDuckTracks] = useState(false);
  const [gainDb, setGainDb] = useState(0.0);
  const [tempoPct, setTempoPct] = useState(0.0);

  // Auto-skip
  const [autoRemoveSilence, setAutoRemoveSilence] = useState(true);
  const [analysis, setAnalysis] = useState<SilenceDetectionResult | null>(null);

  const [isTesting, setIsTesting] = useState(false);
  const testAudioRef = useRef<HTMLAudioElement | null>(null);

  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const waveformCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [waveformPeaks, setWaveformPeaks] = useState<Float32Array | null>(null);
  const [isWaveformLoading, setIsWaveformLoading] = useState(false);
  const waveformDrawRafRef = useRef<number | null>(null);

  const [playheadSeconds, setPlayheadSeconds] = useState(0);

  const editedDuration = Math.max(0, endSeconds - startSeconds);

  // Mock zoom level
  const [zoomLevel, setZoomLevel] = useState(1);

  useEffect(() => {
    if (!open) return;
    setStartSeconds(0);
    setEndSeconds(duration);
    setPlayheadSeconds(0);
    setAutoRemoveSilence(true);
    setAnalysis(null);
    setZoomLevel(1);

    let isSubscribed = true;
    const controller = new AbortController();

    setIsWaveformLoading(true);
    const url = resolveUploadsUrl(track.filePath);

    decodeToAudioBuffer(url, controller.signal)
      .then((buf) => {
        if (!isSubscribed) return;
        setAudioBuffer(buf);

        const result = detectSilence(buf, { threshold: 0.0025, minSilenceSeconds: 0.08 });
        setAnalysis(result);

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
  }, [duration, open, track.filePath]); 

  // Handle Toggle Switch for Auto Silence
  useEffect(() => {
    if (!open || !analysis) return;
    if (autoRemoveSilence) {
      const skipStart = Math.min(duration, Math.max(0, analysis.leadingSilenceSeconds));
      const skipEnd = Math.max(0, Math.min(duration, duration - analysis.trailingSilenceSeconds));
      setStartSeconds(skipStart);
      setEndSeconds(Math.max(skipEnd, skipStart));
    }
  }, [autoRemoveSilence, analysis, duration, open]);

  useEffect(() => {
    const canvas = waveformCanvasRef.current;
    const buf = audioBuffer;
    if (!open || !canvas || !buf) return;

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      
      const width = Math.max(800, Math.floor(parent.clientWidth || 0));
      const height = Math.max(300, Math.floor(parent.clientHeight || 0));
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

    // Small delay to ensure flex container has painted
    setTimeout(resize, 50);
    const ro = new ResizeObserver(() => resize());
    if (canvas.parentElement) {
      ro.observe(canvas.parentElement);
    }
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
    const mutedColor = `hsl(${style.getPropertyValue('--muted-foreground').trim()})`;
    const secondaryColor = `hsl(${style.getPropertyValue('--secondary').trim()})`;

    ctx.clearRect(0, 0, w, h);

    // Draw background grid lines and timeline markers
    ctx.strokeStyle = theme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)';
    ctx.lineWidth = 1;
    for(let i=1; i<20; i++){
      ctx.beginPath();
      ctx.moveTo((w/20)*i, 0);
      ctx.lineTo((w/20)*i, h);
      ctx.stroke();
    }
    
    // Horizontal dB lines
    ctx.strokeStyle = theme === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)';
    for(let i=1; i<4; i++){
      ctx.beginPath();
      ctx.moveTo(0, (h/4)*i);
      ctx.lineTo(w, (h/4)*i);
      ctx.stroke();
    }

    // Canvas splits vertically into mock 3 tracks (A, B, C)
    const trackHeight = h / 3;

    // We will draw the REAL track in the middle (Track B)
    // and mock tracks on top and bottom to simulate overlap editing.
    
    // Virtual Viewport based on Zoom
    // If zoomLevel=1, we show entire duration. If > 1, we show less.
    // However, keeping it simple for now and just scaling horizontally across the canvas width.
    const toX = (sec: number) => {
      const t = sec / duration;
      return clamp(Math.round(t * w), 0, w);
    };

    const selX1 = toX(startSeconds);
    const selX2 = toX(endSeconds);
    const leftPx = Math.min(selX1, selX2);
    const rightPx = Math.max(selX1, selX2);

    // -----------------------------------------------------------------
    // Track A (Mock Previous Track) - Fading Out
    // -----------------------------------------------------------------
    const trackAMid = trackHeight / 2;
    
    const gradA = ctx.createLinearGradient(0, 0, leftPx + 100, 0);
    gradA.addColorStop(0, theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)');
    gradA.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradA;
    ctx.fillRect(0, 0, leftPx + 100, trackHeight - 4);

    // Center 0 crossings
    ctx.strokeStyle = theme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';
    ctx.beginPath();
    ctx.moveTo(0, trackAMid); ctx.lineTo(w, trackAMid);
    ctx.stroke();
    
    ctx.strokeStyle = mutedColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = 0; x < leftPx + 100; x += 2) {
      const envelope = x < leftPx - 100 ? 1 : Math.max(0, 1 - (x - (leftPx - 100)) / 200);
      const mockPeak = (Math.random() * 0.5 + 0.1) * envelope;
      const y = Math.floor(mockPeak * (trackHeight / 2) * 0.85);
      ctx.moveTo(x, trackAMid - y);
      ctx.lineTo(x, trackAMid + y);
    }
    ctx.stroke();

    // -----------------------------------------------------------------
    // Track B (Actual Track) - Middle
    // -----------------------------------------------------------------
    const trackBMid = trackHeight + (trackHeight / 2);
    ctx.fillStyle = theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
    ctx.fillRect(0, trackHeight, w, trackHeight - 4);
    
    // Dim inactive regions on Actual Track
    ctx.fillStyle = theme === 'dark' ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.6)';
    ctx.fillRect(0, trackHeight, leftPx, trackHeight - 4);
    ctx.fillRect(rightPx, trackHeight, w - rightPx, trackHeight - 4);

    // Center 0 crossing
    ctx.strokeStyle = theme === 'dark' ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)';
    ctx.beginPath();
    ctx.moveTo(0, trackBMid); ctx.lineTo(w, trackBMid);
    ctx.stroke();

    ctx.strokeStyle = primaryColor;
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    const ampScale = (trackHeight / 2) * 0.90;
    for (let x = 0; x < w; x += 1) {
      const srcX = duration > 0 ? Math.floor((x / w) * peaks.length) : 0;
      const peak = peaks[clamp(srcX, 0, peaks.length - 1)] || 0;
      const y = Math.max(1, Math.floor(peak * ampScale));
      ctx.moveTo(x + 0.5, trackBMid - y);
      ctx.lineTo(x + 0.5, trackBMid + y);
    }
    ctx.stroke();

    // Active Region Highlight
    ctx.fillStyle = `hsl(${style.getPropertyValue('--primary').trim()} / 0.12)`;
    ctx.fillRect(leftPx, trackHeight, rightPx - leftPx, trackHeight - 4);
    
    // Subtle border for active region
    ctx.strokeStyle = `hsl(${style.getPropertyValue('--primary').trim()} / 0.4)`;
    ctx.strokeRect(leftPx, trackHeight, rightPx - leftPx, trackHeight - 4);

    // -----------------------------------------------------------------
    // Track C (Mock Next Track) - Fading In
    // -----------------------------------------------------------------
    const trackCMid = (trackHeight * 2) + (trackHeight / 2);
    
    const gradC = ctx.createLinearGradient(rightPx - 100, 0, w, 0);
    gradC.addColorStop(0, 'rgba(0,0,0,0)');
    gradC.addColorStop(1, theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)');
    ctx.fillStyle = gradC;
    ctx.fillRect(rightPx - 100, trackHeight * 2, w - (rightPx - 100), trackHeight);

    // Center 0 crossings
    ctx.strokeStyle = theme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';
    ctx.beginPath();
    ctx.moveTo(0, trackCMid); ctx.lineTo(w, trackCMid);
    ctx.stroke();

    ctx.strokeStyle = mutedColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = rightPx - 100; x < w; x += 2) {
      const envelope = x > rightPx + 100 ? 1 : Math.max(0, (x - (rightPx - 100)) / 200);
      const mockPeak = (Math.random() * 0.5 + 0.1) * envelope;
      const y = Math.floor(mockPeak * (trackHeight / 2) * 0.85);
      ctx.moveTo(x, trackCMid - y);
      ctx.lineTo(x, trackCMid + y);
    }
    ctx.stroke();

    // -----------------------------------------------------------------
    // Vertical Flags (Cue In / Cue Out / Segue)
    // -----------------------------------------------------------------
    const drawFlag = (x: number, label: string, color: string, align: 'left' | 'right') => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();

      ctx.fillStyle = color;
      ctx.font = '10px Inter, sans-serif';
      ctx.textBaseline = 'top';
      const textWidth = ctx.measureText(label).width;
      
      const px = align === 'left' ? x - textWidth - 4 : x + 4;
      
      // Label BG
      ctx.fillRect(align === 'left' ? x - textWidth - 8 : x, 0, textWidth + 8, 18);
      
      ctx.fillStyle = '#fff';
      if(theme === 'light' && color === mutedColor) ctx.fillStyle = '#000'; // Contrast fix for mock flags
      
      ctx.fillText(label, px, 4);
    };

    drawFlag(leftPx, 'CUE IN', primaryColor, 'right');
    drawFlag(rightPx, 'CUE OUT', secondaryColor || primaryColor, 'left');

    // Playhead (Full Height)
    const ph = toX(playheadSeconds);
    ctx.fillStyle = destructiveColor;
    ctx.fillRect(ph, 0, 2, h);

    // Playhead Triangle top
    ctx.beginPath();
    ctx.moveTo(ph - 4, 0);
    ctx.lineTo(ph + 6, 0);
    ctx.lineTo(ph + 1, 6);
    ctx.fill();

  }, [duration, endSeconds, open, startSeconds, waveformPeaks, playheadSeconds, theme, zoomLevel]);

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


  const handlePlayback = useCallback(async () => {
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
      
      // Output routing omitted for brevity in Segue Editor mockup, 
      // but can be added back if testing output routing is still required.
      
      let rafId = 0;
      const tick = () => {
        rafId = requestAnimationFrame(tick);
        const t = el.currentTime;
        setPlayheadSeconds(t);

        if (Number.isFinite(endSeconds) && t >= endSeconds) {
          el.pause();
          cancelAnimationFrame(rafId);
          setIsTesting(false);
          setPlayheadSeconds(startSeconds); // Reset
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

      const cleanup = () => { if (rafId) cancelAnimationFrame(rafId); };
      window.setTimeout(cleanup, Math.max(250, (endSeconds - startSeconds) * 1000 + 750));
    } catch {
      setIsTesting(false);
    }
  }, [endSeconds, startSeconds, track.filePath, isTesting]);

  const [isSaving, setIsSaving] = useState(false);
  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      const updated = await tracksAPI.edit(track.id, {
        startSeconds,
        endSeconds,
        mode: 'overwrite', // Use 'overwrite' to update metadata conceptually without creating dupes
        playlistContext,
      } as any);

      toast.success('Segue saved successfully');
      if (onTrackUpdated) {
        const t: any = updated as any;
        onTrackUpdated({
          ...track,
          duration: Number(t.duration || track.duration),
        });
      }
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save segue');
    } finally {
      setIsSaving(false);
    }
  }, [endSeconds, onOpenChange, onTrackUpdated, startSeconds, track, playlistContext]);

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4"
            onClick={() => onOpenChange(false)}
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={reduceMotion ? undefined : { opacity: 1 }}
            exit={reduceMotion ? undefined : { opacity: 0 }}
            transition={reduceMotion ? undefined : { duration: 0.2, ease: 'easeOut' }}
          >
            <motion.div
              className="w-full max-w-[1200px] flex flex-col rounded-xl border border-border/60 bg-background text-foreground shadow-2xl overflow-hidden h-[90vh] max-h-[850px]"
              onClick={(e) => e.stopPropagation()}
              initial={reduceMotion ? false : { opacity: 0, scale: 0.98, y: 8 }}
              animate={reduceMotion ? undefined : { opacity: 1, scale: 1, y: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, scale: 0.98, y: 8 }}
              transition={reduceMotion ? undefined : { duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-border/40 bg-muted/20">
                <div>
                  <h3 className="text-lg font-semibold tracking-tight text-foreground flex items-center gap-2">
                    Segue Editor
                    <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary uppercase font-bold tracking-wider">Pro</span>
                  </h3>
                  <p className="text-xs opacity-70 mt-1 max-w-2xl truncate">
                    Editing overlap and transitions for <span className="font-bold text-foreground">{track.name}</span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="text-muted-foreground hover:text-foreground text-xl leading-none px-2 h-8 w-8 flex items-center justify-center rounded-full hover:bg-muted transition-colors"
                >
                  ×
                </button>
              </div>

              {/* Main Body: 3-Pane Structure */}
              <div className="flex flex-1 overflow-hidden">
                
                {/* Canvas Area (Center/Left) */}
                <div className="flex-1 flex flex-col relative bg-black/5 dark:bg-black/40">
                  <div className="absolute top-4 left-4 right-4 flex justify-between z-10 pointer-events-none">
                     <div className="text-xs font-mono font-bold text-primary/80 bg-background/50 px-2 py-1 rounded backdrop-blur">
                       TRACK A
                     </div>
                     <div className="text-xs font-mono font-bold text-muted-foreground/80 bg-background/50 px-2 py-1 rounded backdrop-blur mr-[40%]">
                       TRACK B (CURRENT)
                     </div>
                     <div className="text-xs font-mono font-bold text-secondary/80 bg-background/50 px-2 py-1 rounded backdrop-blur">
                       TRACK C
                     </div>
                  </div>

                  <div className="flex-1 relative w-full h-full">
                    {/* Embedded visually-matched canvas */}
                    <canvas
                      ref={waveformCanvasRef}
                      className="absolute inset-0 w-full h-full"
                    />
                    
                    {/* Transparent overlay slider styled to act as the direct bounding box editor */}
                    <Slider
                      className="absolute inset-[33%] w-full h-1/3 opacity-0 hover:opacity-100 transition-opacity [&_[role=slider]]:h-full [&_[role=slider]]:w-4 [&_[role=slider]]:rounded-[2px] [&_[role=slider]]:bg-primary [&_[role=slider]]:shadow-lg [&_[role=slider]]:border-x [&_[role=slider]]:border-primary-foreground/20 cursor-ew-resize mix-blend-overlay"
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

                  {/* Horizontal Time Ruler Mock */}
                  <div className="h-7 border-t border-border/40 flex items-center bg-muted/80 text-[10px] font-mono text-muted-foreground/70 overflow-hidden relative shadow-inner">
                     {/* Simplified ruler ticks */}
                     {Array.from({length: 40}).map((_, i) => (
                       <div key={i} className="absolute h-full border-l border-border/50 pl-1 pt-1" style={{left: `${(i/40)*100}%`}}>
                         {i % 4 === 0 ? formatTimecode((duration / 40) * i) : ''}
                       </div>
                     ))}
                  </div>
                </div>

                {/* Right Sidebar Controls */}
                <div className="w-[340px] border-l border-border/40 bg-zinc-50 dark:bg-zinc-950/50 p-6 flex flex-col gap-6 overflow-y-auto">
                  
                  {/* Navigation Grid */}
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" size="sm" className="h-8 text-[11px]"><ChevronLeft className="w-3 h-3 mr-1" /> Prev Segue</Button>
                    <Button variant="outline" size="sm" className="h-8 text-[11px]">Next Segue <ChevronRight className="w-3 h-3 ml-1" /></Button>
                    <Button variant="outline" size="sm" className="h-8 text-[11px]"><ChevronLeft className="w-3 h-3 mr-1" /> Prev Voice</Button>
                    <Button variant="outline" size="sm" className="h-8 text-[11px]">Next Voice <ChevronRight className="w-3 h-3 ml-1" /></Button>
                  </div>

                  <div className="h-[1px] bg-border/40" />

                  {/* Segue Info Panel */}
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Active Segue</Label>
                      <div className="text-sm font-medium p-2 bg-background border border-border/60 rounded-md shadow-sm truncate">
                        {track.name.toLowerCase()}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-xs font-semibold">Segue Style</Label>
                      <Select value={segueStyle} onValueChange={setSegueStyle}>
                        <SelectTrigger className="bg-background">
                          <SelectValue placeholder="Select style" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="crossfade">Crossfade (Overlap)</SelectItem>
                          <SelectItem value="fade">Fade Out / Fade In</SelectItem>
                          <SelectItem value="cue">Hard Cue Out / In</SelectItem>
                          <SelectItem value="next">Play Next Immediately</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex items-center space-x-2 pt-2">
                      <Checkbox 
                        id="duck-tracks" 
                        checked={duckTracks}
                        onCheckedChange={(c) => setDuckTracks(!!c)}
                      />
                      <label
                        htmlFor="duck-tracks"
                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                      >
                        Duck other tracks (-12dB)
                      </label>
                    </div>

                    <div className="flex items-center space-x-2 pt-1 border-t border-border/20">
                      <Switch
                        id="auto-silence"
                        checked={autoRemoveSilence}
                        onCheckedChange={setAutoRemoveSilence}
                        disabled={!analysis || isWaveformLoading}
                        className="scale-90"
                      />
                      <Label htmlFor="auto-silence" className="text-xs font-medium cursor-pointer">
                        Auto-snap to audio bounds
                      </Label>
                    </div>
                  </div>

                  <div className="h-[1px] bg-border/40" />

                  {/* Audio Settings Panel */}
                  <div className="space-y-4">
                    <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Audio Parameters</Label>
                    
                    <div className="space-y-2">
                      <div className="flex justify-between items-center text-xs">
                        <Label>Gain Align</Label>
                        <span className="font-mono text-muted-foreground">{gainDb > 0 ? '+' : ''}{gainDb.toFixed(1)} dB</span>
                      </div>
                      <StepperInput 
                        value={gainDb} min={-24} max={12} step={0.5} 
                        onChange={setGainDb} 
                        className="bg-background h-8"
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="flex justify-between items-center text-xs">
                        <Label>Tempo Adjust</Label>
                        <span className="font-mono text-muted-foreground">{tempoPct > 0 ? '+' : ''}{tempoPct.toFixed(1)} %</span>
                      </div>
                      <StepperInput 
                        value={tempoPct} min={-10} max={10} step={0.1} 
                        onChange={setTempoPct} 
                        className="bg-background h-8"
                      />
                    </div>
                  </div>

                  <div className="space-y-4">
                    <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Cue Points</Label>
                    <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 items-center text-xs font-mono bg-background p-2 rounded-md border border-border/40">
                      <div className="text-primary font-bold text-[10px]">IN:</div>
                      <div>{formatTimecode(startSeconds)}</div>
                      <div className="text-secondary font-bold text-[10px]">OUT:</div>
                      <div>{formatTimecode(endSeconds)}</div>
                      <div className="text-muted-foreground font-bold text-[10px]">DUR:</div>
                      <div>{formatTimecode(editedDuration)}</div>
                    </div>
                  </div>

                </div>
              </div>

              {/* Bottom Toolbar */}
              <div className="h-16 px-6 border-t border-border/40 bg-card flex items-center justify-between shadow-[0_-4px_24px_rgba(0,0,0,0.02)] z-10">
                
                {/* Left Side Tools */}
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="icon" className="h-9 w-9 rounded-full text-red-500 hover:text-red-600 hover:bg-red-500/10">
                     <Circle className="w-4 h-4 fill-current" />
                  </Button>
                  <Button variant="outline" size="icon" className="h-9 w-9">
                     <Trash2 className="w-4 h-4 text-muted-foreground" />
                  </Button>
                </div>

                {/* Playback Controls & Timecode */}
                <div className="flex items-center gap-6">
                  {/* Digital Timecode and VU Meter */}
                  <div className="flex items-center gap-4 bg-zinc-900 dark:bg-black px-4 py-2 rounded-lg border border-border shadow-inner">
                    <div className="text-green-400 font-mono text-2xl font-bold tracking-widest min-w-[150px] text-center" style={{ textShadow: "0 0 10px rgba(74, 222, 128, 0.4)" }}>
                      {formatTimecode(playheadSeconds)}
                    </div>
                    
                    {/* Mock VU Meter */}
                    <div className="w-24 flex flex-col gap-1 border-l border-zinc-800 pl-4 py-0.5">
                      <div className="flex gap-0.5">
                        <span className="text-[8px] text-zinc-500 font-bold mr-1 w-2">L</span>
                        {vuMeterBars.map((_, i) => {
                           const active = isTesting && Math.random() > (i/40);
                           return <div key={`L${i}`} className={cn("flex-1 h-2 rounded-[1px] transition-colors duration-75", active ? (i > 32 ? 'bg-red-500' : i > 24 ? 'bg-yellow-400' : 'bg-green-500') : 'bg-zinc-800')} />
                        })}
                      </div>
                      <div className="flex gap-0.5">
                        <span className="text-[8px] text-zinc-500 font-bold mr-1 w-2">R</span>
                        {vuMeterBars.map((_, i) => {
                           const active = isTesting && Math.random() > (i/40);
                           return <div key={`R${i}`} className={cn("flex-1 h-2 rounded-[1px] transition-colors duration-75", active ? (i > 32 ? 'bg-red-500' : i > 24 ? 'bg-yellow-400' : 'bg-green-500') : 'bg-zinc-800')} />
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button variant="secondary" size="icon" className="h-10 w-10 shrink-0 rounded-full" onClick={() => setPlayheadSeconds(startSeconds)}>
                      <SkipBack className="w-4 h-4" />
                    </Button>
                    <Button variant="secondary" size="icon" className="h-10 w-10 shrink-0 rounded-full">
                      <FastForward className="w-4 h-4 rotate-180" />
                    </Button>
                    <Button 
                      variant="default" 
                      onClick={handlePlayback}
                      className="h-12 w-12 rounded-full shadow-lg hover:scale-105 active:scale-95 transition-all"
                    >
                      {isTesting ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-1" />}
                    </Button>
                    <Button variant="secondary" size="icon" className="h-10 w-10 shrink-0 rounded-full" onClick={() => {}}>
                      <Square className="w-4 h-4 fill-current" />
                    </Button>
                    <Button variant="secondary" size="icon" className="h-10 w-10 shrink-0 rounded-full" onClick={() => setPlayheadSeconds(endSeconds)}>
                      <SkipForward className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                {/* Right Side Tools */}
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1 bg-muted/30 p-1 rounded-md border border-border/40 hidden sm:flex">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setZoomLevel(z => Math.max(1, z - 0.5))}>
                      <ZoomOut className="w-3.5 h-3.5" />
                    </Button>
                    <div className="text-[10px] font-mono font-medium px-1 w-[40px] text-center">{Math.round(zoomLevel*100)}%</div>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setZoomLevel(z => Math.min(5, z + 0.5))}>
                      <ZoomIn className="w-3.5 h-3.5" />
                    </Button>
                  </div>

                  <Button variant="ghost" size="sm" className="h-9 text-xs font-semibold">Settings...</Button>
                  
                  <div className="w-[1px] h-6 bg-border/60 mx-1" />

                  <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} className="h-10 px-6 uppercase text-xs font-bold tracking-wider">Cancel</Button>
                  <Button size="sm" className="h-10 px-8 uppercase text-xs font-bold tracking-wider bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg transition-transform hover:scale-105 active:scale-95" disabled={isSaving} onClick={handleSave}>
                    {isSaving ? 'Processing...' : 'Apply Segue'}
                  </Button>
                </div>

              </div>

              <audio ref={testAudioRef} className="hidden" />

            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

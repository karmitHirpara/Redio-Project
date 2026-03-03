import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';

export type EqBandKey = '32' | '63' | '125' | '250' | '500' | '1000' | '2000' | '4000' | '8000' | '16000';

export type AudioProcessingSettings = {
  enabled: boolean;
  outputGainDb: number;

  eqEnabled: boolean;
  eqGainsDb: Record<EqBandKey, number>;

  compressorEnabled: boolean;
  compressor: {
    thresholdDb: number;
    ratio: number;
    attackMs: number;
    releaseMs: number;
    makeupGainDb: number;
  };

  limiterEnabled: boolean;
  limiter: {
    thresholdDb: number;
  };
};

const DEFAULT_SETTINGS: AudioProcessingSettings = {
  enabled: true,
  outputGainDb: 0,

  eqEnabled: false,
  eqGainsDb: {
    '32': 0,
    '63': 0,
    '125': 0,
    '250': 0,
    '500': 0,
    '1000': 0,
    '2000': 0,
    '4000': 0,
    '8000': 0,
    '16000': 0,
  },

  compressorEnabled: false,
  compressor: {
    thresholdDb: -18,
    ratio: 3,
    attackMs: 10,
    releaseMs: 250,
    makeupGainDb: 0,
  },

  limiterEnabled: true,
  limiter: {
    thresholdDb: -1,
  },
};

const EQ_BANDS: Array<{ key: EqBandKey; freq: number }> = [
  { key: '32', freq: 32 },
  { key: '63', freq: 63 },
  { key: '125', freq: 125 },
  { key: '250', freq: 250 },
  { key: '500', freq: 500 },
  { key: '1000', freq: 1000 },
  { key: '2000', freq: 2000 },
  { key: '4000', freq: 4000 },
  { key: '8000', freq: 8000 },
  { key: '16000', freq: 16000 },
];

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

const dbToLinear = (db: number) => Math.pow(10, db / 20);

function safeParseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function normalizeSettings(input: any): AudioProcessingSettings {
  const s = input && typeof input === 'object' ? input : {};
  const base: AudioProcessingSettings = {
    ...DEFAULT_SETTINGS,
    ...s,
    eqGainsDb: { ...DEFAULT_SETTINGS.eqGainsDb, ...(s.eqGainsDb || {}) },
    compressor: { ...DEFAULT_SETTINGS.compressor, ...(s.compressor || {}) },
    limiter: { ...DEFAULT_SETTINGS.limiter, ...(s.limiter || {}) },
  };

  base.outputGainDb = clamp(Number(base.outputGainDb) || 0, -18, 18);

  base.eqEnabled = Boolean(base.eqEnabled);
  for (const b of EQ_BANDS) {
    base.eqGainsDb[b.key] = clamp(Number(base.eqGainsDb[b.key]) || 0, -15, 15);
  }

  base.compressorEnabled = Boolean(base.compressorEnabled);
  base.compressor.thresholdDb = clamp(Number(base.compressor.thresholdDb) || -18, -60, 0);
  base.compressor.ratio = clamp(Number(base.compressor.ratio) || 3, 1, 20);
  base.compressor.attackMs = clamp(Number(base.compressor.attackMs) || 10, 0, 100);
  base.compressor.releaseMs = clamp(Number(base.compressor.releaseMs) || 250, 10, 2000);
  base.compressor.makeupGainDb = clamp(Number(base.compressor.makeupGainDb) || 0, 0, 18);

  base.limiterEnabled = Boolean(base.limiterEnabled);
  base.limiter.thresholdDb = clamp(Number(base.limiter.thresholdDb) || -1, -12, 0);

  base.enabled = Boolean(base.enabled);

  return base;
}

const STORAGE_KEY = 'redio.audioProcessing.settings.v1';

type ChainNodes = {
  source: MediaElementAudioSourceNode;
  eqFilters: Record<EqBandKey, BiquadFilterNode>;
  compressor: DynamicsCompressorNode;
  limiter: DynamicsCompressorNode;
  makeupGain: GainNode;
  outputGain: GainNode;
};

export function useAudioProcessing(opts: {
  primaryAudioRef: React.RefObject<HTMLAudioElement>;
  secondaryAudioRef: React.RefObject<HTMLAudioElement>;
}) {
  const [settings, setSettings] = useState<AudioProcessingSettings>(() => {
    const stored = safeParseJson<AudioProcessingSettings>(
      typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null,
    );
    return normalizeSettings(stored);
  });

  const audioCtxRef = useRef<AudioContext | null>(null);
  const lastConnectedElsRef = useRef(new WeakSet<HTMLAudioElement>());
  const nodesByElRef = useRef(new WeakMap<HTMLAudioElement, ChainNodes>());
  const desiredOutputDeviceIdRef = useRef<string>('default');

  const ensureAudioContext = useCallback(() => {
    if (audioCtxRef.current) return audioCtxRef.current;
    if (typeof window === 'undefined') return null;

    const AudioContextImpl = (window.AudioContext || (window as any).webkitAudioContext) as
      | typeof AudioContext
      | undefined;
    if (!AudioContextImpl) return null;

    const ctx = new AudioContextImpl();
    audioCtxRef.current = ctx;

    // Apply desired output routing (if supported) as soon as the context exists.
    const anyCtx = ctx as any;
    if (typeof anyCtx.setSinkId === 'function') {
      try {
        void anyCtx.setSinkId(desiredOutputDeviceIdRef.current);
      } catch {
        // ignore
      }
    }
    return ctx;
  }, []);

  const tryResume = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    if (ctx.state === 'running') return;
    ctx.resume().catch(() => {
      // Autoplay policy can block until the user gestures. Ignore.
    });
  }, []);

  const connectElementIfNeeded = useCallback(
    (audioEl: HTMLAudioElement | null) => {
      if (!audioEl) return;
      if (lastConnectedElsRef.current.has(audioEl)) return;

      const ctx = ensureAudioContext();
      if (!ctx) return;

      try {
        const source = ctx.createMediaElementSource(audioEl);

        const eqFilters: Record<EqBandKey, BiquadFilterNode> = {} as any;
        for (const band of EQ_BANDS) {
          const f = ctx.createBiquadFilter();
          f.type = 'peaking';
          f.frequency.value = band.freq;
          f.Q.value = 1.4;
          f.gain.value = 0;
          eqFilters[band.key] = f;
        }

        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.value = DEFAULT_SETTINGS.compressor.thresholdDb;
        compressor.ratio.value = DEFAULT_SETTINGS.compressor.ratio;
        compressor.attack.value = DEFAULT_SETTINGS.compressor.attackMs / 1000;
        compressor.release.value = DEFAULT_SETTINGS.compressor.releaseMs / 1000;
        compressor.knee.value = 12;

        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = DEFAULT_SETTINGS.limiter.thresholdDb;
        limiter.ratio.value = 20;
        limiter.attack.value = 0.003;
        limiter.release.value = 0.08;
        limiter.knee.value = 0;

        const makeupGain = ctx.createGain();
        makeupGain.gain.value = 1;

        const outputGain = ctx.createGain();
        outputGain.gain.value = 1;

        // source -> EQ (chain) -> compressor -> makeup -> limiter -> output -> destination
        let tail: AudioNode = source;
        for (const band of EQ_BANDS) {
          tail.connect(eqFilters[band.key]);
          tail = eqFilters[band.key];
        }
        tail.connect(compressor);
        compressor.connect(makeupGain);
        makeupGain.connect(limiter);
        limiter.connect(outputGain);
        outputGain.connect(ctx.destination);

        nodesByElRef.current.set(audioEl, {
          source,
          eqFilters,
          compressor,
          limiter,
          makeupGain,
          outputGain,
        });
        lastConnectedElsRef.current.add(audioEl);
      } catch {
        // Some browsers only allow createMediaElementSource once per element.
      }
    },
    [ensureAudioContext],
  );

  useEffect(() => {
    connectElementIfNeeded(opts.primaryAudioRef.current);
    connectElementIfNeeded(opts.secondaryAudioRef.current);
  }, [connectElementIfNeeded, opts.primaryAudioRef, opts.secondaryAudioRef]);

  // Persist settings
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // ignore
    }
  }, [settings]);

  // Apply settings live
  useEffect(() => {
    const ctx = ensureAudioContext();
    if (!ctx) return;

    const applyToEl = (audioEl: HTMLAudioElement | null) => {
      if (!audioEl) return;
      const nodes = nodesByElRef.current.get(audioEl);
      if (!nodes) return;

      const enabled = Boolean(settings.enabled);

      for (const b of EQ_BANDS) {
        const g = settings.eqEnabled && enabled ? settings.eqGainsDb[b.key] : 0;
        nodes.eqFilters[b.key].gain.setTargetAtTime(g, ctx.currentTime, 0.01);
      }

      const compEnabled = settings.compressorEnabled && enabled;
      nodes.compressor.threshold.setTargetAtTime(
        compEnabled ? settings.compressor.thresholdDb : 0,
        ctx.currentTime,
        0.02,
      );
      nodes.compressor.ratio.setTargetAtTime(compEnabled ? settings.compressor.ratio : 1, ctx.currentTime, 0.02);
      nodes.compressor.attack.setTargetAtTime(
        (compEnabled ? settings.compressor.attackMs : 0) / 1000,
        ctx.currentTime,
        0.02,
      );
      nodes.compressor.release.setTargetAtTime(
        (compEnabled ? settings.compressor.releaseMs : 80) / 1000,
        ctx.currentTime,
        0.02,
      );

      const makeupLinear = compEnabled ? dbToLinear(settings.compressor.makeupGainDb) : 1;
      nodes.makeupGain.gain.setTargetAtTime(makeupLinear, ctx.currentTime, 0.01);

      const limiterEnabled = settings.limiterEnabled && enabled;
      nodes.limiter.threshold.setTargetAtTime(
        limiterEnabled ? settings.limiter.thresholdDb : 0,
        ctx.currentTime,
        0.01,
      );
      nodes.limiter.ratio.setTargetAtTime(limiterEnabled ? 20 : 1, ctx.currentTime, 0.01);

      const outLinear = enabled ? dbToLinear(settings.outputGainDb) : 1;
      nodes.outputGain.gain.setTargetAtTime(outLinear, ctx.currentTime, 0.01);
    };

    applyToEl(opts.primaryAudioRef.current);
    applyToEl(opts.secondaryAudioRef.current);

    tryResume();
  }, [ensureAudioContext, opts.primaryAudioRef, opts.secondaryAudioRef, settings, tryResume]);

  const setPartialSettings = useCallback((partial: Partial<AudioProcessingSettings>) => {
    setSettings((prev) => normalizeSettings({ ...prev, ...partial }));
  }, []);

  const setEqGain = useCallback((key: EqBandKey, gainDb: number) => {
    setSettings((prev) => normalizeSettings({ ...prev, eqGainsDb: { ...prev.eqGainsDb, [key]: gainDb } }));
  }, []);

  const supportsOutputDeviceSelection = useMemo(() => {
    if (typeof window === 'undefined') return false;
    const AudioContextImpl = (window.AudioContext || (window as any).webkitAudioContext) as
      | typeof AudioContext
      | undefined;
    if (!AudioContextImpl) return false;
    return typeof (AudioContextImpl.prototype as any).setSinkId === 'function';
  }, []);

  const setOutputDeviceId = useCallback(async (deviceId: string) => {
    const next = deviceId || 'default';
    desiredOutputDeviceIdRef.current = next;
    const ctx = ensureAudioContext();
    if (!ctx) return;
    const anyCtx = ctx as any;
    if (typeof anyCtx.setSinkId !== 'function') return;
    await anyCtx.setSinkId(next);
  }, [ensureAudioContext]);

  return useMemo(
    () => ({
      settings,
      setSettings: (next: AudioProcessingSettings) => setSettings(normalizeSettings(next)),
      setPartialSettings,
      setEqGain,
      supportsOutputDeviceSelection,
      setOutputDeviceId,
      ensureRunning: () => {
        ensureAudioContext();
        tryResume();
      },
    }),
    [ensureAudioContext, setEqGain, setOutputDeviceId, setPartialSettings, settings, supportsOutputDeviceSelection, tryResume],
  );
}

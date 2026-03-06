import { useCallback, useEffect, useMemo, useState } from 'react';

interface AudioOutputDevice {
  deviceId: string;
  label: string;
}

export interface UseAudioDevicesResult {
  devices: AudioOutputDevice[];
  selectedDeviceId: string;
  setSelectedDeviceId: (id: string) => void;
  supportsOutputSelection: boolean;
  isLoading: boolean;
  error: string | null;
  applyToAudioElements: (elements: Array<HTMLAudioElement | null | undefined>) => Promise<void>;
  fallbackToDefault: boolean;
}

const STORAGE_KEY = 'radio.selectedOutputDevice';

// Track whether we've already attempted to unlock full device information via
// getUserMedia. Browsers often hide labels and stable deviceIds until the
// user grants a media permission.
let hasRequestedAudioPermission = false;

const normalizeDeviceLabel = (label: string) => {
  let next = (label || '').trim();
  next = next.replace(/^default\s*-\s*/i, '');
  next = next.replace(/^communications\s*-\s*/i, '');
  next = next.replace(/\s+/g, ' ');
  return next;
};

const isNoiseOutputDevice = (label: string) => {
  const l = (label || '').toLowerCase();
  // Common Windows noise devices that clutter output selection in this app.
  // These are usually HDMI/Display sinks or OS duplicates.
  if (l.includes('display audio')) return true;
  if (l.includes('intel') && l.includes('display')) return true;
  return false;
};

export function useAudioDevices(): UseAudioDevicesResult {
  const [devices, setDevices] = useState<AudioOutputDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('default');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fallbackToDefault, setFallbackToDefault] = useState(false);

  const supportsOutputSelection = useMemo(() => {
    if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
    const anyAudio = document.createElement('audio') as any;
    const hasSetSinkId = typeof anyAudio.setSinkId === 'function';
    const hasMediaDevices = !!navigator.mediaDevices?.enumerateDevices;
    return hasSetSinkId && hasMediaDevices;
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) {
      setSelectedDeviceId(stored);
    }
  }, []);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    setIsLoading(true);
    setError(null);
    try {
      let list = await navigator.mediaDevices.enumerateDevices();

      // If all devices are anonymous (no labels and empty ids), try to request
      // audio permission once to unlock richer device information, then
      // re-enumerate.
      const audioOutputs = list.filter((d) => d.kind === 'audiooutput');
      const allAnonymous = list.every((d) => !d.label && !d.deviceId);
      const outputLabelsHidden =
        audioOutputs.length > 0 &&
        audioOutputs.every((d) => !d.label) &&
        audioOutputs.some((d) => !!d.deviceId);

      if ((allAnonymous || outputLabelsHidden) && !hasRequestedAudioPermission && navigator.mediaDevices.getUserMedia) {
        try {
          hasRequestedAudioPermission = true;
          await navigator.mediaDevices.getUserMedia({ audio: true });
          list = await navigator.mediaDevices.enumerateDevices();
        } catch (permErr: any) {
          // If permission is denied, we simply fall back to anonymous devices
          // and rely on the OS-level "System default" route.
          setError(permErr?.message || 'Microphone permission denied; using system default output');
        }
      }
      const outputs: AudioOutputDevice[] = list
        // Only keep audiooutput devices that expose a stable deviceId. The
        // "System default" route is represented separately via the virtual
        // id "default" in the UI so we do not collapse everything into the
        // same sink.
        .filter((d) => d.kind === 'audiooutput' && d.deviceId)
        .filter((d) => d.deviceId !== 'default' && d.deviceId !== 'communications')
        .map((d) => {
          const fallback = d.deviceId === 'default' ? 'System default (OS)' : `Audio output (${d.deviceId.slice(0, 6)})`;
          return { deviceId: d.deviceId, label: d.label || fallback };
        })
        .map((d) => ({ ...d, label: normalizeDeviceLabel(d.label) }))
        .filter((d) => d.label)
        .filter((d) => !isNoiseOutputDevice(d.label));

      // Deduplicate by (normalized) label first (to collapse Windows “Default/Communications”
      // variants) while still keeping stable deviceIds.
      const byLabel: Record<string, AudioOutputDevice> = {};
      for (const d of outputs) {
        const generic = d.label.toLowerCase().startsWith('audio output');
        const key = generic ? `${d.label.toLowerCase()}::${d.deviceId}` : d.label.toLowerCase();
        if (!byLabel[key]) byLabel[key] = d;
      }

      const normalized = Object.values(byLabel);
      setDevices(normalized);

      setSelectedDeviceId((prev) => {
        if (!prev) {
          setFallbackToDefault(false);
          return 'default';
        }
        if (prev === 'default') {
          setFallbackToDefault(false);
          return prev;
        }

        const stillExists = normalized.some((d) => d.deviceId === prev);
        if (!stillExists) {
          // Hardware disconnected! Trigger instant failover to the OS default route.
          setFallbackToDefault(true);
          return 'default';
        }

        setFallbackToDefault(false);
        return prev;
      });
    } catch (err: any) {
      setError(err?.message || 'Failed to enumerate audio devices');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    refreshDevices();

    const handler = () => {
      refreshDevices();
    };

    navigator.mediaDevices.addEventListener('devicechange', handler);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', handler);
    };
  }, [refreshDevices]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEY, selectedDeviceId || 'default');
  }, [selectedDeviceId]);

  const applyToAudioElements = useCallback(
    async (elements: Array<HTMLAudioElement | null | undefined>): Promise<void> => {
      setError(null);
      if (!supportsOutputSelection) return;

      const targetId = selectedDeviceId || 'default';
      const filtered = elements.filter((el): el is HTMLAudioElement => !!el);
      const ordered = [...filtered].sort((a, b) => {
        const aScore = a.paused ? 1 : 0;
        const bScore = b.paused ? 1 : 0;
        return aScore - bScore;
      });

      const trySetSink = async (el: HTMLAudioElement) => {
        const anyEl = el as any;
        if (typeof anyEl.setSinkId !== 'function') return { ok: false as const, err: null as any };
        if (String(anyEl.sinkId || 'default') === String(targetId)) return { ok: true as const, err: null as any };
        try {
          await anyEl.setSinkId(targetId);
          const applied = String(anyEl.sinkId || 'default');
          if (applied !== String(targetId)) {
            throw new Error(`Audio output did not change (sinkId=${applied})`);
          }
          return { ok: true as const, err: null as any };
        } catch (err: any) {
          return { ok: false as const, err };
        }
      };

      let results: Array<{ ok: true; err: any } | { ok: false; err: any }> = [];
      for (const el of ordered) {
        results.push(await trySetSink(el));
      }

      if (!results.some((r) => r.ok)) {
        await new Promise((r) => window.setTimeout(r, 250));
        results = [];
        for (const el of ordered) {
          results.push(await trySetSink(el));
        }
      }

      if (results.some((r) => r.ok)) {
        setFallbackToDefault(false);
        return;
      }

      const firstErr = results.find((r) => !r.ok)?.err;
      setFallbackToDefault(true);
      setError(firstErr?.message || 'Failed to route audio to selected device');
    },
    [selectedDeviceId, supportsOutputSelection],
  );

  return {
    devices,
    selectedDeviceId,
    setSelectedDeviceId,
    supportsOutputSelection,
    isLoading,
    error,
    applyToAudioElements,
    fallbackToDefault,
  };
}
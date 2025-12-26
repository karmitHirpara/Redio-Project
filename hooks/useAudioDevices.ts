import { useCallback, useEffect, useMemo, useState } from 'react';

interface AudioOutputDevice {
  deviceId: string;
  label: string;
}

interface UseAudioDevicesResult {
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

      console.log('enumerateDevices list:', list);

      // If all devices are anonymous (no labels and empty ids), try to request
      // audio permission once to unlock richer device information, then
      // re-enumerate.
      const allAnonymous = list.every((d) => !d.label && !d.deviceId);
      if (allAnonymous && !hasRequestedAudioPermission && navigator.mediaDevices.getUserMedia) {
        try {
          hasRequestedAudioPermission = true;
          await navigator.mediaDevices.getUserMedia({ audio: true });
          list = await navigator.mediaDevices.enumerateDevices();
          console.log('enumerateDevices list after permission:', list);
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
        .map((d) => ({ deviceId: d.deviceId, label: d.label || 'Audio output' }));

      const unique: Record<string, AudioOutputDevice> = {};
      outputs.forEach((d) => {
        unique[d.deviceId] = d;
      });

      const normalized = Object.values(unique);
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
        setFallbackToDefault(!stillExists);
        return stillExists ? prev : 'default';
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
      const tasks = elements
        .filter((el): el is HTMLAudioElement => !!el)
        .map(async (el) => {
          const anyEl = el as any;
          if (typeof anyEl.setSinkId !== 'function') return;
          try {
            const wasPlaying = !el.paused;
            if (wasPlaying) {
              el.pause();
            }

            await anyEl.setSinkId(targetId);

            if (wasPlaying) {
              try {
                await el.play();
              } catch {
                // ignore play errors; user interaction may be required
              }
            }
          } catch (err: any) {
            setError(err?.message || 'Failed to route audio to selected device');
          }
        });

      await Promise.all(tasks);
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

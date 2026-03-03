import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

interface WatchdogOptions {
    isPlaying: boolean;
    currentTime: number;
    onRecover: () => void;
    thresholdSeconds?: number;
    enabled?: boolean;
}

/**
 * Monitors playback state. If isPlaying is true but currentTime
 * hasn't advanced for the threshold period, it triggers recovery.
 */
export function usePlaybackWatchdog({
    isPlaying,
    currentTime,
    onRecover,
    thresholdSeconds = 3,
    enabled = true,
}: WatchdogOptions) {
    const lastTimeRef = useRef(currentTime);
    const lastUpdateRef = useRef(Date.now());
    const recoveryCountRef = useRef(0);

    useEffect(() => {
        if (!enabled || !isPlaying) {
            lastUpdateRef.current = Date.now();
            lastTimeRef.current = currentTime;
            return;
        }

        const check = () => {
            const now = Date.now();
            const timeAdvanced = currentTime !== lastTimeRef.current;

            if (timeAdvanced) {
                lastTimeRef.current = currentTime;
                lastUpdateRef.current = now;
                recoveryCountRef.current = 0; // Reset recovery count on progress
            } else {
                const stallDuration = (now - lastUpdateRef.current) / 1000;

                if (stallDuration >= thresholdSeconds) {
                    console.warn(`[Watchdog] Playback stall detected (${stallDuration.toFixed(1)}s). Attempting recovery...`);

                    if (recoveryCountRef.current < 2) {
                        recoveryCountRef.current++;
                        lastUpdateRef.current = now; // Reset timer for next attempt

                        toast.error('Playback stall detected', {
                            description: 'Attempting automatic recovery...',
                            duration: 3000,
                        });

                        onRecover();
                    } else {
                        console.error('[Watchdog] Multiple recovery attempts failed. Manual intervention may be required.');
                        // Stop trying to avoid infinite loops if it's a hard failure
                        lastUpdateRef.current = now;
                    }
                }
            }
        };

        const interval = setInterval(check, 1000);
        return () => clearInterval(interval);
    }, [isPlaying, currentTime, onRecover, thresholdSeconds, enabled]);
}

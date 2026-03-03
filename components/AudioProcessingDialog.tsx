import { useMemo } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Slider } from './ui/slider';
import { Switch } from './ui/switch';
import { cn } from './ui/utils';
import type { AudioProcessingSettings, EqBandKey } from '../hooks/useAudioProcessing';

const EQ_BANDS: Array<{ key: EqBandKey; label: string }> = [
  { key: '32', label: '32' },
  { key: '63', label: '63' },
  { key: '125', label: '125' },
  { key: '250', label: '250' },
  { key: '500', label: '500' },
  { key: '1000', label: '1k' },
  { key: '2000', label: '2k' },
  { key: '4000', label: '4k' },
  { key: '8000', label: '8k' },
  { key: '16000', label: '16k' },
];

export function AudioProcessingDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: AudioProcessingSettings;
  onChange: (next: AudioProcessingSettings) => void;
  onSetEqGain: (key: EqBandKey, gainDb: number) => void;
}) {
  const { open, onOpenChange, settings, onChange, onSetEqGain } = props;

  const eqValues = useMemo(() => {
    const out: Record<EqBandKey, number> = {} as any;
    for (const b of EQ_BANDS) {
      out[b.key] = Number(settings.eqGainsDb[b.key] ?? 0);
    }
    return out;
  }, [settings.eqGainsDb]);

  const set = (partial: Partial<AudioProcessingSettings>) => {
    onChange({ ...settings, ...partial } as AudioProcessingSettings);
  };

  const setCompressor = (partial: Partial<AudioProcessingSettings['compressor']>) => {
    onChange({
      ...settings,
      compressor: { ...settings.compressor, ...partial },
    });
  };

  const setLimiter = (partial: Partial<AudioProcessingSettings['limiter']>) => {
    onChange({
      ...settings,
      limiter: { ...settings.limiter, ...partial },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl w-[95vw] gap-0 p-0 overflow-hidden border-slate-700 shadow-2xl bg-slate-900 text-slate-100">
        <DialogHeader className="px-6 py-5 border-b border-slate-700 bg-slate-800/50">
          <DialogTitle className="flex items-center gap-3 text-xl font-bold tracking-tight">
            <div className="p-2 bg-primary/20 rounded-lg">
              <SlidersHorizontal className="w-5 h-5 text-primary" />
            </div>
            Audio Processing
          </DialogTitle>
          <DialogDescription className="text-sm text-slate-400 mt-1">
            Professional broadcast-grade DSP chain. Changes apply instantly to live playback.
          </DialogDescription>
        </DialogHeader>

        <div className="p-6">
          <div className="flex items-center justify-between gap-4 mb-6">
            <div className="text-sm text-slate-400 font-medium">
              Signal Chain: EQ → Compressor → Limiter → Master Gain
            </div>

            <div className="flex items-center gap-3 px-4 py-2 bg-slate-800/50 rounded-full border border-slate-700">
              <span className="text-sm font-bold text-slate-200">Processing Active</span>
              <Switch
                checked={settings.enabled}
                onCheckedChange={(v) => set({ enabled: v === true })}
              />
            </div>
          </div>

          <div className="mt-2">
            <Tabs defaultValue="eq" className="w-full">
              <TabsList className="h-11 bg-slate-800 border border-slate-700 p-1 mb-6">
                <TabsTrigger value="eq" className="text-sm px-6 font-bold uppercase tracking-wider data-[state=active]:bg-slate-700">
                  Equalizer
                </TabsTrigger>
                <TabsTrigger value="dynamics" className="text-sm px-6 font-bold uppercase tracking-wider data-[state=active]:bg-slate-700">
                  Dynamics
                </TabsTrigger>
                <TabsTrigger value="output" className="text-sm px-6 font-bold uppercase tracking-wider data-[state=active]:bg-slate-700">
                  Master
                </TabsTrigger>
              </TabsList>

              <TabsContent value="eq" className="mt-0 focus-visible:outline-none">
                <div className="flex items-center justify-between mb-4">
                  <div className="text-lg font-bold text-slate-100">10-Band Professional EQ</div>
                  <div className="flex items-center gap-3 px-3 py-1 bg-slate-800/50 rounded-lg border border-slate-700">
                    <span className="text-xs font-bold text-slate-300 uppercase tracking-widest">EQ Enabled</span>
                    <Switch
                      checked={settings.eqEnabled}
                      onCheckedChange={(v) => set({ eqEnabled: v === true })}
                    />
                  </div>
                </div>

                <div className="mt-4 rounded-2xl border border-slate-700 bg-slate-800/40 p-8 shadow-2xl relative overflow-hidden group/rack">
                  {/* Rack screws/accents */}
                  <div className="absolute top-3 left-3 w-2 h-2 rounded-full bg-slate-600/50 shadow-inner" />
                  <div className="absolute top-3 right-3 w-2 h-2 rounded-full bg-slate-600/50 shadow-inner" />
                  <div className="absolute bottom-3 left-3 w-2 h-2 rounded-full bg-slate-600/50 shadow-inner" />
                  <div className="absolute bottom-3 right-3 w-2 h-2 rounded-full bg-slate-600/50 shadow-inner" />

                  <div className="grid grid-cols-10 gap-2 h-56 items-end">
                    {EQ_BANDS.map((band) => {
                      const val = eqValues[band.key];
                      return (
                        <div key={band.key} className="flex flex-col items-center h-full">
                          <div className="flex-1 w-full flex flex-col justify-end items-center gap-3">
                            <span className={cn(
                              "text-[9px] font-mono tabular-nums transition-colors",
                              val === 0 ? "text-muted-foreground/40" : "text-primary font-bold"
                            )}>
                              {val > 0 ? `+${val.toFixed(0)}` : val.toFixed(0)}
                            </span>
                            <div className="h-40 flex items-center justify-center">
                              <Slider
                                value={[val]}
                                min={-15}
                                max={15}
                                step={1}
                                orientation="vertical"
                                onValueChange={(v) => {
                                  const next = v?.[0] ?? 0;
                                  onSetEqGain(band.key, next);
                                }}
                                className={cn(
                                  'h-full transition-opacity duration-300',
                                  !settings.eqEnabled || !settings.enabled ? 'opacity-30 grayscale' : 'opacity-100'
                                )}
                              />
                            </div>
                          </div>
                          <div className="mt-3 text-[10px] font-bold tracking-tighter text-muted-foreground/80 uppercase">
                            {band.label}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-8 flex justify-between items-center border-t border-slate-700/50 pt-6">
                    <div className="text-[11px] text-slate-500 uppercase tracking-[0.2em] font-bold px-2">
                      Precision Mastering Equalizer • Model REDIO-10
                    </div>
                    <button
                      type="button"
                      className="text-xs font-bold uppercase tracking-widest text-slate-400 hover:text-primary transition-all px-4 py-2 rounded-lg border border-slate-700 hover:border-primary/50 hover:bg-primary/10"
                      onClick={() => {
                        for (const b of EQ_BANDS) {
                          onSetEqGain(b.key, 0);
                        }
                      }}
                    >
                      Reset Flat
                    </button>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="dynamics" className="mt-3">
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-xl border border-border/60 bg-muted/30 p-5 shadow-sm relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-primary/20" />
                    <div className="flex items-center justify-between mb-4">
                      <div className="text-xs font-bold uppercase tracking-wider text-foreground/80">Soft Compressor</div>
                      <Switch
                        checked={settings.compressorEnabled}
                        onCheckedChange={(v) => set({ compressorEnabled: v === true })}
                      />
                    </div>

                    <div className="space-y-5">
                      <div className="space-y-2">
                        <div className="flex justify-between text-[10px] font-bold uppercase tracking-tight text-muted-foreground">
                          <span>Threshold</span>
                          <span className="text-primary tabular-nums">{settings.compressor.thresholdDb.toFixed(0)} dB</span>
                        </div>
                        <Slider
                          value={[settings.compressor.thresholdDb]}
                          min={-60}
                          max={0}
                          step={1}
                          onValueChange={(v) => setCompressor({ thresholdDb: v?.[0] ?? -18 })}
                          className={cn("h-1.5", !settings.compressorEnabled || !settings.enabled ? 'opacity-30' : '')}
                        />
                      </div>

                      <div className="space-y-2">
                        <div className="flex justify-between text-[10px] font-bold uppercase tracking-tight text-muted-foreground">
                          <span>Ratio</span>
                          <span className="text-primary tabular-nums">{settings.compressor.ratio.toFixed(1)}:1</span>
                        </div>
                        <Slider
                          value={[settings.compressor.ratio]}
                          min={1}
                          max={20}
                          step={0.5}
                          onValueChange={(v) => setCompressor({ ratio: v?.[0] ?? 3 })}
                          className={cn("h-1.5", !settings.compressorEnabled || !settings.enabled ? 'opacity-30' : '')}
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label className="text-[9px] font-bold uppercase tracking-tighter text-muted-foreground">Attack</label>
                          <div className="text-[11px] font-mono mb-1">{settings.compressor.attackMs.toFixed(0)}ms</div>
                          <Slider
                            value={[settings.compressor.attackMs]}
                            min={0}
                            max={100}
                            step={1}
                            onValueChange={(v) => setCompressor({ attackMs: v?.[0] ?? 10 })}
                            className={cn("h-1", !settings.compressorEnabled || !settings.enabled ? 'opacity-30' : '')}
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-[9px] font-bold uppercase tracking-tighter text-muted-foreground">Release</label>
                          <div className="text-[11px] font-mono mb-1">{settings.compressor.releaseMs.toFixed(0)}ms</div>
                          <Slider
                            value={[settings.compressor.releaseMs]}
                            min={10}
                            max={2000}
                            step={10}
                            onValueChange={(v) => setCompressor({ releaseMs: v?.[0] ?? 250 })}
                            className={cn("h-1", !settings.compressorEnabled || !settings.enabled ? 'opacity-30' : '')}
                          />
                        </div>
                      </div>

                      <div className="space-y-2 pt-2 border-t border-border/10">
                        <div className="flex justify-between text-[10px] font-bold uppercase tracking-tight text-muted-foreground">
                          <span>Makeup Gain</span>
                          <span className="text-primary tabular-nums">{settings.compressor.makeupGainDb.toFixed(0)} dB</span>
                        </div>
                        <Slider
                          value={[settings.compressor.makeupGainDb]}
                          min={0}
                          max={18}
                          step={1}
                          onValueChange={(v) => setCompressor({ makeupGainDb: v?.[0] ?? 0 })}
                          className={cn("h-1.5", !settings.compressorEnabled || !settings.enabled ? 'opacity-30' : '')}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-border/60 bg-muted/30 p-5 shadow-sm relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-destructive/20" />
                    <div className="flex items-center justify-between mb-4">
                      <div className="text-xs font-bold uppercase tracking-wider text-foreground/80">Peak Limiter</div>
                      <Switch
                        checked={settings.limiterEnabled}
                        onCheckedChange={(v) => set({ limiterEnabled: v === true })}
                      />
                    </div>

                    <div className="space-y-6">
                      <div className="space-y-2">
                        <div className="flex justify-between text-[10px] font-bold uppercase tracking-tight text-muted-foreground">
                          <span>Ceiling</span>
                          <span className="text-destructive tabular-nums">{settings.limiter.thresholdDb.toFixed(1)} dB</span>
                        </div>
                        <Slider
                          value={[settings.limiter.thresholdDb]}
                          min={-12}
                          max={0}
                          step={0.5}
                          onValueChange={(v) => setLimiter({ thresholdDb: v?.[0] ?? -1 })}
                          className={cn("h-1.5", !settings.limiterEnabled || !settings.enabled ? 'opacity-30' : '')}
                        />
                      </div>

                      <div className="text-[10px] uppercase font-bold text-muted-foreground/40 leading-relaxed bg-background/20 p-2 rounded border border-border/10">
                        Zero-latency protection chain. Prevents digital clipping and ensures consistent broadcast loudness compliance.
                      </div>
                    </div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="output" className="mt-3">
                <div className="rounded-lg border border-border bg-muted/20 p-4">
                  <div className="text-sm font-medium">Output Gain</div>
                  <div className="mt-3 grid grid-cols-[1fr,auto] items-center gap-3">
                    <div className="text-xs text-muted-foreground">Gain</div>
                    <div className="text-xs tabular-nums">{settings.outputGainDb.toFixed(0)} dB</div>
                    <Slider
                      value={[settings.outputGainDb]}
                      min={-18}
                      max={18}
                      step={1}
                      onValueChange={(v) => set({ outputGainDb: v?.[0] ?? 0 })}
                      className={!settings.enabled ? 'opacity-50' : ''}
                    />
                  </div>

                  <div className="mt-2 text-xs text-muted-foreground">
                    Use this for final trim. Keep it conservative to maintain headroom.
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

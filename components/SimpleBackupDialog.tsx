import React, { useEffect, useMemo, useState, useRef } from 'react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { ScrollArea } from './ui/scroll-area';
import { Checkbox } from './ui/checkbox';
import { RadioGroup, RadioGroupItem } from './ui/radio-group';
import { Progress } from './ui/progress';
import { toast } from 'sonner';
import { ApiError, backupAPI, type DataCategory } from '../services/api';
import { Database, Upload, Download, CheckCircle, XCircle } from 'lucide-react';

interface SimpleBackupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SimpleBackupDialog({ open, onOpenChange }: SimpleBackupDialogProps) {
  const [loading, setLoading] = useState(false);
  const [validationResult, setValidationResult] = useState<any>(null);
  const [showValidationDialog, setShowValidationDialog] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const progressIntervalRef = useRef<number | null>(null);
  const statusPollIntervalRef = useRef<number | null>(null);
  const [activeOperation, setActiveOperation] = useState<'create' | 'upload' | 'restore' | null>(null);
  const [progressValue, setProgressValue] = useState<number>(0);
  const [progressLabel, setProgressLabel] = useState<string>('');
  const [dailyEnabled, setDailyEnabled] = useState(false);
  const [backupDirectoryPath, setBackupDirectoryPath] = useState<string>('');
  const [backupTimeOfDay, setBackupTimeOfDay] = useState<string>('02:00 AM');
  const [savingDailyConfig, setSavingDailyConfig] = useState(false);

  const stopProgressTimers = () => {
    if (progressIntervalRef.current != null) {
      window.clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
    if (statusPollIntervalRef.current != null) {
      window.clearInterval(statusPollIntervalRef.current);
      statusPollIntervalRef.current = null;
    }
  };

  const startSimulatedProgress = (label: string, startAt: number, cap: number) => {
    stopProgressTimers();
    setProgressLabel(label);
    setProgressValue(startAt);
    progressIntervalRef.current = window.setInterval(() => {
      setProgressValue((prev) => {
        const next = prev + Math.max(1, Math.round((cap - prev) * 0.08));
        return next >= cap ? cap : next;
      });
    }, 220);
  };

  useEffect(() => {
    return () => {
      stopProgressTimers();
    };
  }, []);

  const categories = useMemo(
    () =>
      [
        { key: 'library' as DataCategory, label: 'Library' },
        { key: 'playlists' as DataCategory, label: 'Playlists' },
        { key: 'queue' as DataCategory, label: 'Queue' },
        { key: 'scheduler' as DataCategory, label: 'Scheduler' },
        { key: 'history' as DataCategory, label: 'History' },
        { key: 'configs' as DataCategory, label: 'Settings' },
      ] as const,
    []
  );

  const [selectedCategories, setSelectedCategories] = useState<Record<string, boolean>>({
    library: true,
    playlists: true,
    queue: true,
    scheduler: true,
    history: true,
    configs: true,
  });

  const [restoreMode, setRestoreMode] = useState<'override' | 'merge'>('override');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const loadDaily = async () => {
      try {
        const res = await backupAPI.getDailyAuto();
        if (cancelled) return;
        setDailyEnabled(Boolean(res?.config?.enabled));
        setBackupDirectoryPath(String(res?.config?.directoryPath || ''));
        setBackupTimeOfDay(String(res?.config?.timeOfDay || '02:00 AM'));
      } catch (e: any) {
        if (!cancelled) {
          console.error('Failed to load daily auto-backup config', e);
        }
      }
    };

    void loadDaily();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const saveDailyAutoConfig = async (next?: Partial<{ enabled: boolean; directoryPath: string; timeOfDay: string }>) => {
    const enabled = next?.enabled ?? dailyEnabled;
    const directoryPath = next?.directoryPath ?? backupDirectoryPath;
    const timeOfDay = next?.timeOfDay ?? backupTimeOfDay;

    setSavingDailyConfig(true);
    try {
      const res = await backupAPI.setDailyAuto({
        enabled,
        directoryPath,
        timeOfDay,
      });
      setDailyEnabled(Boolean(res?.config?.enabled));
      setBackupDirectoryPath(String(res?.config?.directoryPath || directoryPath));
      setBackupTimeOfDay(String(res?.config?.timeOfDay || timeOfDay));
      toast.success('Backup schedule saved');
    } catch (e: any) {
      console.error('Failed to save daily auto-backup config', e);
      toast.error(e?.message || 'Failed to save backup schedule');
    } finally {
      setSavingDailyConfig(false);
    }
  };

  const chooseBackupDirectory = async () => {
    // Prefer native Electron picker when available.
    const w = window as any;
    try {
      if (w?.redioBackup?.selectDirectory) {
        const res = await w.redioBackup.selectDirectory();
        if (res?.ok && !res?.canceled && res?.path) {
          const chosen = String(res.path);
          setBackupDirectoryPath(chosen);
          await saveDailyAutoConfig({ directoryPath: chosen });
        }
        return;
      }
    } catch {
      // fall through
    }

    // Web fallback (Chromium): File System Access API.
    try {
      const dirHandle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
      const chosen = String((dirHandle as any)?.name || '');
      if (!chosen) {
        toast.error('Folder selected but no path available in this environment');
        return;
      }
      toast.error('Folder path is not available in browser mode. Use the packaged app for full folder-path scheduling.');
    } catch (error: any) {
      if (error?.name === 'AbortError') return;
      toast.error('Failed to choose backup directory');
    }
  };

  const handleCreateBackup = async () => {
    setActiveOperation('create');
    setLoading(true);
    try {
      setProgressLabel('Initializing backup…');
      setProgressValue(0);
      statusPollIntervalRef.current = window.setInterval(() => {
        backupAPI
          .getStatus()
          .then((status) => {
            const p = status?.currentJob?.progress;
            const step = status?.currentJob?.currentStep;
            if (typeof step === 'string' && step.trim()) {
              setProgressLabel(step);
            }
            if (typeof p === 'number' && Number.isFinite(p)) {
              setProgressValue(Math.round(p));
            }
          })
          .catch(() => {
          });
      }, 500);

      const w = window as any;
      if (w?.redioBackup?.selectDirectory) {
        const res = await w.redioBackup.selectDirectory();
        if (!res?.ok || res?.canceled || !res?.path) {
          return;
        }

        const outDir = String(res.path);
        const result = await backupAPI.create({ description: 'Manual backup', includeAudioFiles: true, outputDir: outDir });
        stopProgressTimers();
        setProgressValue(100);
        toast.success(`Backup saved to ${outDir}/${result.backup.filename}`);
        onOpenChange(false);
        return;
      }

      // Browser fallback: File System Access API download.
      const dirHandle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });

      const result = await backupAPI.create({ description: 'Manual backup', includeAudioFiles: true });

      const backupResponse = await fetch(`/api/backup/download/${result.backup.filename}`);
      if (!backupResponse.ok) {
        let details = '';
        try {
          details = await backupResponse.text();
        } catch {
        }
        throw new Error(details || `Download failed (${backupResponse.status})`);
      }
      const blob = await backupResponse.blob();

      const fileHandle = await dirHandle.getFileHandle(result.backup.filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();

      stopProgressTimers();
      setProgressValue(100);
      toast.success(`Backup saved to ${result.backup.filename}`);
      onOpenChange(false);
    } catch (error: any) {
      if (error.name === 'AbortError') {
        // User cancelled folder selection
        return;
      }
      const message = String(error?.message || '').trim();
      toast.error(message ? `Failed to create backup: ${message}` : 'Failed to create backup');
    } finally {
      stopProgressTimers();
      setActiveOperation(null);
      setProgressLabel('');
      setLoading(false);
    }
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const lower = file.name.toLowerCase();
    if (!(lower.endsWith('.sqlite') || lower.endsWith('.tar.gz') || lower.endsWith('.tgz'))) {
      toast.error('Only .sqlite or .tar.gz backup files are allowed');
      return;
    }

    setActiveOperation('upload');
    setLoading(true);

    try {
      startSimulatedProgress('Uploading…', 10, 80);

      // Upload file
      console.log('Starting upload for file:', file.name);
      const result = await backupAPI.upload(file);
      console.log('Upload result:', result);

      // Validate database structure
      startSimulatedProgress('Validating…', 82, 95);
      const validation = await backupAPI.validate(result.filename);
      console.log('Validation result:', validation);
      setValidationResult(validation);

      if (validation.isValid) {
        toast.success('Database structure is valid. You can now restore.');
        setShowValidationDialog(true);
      } else {
        toast.error('Database structure does not match. Cannot restore.');
        setShowValidationDialog(true);
      }
    } catch (error: any) {
      console.error('Upload error:', error);
      toast.error(`Failed to upload or validate database: ${error.message || 'Unknown error'}`);
    } finally {
      stopProgressTimers();
      setProgressValue(0);
      setProgressLabel('');
      setActiveOperation(null);
      setLoading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleRestore = async () => {
    if (!validationResult?.isValid) return;

    const picked = categories
      .map((c) => c.key)
      .filter((key) => selectedCategories[key]);

    if (picked.length === 0) {
      toast.error('Select at least one component to restore');
      return;
    }

    setActiveOperation('restore');
    setLoading(true);
    try {
      startSimulatedProgress('Restoring…', 10, 90);
      const result = await backupAPI.restore(validationResult.filename, {
        conflictResolution: restoreMode === 'merge' ? 'merge' : 'overwrite',
        selectiveRestore: {
          categories: picked,
          mode: 'include',
        },
      });

      stopProgressTimers();
      setProgressValue(100);
      toast.success('Restore completed');
      setShowValidationDialog(false);
      onOpenChange(false);
    } catch (error: any) {
      const message =
        error instanceof ApiError
          ? error.message
          : String(error?.message || error?.error || '').trim();

      toast.error(message ? `Failed to restore database: ${message}` : 'Failed to restore database');
    } finally {
      stopProgressTimers();
      setProgressValue(0);
      setProgressLabel('');
      setActiveOperation(null);
      setLoading(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg w-[95vw] gap-0 p-0 overflow-hidden bg-background border-border shadow-xl rounded-lg">
          <DialogHeader className="px-5 py-3.5 border-b border-border bg-muted/40">
            <DialogTitle className="flex items-center gap-2 text-base font-semibold tracking-tight text-foreground">
              <Database className="w-4 h-4 text-primary" />
              Backup & Restore
            </DialogTitle>
          </DialogHeader>

          <div className="p-5 space-y-4">
            {/* Automatic Daily Backup */}
            <div className="p-4 rounded-lg border border-border bg-muted/20 space-y-3">
              <div className="flex items-center justify-between gap-1">
                <div>
                  <h3 className="font-medium text-foreground mb-0.5 flex items-center gap-2 text-sm">
                    <Database className="w-4 h-4 text-primary" />
                    Daily Automatic Backup
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Runs every day at the configured time and saves a full backup to your selected folder.
                  </p>
                </div>

                <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={dailyEnabled}
                    disabled={savingDailyConfig}
                    onChange={(e) => {
                      const next = e.target.checked;
                      setDailyEnabled(next);
                      void saveDailyAutoConfig({ enabled: next });
                    }}
                  />
                  Enabled
                </label>
              </div>

              <div className="space-y-3">
                <div>
                  <div className="text-[11px] text-muted-foreground mb-1">Backup folder</div>
                  <div className="flex items-center gap-2 min-w-0 max-w-full overflow-hidden">
                    <div
                      className="flex-1 min-w-0 px-3 py-2 rounded-md border border-border bg-background text-[11px] text-foreground/90 truncate"
                      title={backupDirectoryPath || ''}
                    >
                      {backupDirectoryPath || 'Loading...'}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void chooseBackupDirectory()}
                      disabled={savingDailyConfig}
                      className="h-7 px-2 text-[11px] shrink-0"
                    >
                      Change
                    </Button>
                  </div>
                </div>

                <div>
                  <div className="text-[11px] text-muted-foreground mb-1">Scheduled time (HH:MM AM/PM)</div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={backupTimeOfDay}
                      onChange={(e) => setBackupTimeOfDay(e.target.value)}
                      onBlur={() => void saveDailyAutoConfig()}
                      placeholder="02:00 AM"
                      className="flex-1 h-8 px-3 rounded-md border border-border bg-background text-xs text-foreground outline-none"
                      disabled={savingDailyConfig}
                    />
                    <Button
                      size="sm"
                      onClick={() => void saveDailyAutoConfig()}
                      disabled={savingDailyConfig}
                      className="h-8 px-3 text-[11px]"
                    >
                      {savingDailyConfig ? 'Saving…' : 'Save'}
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            {/* Create Backup Section */}
            <div className="p-4 rounded-lg border border-border bg-muted/20">
              <h3 className="font-medium text-foreground mb-1 flex items-center gap-2 text-sm">
                <Download className="w-4 h-4 text-primary" />
                Create Backup
              </h3>
              <p className="text-xs text-muted-foreground mb-3">
                Generate a full database backup and save it to your chosen folder.
              </p>
              {loading && activeOperation === 'create' && (
                <div className="mb-3 space-y-2">
                  <div className="text-[11px] text-muted-foreground">{progressLabel || 'Creating backup…'}</div>
                  <Progress value={progressValue} />
                </div>
              )}
              <Button
                onClick={handleCreateBackup}
                disabled={loading}
                className="w-full h-9"
              >
                {loading ? 'Creating Backup...' : 'Create Backup'}
              </Button>
            </div>

            {/* Upload Database Section */}
            <div className="p-4 rounded-lg border border-border bg-muted/20">
              <h3 className="font-medium text-foreground mb-1 flex items-center gap-2 text-sm">
                <Upload className="w-4 h-4 text-primary" />
                Upload Database
              </h3>
              <p className="text-xs text-muted-foreground mb-3">
                Upload a .sqlite or .tar.gz backup file to restore. Database structure will be validated.
              </p>
              {loading && activeOperation === 'upload' && (
                <div className="mb-3 space-y-2">
                  <div className="text-[11px] text-muted-foreground">{progressLabel || 'Uploading…'}</div>
                  <Progress value={progressValue} />
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".sqlite,.tar.gz,.tgz,application/x-sqlite3,application/gzip,application/x-gzip,application/x-tgz"
                onChange={handleUpload}
                className="hidden"
                id="database-upload"
              />
              <Button
                onClick={() => fileInputRef.current?.click()}
                disabled={loading}
                variant="outline"
                className="w-full h-9"
              >
                {loading ? 'Uploading...' : 'Upload Database'}
              </Button>
            </div>


          </div>
        </DialogContent>
      </Dialog>

      {/* Validation Result Dialog */}
      <Dialog open={showValidationDialog} onOpenChange={setShowValidationDialog}>
        <DialogContent className="max-w-md bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white border-slate-700 shadow-2xl">
          <DialogHeader className="pb-4">
            <DialogTitle className="flex items-center gap-3 text-xl">
              {validationResult?.isValid ? (
                <div className="p-3 bg-green-600 rounded-lg">
                  <CheckCircle className="w-6 h-6" />
                </div>
              ) : (
                <div className="p-3 bg-red-600 rounded-lg">
                  <XCircle className="w-6 h-6" />
                </div>
              )}
              Database Validation
            </DialogTitle>
          </DialogHeader>

          {validationResult && (
            <div className="space-y-4">
              {validationResult.isValid ? (
                <div className="p-4 bg-green-600/20 border border-green-500/50 rounded-xl">
                  <div className="flex items-center gap-3 mb-2">
                    <CheckCircle className="w-5 h-5 text-green-400" />
                    <span className="font-semibold text-green-400">Database Structure Valid</span>
                  </div>
                  <p className="text-sm text-slate-300">
                    The uploaded database matches the current schema and can be safely restored.
                  </p>
                </div>
              ) : (
                <div className="p-4 bg-red-600/20 border border-red-500/50 rounded-xl">
                  <div className="flex items-center gap-3 mb-2">
                    <XCircle className="w-5 h-5 text-red-400" />
                    <span className="font-semibold text-red-400">Database Structure Invalid</span>
                  </div>
                  <p className="text-sm text-slate-300 mb-3">
                    The uploaded database does not match the current schema and cannot be restored.
                  </p>
                  {validationResult.errors && (
                    <div className="text-xs text-red-300 space-y-1">
                      {validationResult.errors.map((error: string, index: number) => (
                        <div key={index}>• {error}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {validationResult.isValid && (
                <div className="p-4 bg-slate-800/40 border border-slate-700/60 rounded-xl">
                  <div className="text-sm font-semibold text-white mb-3">Select what to restore</div>
                  <div className="grid grid-cols-2 gap-3">
                    {categories.map((cat) => (
                      <label key={cat.key} className="flex items-center gap-2 text-sm text-slate-200">
                        <Checkbox
                          checked={!!selectedCategories[cat.key]}
                          onCheckedChange={(checked) =>
                            setSelectedCategories((prev) => ({
                              ...prev,
                              [cat.key]: checked === true,
                            }))
                          }
                        />
                        <span>{cat.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {validationResult.isValid && (
                <div className="p-4 bg-slate-800/40 border border-slate-700/60 rounded-xl">
                  <div className="text-sm font-semibold text-white mb-3">Restore mode</div>
                  <RadioGroup
                    value={restoreMode}
                    onValueChange={(v) => setRestoreMode(v === 'merge' ? 'merge' : 'override')}
                    className="grid gap-3"
                  >
                    <label className="flex items-start gap-3 text-sm text-slate-200">
                      <RadioGroupItem value="override" className="mt-0.5" />
                      <div>
                        <div className="font-medium text-white">Override</div>
                        <div className="text-xs text-slate-400">Replace selected components completely.</div>
                      </div>
                    </label>
                    <label className="flex items-start gap-3 text-sm text-slate-200">
                      <RadioGroupItem value="merge" className="mt-0.5" />
                      <div>
                        <div className="font-medium text-white">Merge</div>
                        <div className="text-xs text-slate-400">Keep existing data; add only missing records.</div>
                      </div>
                    </label>
                  </RadioGroup>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-700">
                <Button
                  variant="outline"
                  onClick={() => setShowValidationDialog(false)}
                  className="border-slate-600/50 text-slate-300 hover:bg-slate-700/50 hover:text-white"
                >
                  Cancel
                </Button>
                {validationResult?.isValid && (
                  <div className="flex-1">
                    {/* {loading && activeOperation === 'restore' && (
                      <div className="mb-2 space-y-2">
                        <div className="text-xs text-slate-300">{progressLabel || 'Restoring…'}</div>
                        <Progress value={progressValue} className="bg-green-900/30" />
                      </div>
                    )} */}
                    <Button
                      onClick={handleRestore}
                      disabled={loading}
                      className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white shadow-lg hover:shadow-xl transition-all duration-300"
                    >
                      {loading ? 'Restoring...' : 'Restore Database'}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

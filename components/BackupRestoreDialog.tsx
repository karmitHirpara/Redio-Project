import { useEffect, useMemo, useState } from 'react';
import { backupAPI, BackupFile, getBackendOrigin } from '../services/api';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';

interface BackupRestoreDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function BackupRestoreDialog({ open, onOpenChange }: BackupRestoreDialogProps) {
  const [backups, setBackups] = useState<BackupFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedFilename, setSelectedFilename] = useState<string>('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [creatingBackup, setCreatingBackup] = useState(false);

  const selectedBackup = useMemo(() => backups.find((b) => b.filename === selectedFilename) || null, [backups, selectedFilename]);

  const loadBackups = async () => {
    setLoading(true);
    try {
      const res = await backupAPI.list();
      const next = Array.isArray(res?.backups) ? res.backups : [];
      setBackups(next);
      setSelectedFilename((prev) => {
        if (prev && next.some((b) => b.filename === prev)) return prev;
        return next[0]?.filename || '';
      });
    } catch (err: any) {
      toast.error(err?.message || 'Failed to load backups');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    void loadBackups();
  }, [open]);

  const doCreateBackup = async () => {
    setCreatingBackup(true);
    try {
      const res = await backupAPI.create({ description: 'Manual backup', includeAudioFiles: true });
      toast.success('Backup created', { description: res?.backup?.filename || 'Backup saved' });
      await loadBackups();
    } catch (err: any) {
      toast.error(err?.message || 'Backup failed');
    } finally {
      setCreatingBackup(false);
    }
  };

  const waitForBackend = async (timeoutMs: number) => {
    const started = Date.now();
    const url = `${getBackendOrigin()}/health`;
    while (Date.now() - started < timeoutMs) {
      try {
        const res = await fetch(url, { method: 'GET', cache: 'no-store' });
        if (res.ok) return true;
      } catch {
        // ignore
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  };

  const doRestore = async () => {
    if (!selectedFilename) return;
    setRestoring(true);
    try {
      await backupAPI.restore(selectedFilename);
      toast.success('Backup restored', { description: 'Restart required to apply changes' });
      setConfirmOpen(false);
      onOpenChange(false);

      const back = await waitForBackend(8000);
      if (back) {
        window.location.reload();
      } else {
        toast.error('Backend stopped after restore', {
          description: 'In dev mode you must restart backend: run "npm run dev:backend" then refresh the page.',
        });
      }
    } catch (err: any) {
      toast.error(err?.message || 'Restore failed');
    } finally {
      setRestoring(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Recover Data</DialogTitle>
            <DialogDescription>
              Restore the database from a previous backup. The app will restart after restore.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <Select value={selectedFilename} onValueChange={setSelectedFilename}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder={loading ? 'Loading backups…' : 'Select backup'} />
                  </SelectTrigger>
                  <SelectContent>
                    {backups.length === 0 ? (
                      <SelectItem value="__none__" disabled>
                        No backups found
                      </SelectItem>
                    ) : (
                      backups.map((b) => (
                        <SelectItem key={b.filename} value={b.filename}>
                          {b.filename}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>

              <Button size="sm" variant="outline" onClick={() => void doCreateBackup()} disabled={loading || restoring || creatingBackup}>
                {creatingBackup ? 'Backing up…' : 'Backup Now'}
              </Button>
            </div>

            {selectedBackup && (
              <div className="text-xs text-muted-foreground">
                <div>Last modified: {new Date(selectedBackup.modifiedAt).toLocaleString()}</div>
                <div>Size: {formatBytes(selectedBackup.bytes)}</div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={restoring}>
                Close
              </Button>
              <Button onClick={() => setConfirmOpen(true)} disabled={!selectedFilename || loading || restoring || backups.length === 0}>
                Restore
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore backup?</AlertDialogTitle>
            <AlertDialogDescription>
              This will replace your current data with the selected backup and restart the app.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restoring}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doRestore} disabled={restoring}>
              {restoring ? 'Restoring…' : 'Restore'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
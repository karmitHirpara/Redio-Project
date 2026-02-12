import React, { useMemo, useState, useRef } from 'react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { ScrollArea } from './ui/scroll-area';
import { Checkbox } from './ui/checkbox';
import { RadioGroup, RadioGroupItem } from './ui/radio-group';
import { toast } from 'sonner';
import { backupAPI, type DataCategory } from '../services/api';
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

  const handleCreateBackup = async () => {
    setLoading(true);
    try {
      // Open file picker to select folder
      const dirHandle = await (window as any).showDirectoryPicker({
        mode: 'readwrite'
      });
      
      // Create backup
      const result = await backupAPI.create({ description: 'Manual backup' });
      
      // Get the backup file
      const backupResponse = await fetch(`/api/backup/download/${result.backup.filename}`);
      const blob = await backupResponse.blob();
      
      // Save to selected folder
      const fileHandle = await dirHandle.getFileHandle(result.backup.filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      
      toast.success(`Backup saved to ${result.backup.filename}`);
      onOpenChange(false);
    } catch (error: any) {
      if (error.name === 'AbortError') {
        // User cancelled folder selection
        return;
      }
      toast.error('Failed to create backup');
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    if (!file.name.toLowerCase().endsWith('.sqlite')) {
      toast.error('Only .sqlite files are allowed');
      return;
    }
    
    setLoading(true);
    
    try {
      // Upload file
      console.log('Starting upload for file:', file.name);
      const result = await backupAPI.upload(file);
      console.log('Upload result:', result);
      
      // Validate database structure
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
    
    setLoading(true);
    try {
      const result = await backupAPI.restore(validationResult.filename, {
        conflictResolution: restoreMode === 'merge' ? 'merge' : 'overwrite',
        selectiveRestore: {
          categories: picked,
          mode: 'include',
        },
      });
      
      toast.success('Restore completed');
      setShowValidationDialog(false);
      onOpenChange(false);
    } catch (error) {
      toast.error('Failed to restore database');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white border-slate-700 shadow-2xl">
          <DialogHeader className="pb-6">
            <DialogTitle className="flex items-center gap-3 text-xl">
              <div className="p-3 bg-blue-600 rounded-lg">
                <Database className="w-6 h-6" />
              </div>
              Database Backup & Restore
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-6">
            {/* Create Backup Section */}
            <div className="p-6 bg-slate-800/50 backdrop-blur rounded-xl border border-slate-700/50">
              <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
                <Download className="w-5 h-5 text-blue-400" />
                Create Backup
              </h3>
              <p className="text-sm text-slate-400 mb-4">
                Generate a full database backup and save it to your chosen folder.
              </p>
              <Button 
                onClick={handleCreateBackup} 
                disabled={loading}
                className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white shadow-lg hover:shadow-xl transition-all duration-300"
              >
                {loading ? 'Creating Backup...' : 'Create Backup'}
              </Button>
            </div>
            
            {/* Upload Database Section */}
            <div className="p-6 bg-slate-800/50 backdrop-blur rounded-xl border border-slate-700/50">
              <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
                <Upload className="w-5 h-5 text-green-400" />
                Upload Database
              </h3>
              <p className="text-sm text-slate-400 mb-4">
                Upload a .sqlite file to restore. Database structure will be validated.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".sqlite"
                onChange={handleUpload}
                className="hidden"
                id="database-upload"
              />
              <Button
                onClick={() => fileInputRef.current?.click()}
                disabled={loading}
                variant="outline"
                className="w-full border-slate-600/50 text-slate-300 hover:bg-slate-700/50 hover:text-white shadow-lg hover:shadow-xl transition-all duration-300"
              >
                {loading ? 'Uploading...' : 'Upload Database'}
              </Button>
            </div>
            
            {/* System Status */}
            <div className="p-4 bg-slate-800/30 backdrop-blur rounded-xl border border-slate-700/50">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-300">Playback Protection</span>
                <span className="text-green-400 font-medium flex items-center gap-2">
                  <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                  Active
                </span>
              </div>
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
                  <Button 
                    onClick={handleRestore}
                    disabled={loading}
                    className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white shadow-lg hover:shadow-xl transition-all duration-300"
                  >
                    {loading ? 'Restoring...' : 'Restore Database'}
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

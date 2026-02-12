import React, { useState, useEffect, useRef } from 'react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from './ui/alert-dialog';
import { ScrollArea } from './ui/scroll-area';
import { toast } from 'sonner';
import { backupAPI, BackupFile, BackupJob, BackupConfig, DataCategory, ConflictResolution, UploadResult, RestoreResult } from '../services/api';
import { 
  Database, 
  Download, 
  Upload, 
  HardDriveDownload, 
  Settings, 
  Clock, 
  CheckCircle, 
  XCircle, 
  AlertTriangle,
  Play,
  Pause,
  Trash2,
  Eye,
  RefreshCw,
  FolderOpen,
  Plus,
  X,
  Shield,
  Zap
} from 'lucide-react';

interface ProfessionalBackupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DATA_CATEGORY_LABELS: Record<DataCategory, string> = {
  library: 'Music Library',
  playlists: 'Playlists',
  queue: 'Queue',
  scheduler: 'Scheduler',
  history: 'History',
  configs: 'Settings'
};

export function ProfessionalBackupDialog({ open, onOpenChange }: ProfessionalBackupDialogProps) {
  const [backups, setBackups] = useState<BackupFile[]>([]);
  const [currentJob, setCurrentJob] = useState<BackupJob | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedBackup, setSelectedBackup] = useState<BackupFile | null>(null);
  const [showRestoreDialog, setShowRestoreDialog] = useState(false);
  const [showPreviewDialog, setShowPreviewDialog] = useState(false);
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [previewData, setPreviewData] = useState<any>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  
  // Restore options
  const [restoreOptions, setRestoreOptions] = useState({
    conflictResolution: 'overwrite' as ConflictResolution,
    createRestorePoint: true,
    selectiveRestore: false,
    selectedCategories: [] as DataCategory[],
    restoreMode: 'include' as 'include' | 'exclude'
  });
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load data when dialog opens
  useEffect(() => {
    if (open) {
      loadData();
      const interval = setInterval(() => {
        if (currentJob?.status === 'running') {
          checkJobStatus();
        }
      }, 2000);
      return () => clearInterval(interval);
    }
  }, [open, currentJob?.status]);

  const loadData = async () => {
    try {
      const [backupsRes, statusRes] = await Promise.all([
        backupAPI.list(),
        backupAPI.getStatus()
      ]);
      
      setBackups(backupsRes.backups);
      setCurrentJob(statusRes.currentJob);
    } catch (error) {
      toast.error('Failed to load backup data');
    }
  };

  const checkJobStatus = async () => {
    try {
      const status = await backupAPI.getStatus();
      setCurrentJob(status.currentJob);
      
      if (status.currentJob?.status === 'completed') {
        toast.success('Full backup completed successfully');
        loadData();
      } else if (status.currentJob?.status === 'failed') {
        toast.error(`Backup failed: ${status.currentJob.error}`);
        loadData();
      }
    } catch (error) {
      console.error('Failed to check job status:', error);
    }
  };

  const handleCreateBackup = async () => {
    setLoading(true);
    try {
      await backupAPI.create({ description: 'Manual full backup' });
      toast.success('Full backup started - will not interrupt playback');
      loadData();
    } catch (error) {
      toast.error('Failed to start backup');
    } finally {
      setLoading(false);
    }
  };

  const handleCancelJob = async () => {
    if (!currentJob) return;
    
    try {
      await backupAPI.cancelJob(currentJob.id);
      toast.success('Backup cancelled');
      loadData();
    } catch (error) {
      toast.error('Failed to cancel backup');
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
    setUploadProgress(0);
    
    try {
      const result = await backupAPI.upload(file);
      toast.success(`Backup "${result.originalName}" uploaded successfully`);
      setShowUploadDialog(false);
      loadData();
    } catch (error) {
      toast.error('Failed to upload backup');
    } finally {
      setLoading(false);
      setUploadProgress(0);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDownload = async (backup: BackupFile) => {
    try {
      await backupAPI.download(backup.filename, backup.location);
      toast.success('Backup download started');
    } catch (error) {
      toast.error('Failed to download backup');
    }
  };

  const handlePreviewBackup = async (backup: BackupFile) => {
    try {
      const preview = await backupAPI.preview(backup.filename, backup.location);
      setPreviewData(preview);
      setShowPreviewDialog(true);
    } catch (error) {
      toast.error('Failed to preview backup');
    }
  };

  const handleRestoreBackup = async () => {
    if (!selectedBackup) return;
    
    setLoading(true);
    try {
      const options: any = {
        ...restoreOptions,
        location: selectedBackup.location
      };
      
      if (restoreOptions.selectiveRestore && restoreOptions.selectedCategories.length > 0) {
        options.selectiveRestore = {
          categories: restoreOptions.selectedCategories,
          mode: restoreOptions.restoreMode
        };
      }
      
      const result = await backupAPI.restore(selectedBackup.filename, options);
      
      if (result.selectiveRestore) {
        toast.success(`Selective restore completed: ${result.restoredCategories?.join(', ') || 'No categories'}`);
        setShowRestoreDialog(false);
        loadData();
      } else {
        toast.success('Full restore initiated. The application will restart safely.');
        setShowRestoreDialog(false);
        
        // Poll for backend to come back online
        setTimeout(() => {
          window.location.reload();
        }, 3000);
      }
    } catch (error) {
      toast.error('Failed to restore backup');
      setLoading(false);
    }
  };

  const handleDeleteBackup = async (backup: BackupFile) => {
    try {
      await backupAPI.delete(backup.filename, backup.location);
      toast.success('Backup deleted');
      loadData();
    } catch (error) {
      toast.error('Failed to delete backup');
    }
  };

  const toggleCategory = (category: DataCategory) => {
    setRestoreOptions(prev => ({
      ...prev,
      selectedCategories: prev.selectedCategories.includes(category)
        ? prev.selectedCategories.filter((c: DataCategory) => c !== category)
        : [...prev.selectedCategories, category]
    }));
  };

  const formatFileSize = (bytes: number) => {
    const sizes = ['B', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 B';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-7xl max-h-[95vh] bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white border-slate-700 shadow-2xl overflow-hidden">
          <DialogHeader className="pb-4 border-b border-slate-700">
            <DialogTitle className="flex items-center gap-4 text-2xl">
              <div className="p-3 bg-gradient-to-r from-blue-600 to-blue-700 rounded-xl shadow-lg">
                <Shield className="w-8 h-8" />
              </div>
              <div>
                <div className="font-bold">Professional Backup Manager</div>
                <div className="text-sm font-normal text-slate-400">Broadcast-Grade Data Protection System</div>
              </div>
            </DialogTitle>
          </DialogHeader>
          
          <div className="flex gap-6 p-6 h-[calc(95vh-140px)] overflow-hidden">
            {/* Left Panel - Backup Creation & Status */}
            <div className="w-1/2 space-y-4 overflow-y-auto pr-2">
              {/* Current Job Status */}
              {currentJob && (
                <div className="p-6 bg-slate-800/50 backdrop-blur rounded-xl border border-slate-700/50 shadow-lg">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold text-white flex items-center gap-3">
                      <div className="p-2 bg-yellow-500/20 rounded-lg">
                        <Zap className="w-5 h-5 text-yellow-400" />
                      </div>
                      Current Operation
                    </h3>
                    <div className="flex items-center gap-2">
                      {currentJob.status === 'running' && (
                        <Button size="sm" variant="outline" onClick={handleCancelJob} 
                          className="border-red-500/50 text-red-400 hover:bg-red-500/20 hover:text-red-300 hover:border-red-400">
                          <Pause className="w-4 h-4 mr-2" />
                          Cancel
                        </Button>
                      )}
                    </div>
                  </div>
                  
                  <div className="space-y-4">
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-300 font-medium">Full Database Backup</span>
                      <span className="text-white font-bold text-lg">{currentJob.progress}%</span>
                    </div>
                    
                    <div className="w-full bg-slate-700/50 rounded-full h-4 overflow-hidden">
                      <div 
                        className="bg-gradient-to-r from-blue-500 via-blue-600 to-blue-700 h-4 rounded-full transition-all duration-500 ease-out shadow-lg"
                        style={{ width: `${currentJob.progress}%` }}
                      />
                    </div>
                    
                    <p className="text-sm text-slate-400 font-medium">{currentJob.currentStep}</p>
                  </div>
                </div>
              )}
              
              {/* Quick Actions */}
              <div className="grid grid-cols-1 gap-4">
                <Button 
                  onClick={handleCreateBackup} 
                  disabled={loading || currentJob?.status === 'running'}
                  className="bg-gradient-to-r from-blue-600 via-blue-700 to-blue-800 hover:from-blue-700 hover:via-blue-800 hover:to-blue-900 text-white border-0 h-20 shadow-lg hover:shadow-xl transition-all duration-300"
                >
                  <Database className="w-6 h-6 mr-3" />
                  <div className="text-left">
                    <div className="font-bold text-lg">Create Backup</div>
                    <div className="text-sm opacity-90">Full Database Snapshot</div>
                  </div>
                </Button>
                
                <Button 
                  onClick={() => setShowUploadDialog(true)}
                  disabled={loading}
                  variant="outline"
                  className="border-slate-600/50 text-slate-300 hover:bg-slate-700/50 hover:text-white h-20 shadow-lg hover:shadow-xl transition-all duration-300"
                >
                  <Upload className="w-6 h-6 mr-3" />
                  <div className="text-left">
                    <div className="font-bold text-lg">Upload Backup</div>
                    <div className="text-sm opacity-90">.sqlite Files Only</div>
                  </div>
                </Button>
              </div>
              
              {/* System Status */}
              <div className="p-6 bg-slate-800/50 backdrop-blur rounded-xl border border-slate-700/50 shadow-lg">
                <h3 className="font-bold text-white mb-4 flex items-center gap-3">
                  <div className="p-2 bg-green-500/20 rounded-lg">
                    <CheckCircle className="w-5 h-5 text-green-400" />
                  </div>
                  System Status
                </h3>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between items-center p-2 bg-slate-700/30 rounded-lg">
                    <span className="text-slate-300">Playback Protection</span>
                    <span className="text-green-400 font-bold flex items-center gap-2">
                      <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                      Active
                    </span>
                  </div>
                  <div className="flex justify-between items-center p-2 bg-slate-700/30 rounded-lg">
                    <span className="text-slate-300">Backup Type</span>
                    <span className="text-blue-400 font-bold">Full Only</span>
                  </div>
                  <div className="flex justify-between items-center p-2 bg-slate-700/30 rounded-lg">
                    <span className="text-slate-300">Total Backups</span>
                    <span className="text-white font-bold">{backups.length}</span>
                  </div>
                </div>
              </div>
              
              <Button 
                onClick={loadData} 
                variant="outline" 
                className="w-full border-slate-600/50 text-slate-300 hover:bg-slate-700/50 hover:text-white shadow-lg hover:shadow-xl transition-all duration-300"
              >
                <RefreshCw className="w-5 h-5 mr-3" />
                Refresh List
              </Button>
            </div>
            
            {/* Right Panel - Backup List */}
            <div className="w-1/2 flex flex-col overflow-hidden">
              <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-700">
                <h3 className="font-bold text-white flex items-center gap-3">
                  <div className="p-2 bg-blue-500/20 rounded-lg">
                    <Database className="w-5 h-5 text-blue-400" />
                  </div>
                  Available Backups
                </h3>
                <span className="text-sm text-slate-400 font-medium bg-slate-700/50 px-3 py-1 rounded-full">{backups.length} files</span>
              </div>
              
              <ScrollArea className="flex-1 bg-slate-800/30 backdrop-blur rounded-xl border border-slate-700/50 shadow-inner">
                <div className="p-4 space-y-3">
                  {backups.map((backup) => (
                    <div 
                      key={`${backup.location}-${backup.filename}`}
                      className={`p-4 rounded-xl cursor-pointer transition-all duration-300 border ${
                        selectedBackup?.filename === backup.filename 
                          ? 'bg-blue-600/20 border-blue-500/50 shadow-lg shadow-blue-500/20' 
                          : 'bg-slate-700/30 hover:bg-slate-700/50 border-slate-600/30 hover:border-slate-500/50'
                      }`}
                      onClick={() => setSelectedBackup(backup)}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3 mb-3">
                            <div className={`w-3 h-3 rounded-full ${
                              backup.isValid ? 'bg-green-400 shadow-lg shadow-green-400/50' : 'bg-red-400 shadow-lg shadow-red-400/50'
                            }`} />
                            <span className="font-semibold text-sm text-white truncate">
                              {backup.metadata?.description || backup.filename}
                            </span>
                            {backup.metadata?.uploadedAt && (
                              <span className="bg-purple-600/30 text-purple-300 px-3 py-1 rounded-full text-xs font-medium border border-purple-500/30">
                                Uploaded
                              </span>
                            )}
                          </div>
                          
                          <div className="text-xs text-slate-400 space-y-2">
                            <div className="flex items-center gap-2">
                              <Clock className="w-3 h-3" />
                              {formatDate(backup.modifiedAt)}
                            </div>
                            <div className="flex items-center gap-2">
                              <Database className="w-3 h-3" />
                              {formatFileSize(backup.bytes)} • {backup.location}
                            </div>
                            {backup.metadata?.forceFullBackup && (
                              <div className="text-blue-400 font-medium flex items-center gap-2">
                                <Shield className="w-3 h-3" />
                                Full Database Backup
                              </div>
                            )}
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-2 ml-3">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              handlePreviewBackup(backup);
                            }}
                            className="text-slate-400 hover:text-white hover:bg-slate-600/50 h-8 w-8 p-0 rounded-lg"
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDownload(backup);
                            }}
                            className="text-slate-400 hover:text-white hover:bg-slate-600/50 h-8 w-8 p-0 rounded-lg"
                          >
                            <Download className="w-4 h-4" />
                          </Button>
                          
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedBackup(backup);
                              setShowRestoreDialog(true);
                            }}
                            className="text-slate-400 hover:text-white hover:bg-slate-600/50 h-8 w-8 p-0 rounded-lg"
                          >
                            <HardDriveDownload className="w-4 h-4" />
                          </Button>
                          
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteBackup(backup);
                            }}
                            className="text-slate-400 hover:text-red-400 hover:bg-red-600/20 h-8 w-8 p-0 rounded-lg"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                  
                  {backups.length === 0 && (
                    <div className="text-center py-16 text-slate-500">
                      <div className="p-4 bg-slate-700/30 rounded-xl inline-block mb-4">
                        <Database className="w-16 h-16 opacity-30" />
                      </div>
                      <p className="text-lg font-semibold mb-2">No Backups Available</p>
                      <p className="text-sm opacity-75">Create your first backup to get started</p>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      
      {/* Upload Dialog */}
      <Dialog open={showUploadDialog} onOpenChange={setShowUploadDialog}>
        <DialogContent className="max-w-md bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white border-slate-700 shadow-2xl">
          <DialogHeader className="pb-4 border-b border-slate-700">
            <DialogTitle className="flex items-center gap-3 text-xl">
              <div className="p-2 bg-purple-600 rounded-lg">
                <Upload className="w-6 h-6" />
              </div>
              Upload Backup File
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-6 py-4">
            <div className="p-6 border-2 border-dashed border-slate-600/50 rounded-xl text-center bg-slate-800/30 backdrop-blur">
              <Upload className="w-12 h-12 mx-auto mb-4 text-slate-400" />
              <p className="text-sm text-slate-300 mb-4 font-medium">Select a .sqlite backup file</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".sqlite"
                onChange={handleUpload}
                className="hidden"
                id="backup-upload"
              />
              <Button
                onClick={() => fileInputRef.current?.click()}
                disabled={loading}
                className="bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 shadow-lg hover:shadow-xl transition-all duration-300"
              >
                Choose File
              </Button>
            </div>
            
            {loading && (
              <div className="text-center text-sm text-slate-400 p-4 bg-slate-800/30 rounded-lg">
                <div className="flex items-center justify-center gap-3">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Uploading and validating backup...
                </div>
              </div>
            )}
          </div>
          
          <div className="flex justify-end pt-4 border-t border-slate-700">
            <Button variant="outline" onClick={() => setShowUploadDialog(false)} 
              className="border-slate-600/50 text-slate-300 hover:bg-slate-700/50 hover:text-white">
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      
      {/* Restore Dialog with Selective Options */}
      <AlertDialog open={showRestoreDialog} onOpenChange={setShowRestoreDialog}>
        <AlertDialogContent className="max-w-3xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white border-slate-700 shadow-2xl">
          <AlertDialogHeader className="pb-4 border-b border-slate-700">
            <AlertDialogTitle className="flex items-center gap-3 text-xl">
              <div className="p-2 bg-green-600 rounded-lg">
                <HardDriveDownload className="w-6 h-6" />
              </div>
              Restore Backup
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              Restore from "{selectedBackup?.filename}". Choose restore options below.
            </AlertDialogDescription>
          </AlertDialogHeader>
          
          <div className="py-6 space-y-6 max-h-[60vh] overflow-y-auto">
            <div>
              <label className="flex items-center gap-3 text-sm font-medium mb-4 p-3 bg-slate-800/30 rounded-lg cursor-pointer hover:bg-slate-800/50 transition-colors">
                <input
                  type="radio"
                  checked={!restoreOptions.selectiveRestore}
                  onChange={() => setRestoreOptions(prev => ({ ...prev, selectiveRestore: false }))}
                  className="w-4 h-4"
                />
                <div>
                  <div className="font-semibold">Full Database Restore</div>
                  <div className="text-xs text-slate-400">Requires application restart</div>
                </div>
              </label>
              
              <label className="flex items-center gap-3 text-sm font-medium p-3 bg-slate-800/30 rounded-lg cursor-pointer hover:bg-slate-800/50 transition-colors">
                <input
                  type="radio"
                  checked={restoreOptions.selectiveRestore}
                  onChange={() => setRestoreOptions(prev => ({ ...prev, selectiveRestore: true }))}
                  className="w-4 h-4"
                />
                <div>
                  <div className="font-semibold">Selective Restore</div>
                  <div className="text-xs text-slate-400">No restart required</div>
                </div>
              </label>
            </div>
            
            {restoreOptions.selectiveRestore && (
              <div className="space-y-4 p-4 bg-slate-800/30 backdrop-blur rounded-xl border border-slate-700/50">
                <div>
                  <label className="text-sm font-semibold mb-3 block">Restore Mode</label>
                  <Select 
                    value={restoreOptions.restoreMode} 
                    onValueChange={(value: 'include' | 'exclude') => 
                      setRestoreOptions(prev => ({ ...prev, restoreMode: value }))
                    }
                  >
                    <SelectTrigger className="bg-slate-700/50 border-slate-600/50 hover:bg-slate-700/70">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-800 border-slate-700">
                      <SelectItem value="include" className="hover:bg-slate-700">Include Selected</SelectItem>
                      <SelectItem value="exclude" className="hover:bg-slate-700">Exclude Selected</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div>
                  <label className="text-sm font-semibold mb-3 block">Data Categories</label>
                  <div className="grid grid-cols-2 gap-3">
                    {Object.entries(DATA_CATEGORY_LABELS).map(([value, label]) => (
                      <label key={value} className="flex items-center gap-3 text-sm p-2 bg-slate-700/30 rounded-lg cursor-pointer hover:bg-slate-700/50 transition-colors">
                        <input
                          type="checkbox"
                          checked={restoreOptions.selectedCategories.includes(value as DataCategory)}
                          onChange={() => toggleCategory(value as DataCategory)}
                          className="w-4 h-4"
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}
            
            <div>
              <label className="text-sm font-semibold mb-3 block">Conflict Resolution</label>
              <Select 
                value={restoreOptions.conflictResolution} 
                onValueChange={(value: ConflictResolution) => 
                  setRestoreOptions(prev => ({ ...prev, conflictResolution: value }))
                }
              >
                <SelectTrigger className="bg-slate-700/50 border-slate-600/50 hover:bg-slate-700/70">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  <SelectItem value="overwrite" className="hover:bg-slate-700">Overwrite Existing</SelectItem>
                  <SelectItem value="merge" className="hover:bg-slate-700">Merge Where Possible</SelectItem>
                  <SelectItem value="skip" className="hover:bg-slate-700">Skip Conflicts</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <label className="flex items-center gap-3 text-sm p-3 bg-slate-800/30 rounded-lg cursor-pointer hover:bg-slate-800/50 transition-colors">
              <input
                type="checkbox"
                checked={restoreOptions.createRestorePoint}
                onChange={(e) => setRestoreOptions(prev => ({ 
                  ...prev, 
                  createRestorePoint: e.target.checked 
                }))}
                className="w-4 h-4"
              />
              <div>
                <div className="font-semibold">Create restore point before restoring</div>
                <div className="text-xs text-slate-400">Automatically backup current state</div>
              </div>
            </label>
          </div>
          
          <AlertDialogFooter className="pt-4 border-t border-slate-700">
            <AlertDialogCancel className="border-slate-600/50 text-slate-300 hover:bg-slate-700/50 hover:text-white">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleRestoreBackup} 
              disabled={loading || (restoreOptions.selectiveRestore && restoreOptions.selectedCategories.length === 0)}
              className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 shadow-lg hover:shadow-xl transition-all duration-300"
            >
              {loading ? 'Restoring...' : 'Restore Backup'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      
      {/* Preview Dialog */}
      <Dialog open={showPreviewDialog} onOpenChange={setShowPreviewDialog}>
        <DialogContent className="max-w-md bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white border-slate-700 shadow-2xl">
          <DialogHeader className="pb-4 border-b border-slate-700">
            <DialogTitle className="flex items-center gap-3 text-xl">
              <div className="p-2 bg-blue-600 rounded-lg">
                <Eye className="w-6 h-6" />
              </div>
              Backup Preview
            </DialogTitle>
          </DialogHeader>
          
          {previewData && (
            <div className="space-y-6 py-4">
              <div className="p-4 bg-slate-800/30 backdrop-blur rounded-xl border border-slate-700/50">
                <h4 className="font-semibold mb-4 text-white flex items-center gap-2">
                  <Database className="w-4 h-4" />
                  Contents
                </h4>
                <div className="grid grid-cols-2 gap-3 text-sm text-slate-300">
                  {previewData.preview.tracks !== undefined && (
                    <div className="p-2 bg-slate-700/30 rounded-lg">
                      <div className="font-medium text-white">Tracks</div>
                      <div>{previewData.preview.tracks}</div>
                    </div>
                  )}
                  {previewData.preview.playlists !== undefined && (
                    <div className="p-2 bg-slate-700/30 rounded-lg">
                      <div className="font-medium text-white">Playlists</div>
                      <div>{previewData.preview.playlists}</div>
                    </div>
                  )}
                  {previewData.preview.queueItems !== undefined && (
                    <div className="p-2 bg-slate-700/30 rounded-lg">
                      <div className="font-medium text-white">Queue Items</div>
                      <div>{previewData.preview.queueItems}</div>
                    </div>
                  )}
                  {previewData.preview.schedules !== undefined && (
                    <div className="p-2 bg-slate-700/30 rounded-lg">
                      <div className="font-medium text-white">Schedules</div>
                      <div>{previewData.preview.schedules}</div>
                    </div>
                  )}
                </div>
              </div>
              
              <div className="p-4 bg-slate-800/30 backdrop-blur rounded-xl border border-slate-700/50">
                <h4 className="font-semibold mb-4 text-white flex items-center gap-2">
                  <Shield className="w-4 h-4" />
                  Metadata
                </h4>
                <div className="text-sm space-y-3 text-slate-300">
                  <div className="flex justify-between p-2 bg-slate-700/30 rounded-lg">
                    <span>Type</span>
                    <span className="text-white font-medium">Full Database Backup</span>
                  </div>
                  <div className="flex justify-between p-2 bg-slate-700/30 rounded-lg">
                    <span>Created</span>
                    <span className="text-white font-medium">{formatDate(previewData.metadata.createdAt)}</span>
                  </div>
                  <div className="flex justify-between p-2 bg-slate-700/30 rounded-lg">
                    <span>Size</span>
                    <span className="text-white font-medium">{formatFileSize(previewData.metadata.size)}</span>
                  </div>
                  <div className="flex justify-between p-2 bg-slate-700/30 rounded-lg">
                    <span>Version</span>
                    <span className="text-white font-medium">{previewData.metadata.version}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

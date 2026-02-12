import React, { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from './ui/alert-dialog';
import { ScrollArea } from './ui/scroll-area';
import { toast } from 'sonner';
import { backupAPI, BackupFile, BackupJob, BackupConfig, BackupType, DataCategory, StorageType, ConflictResolution } from '../services/api';
import { 
  Database, 
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
  X
} from 'lucide-react';

interface BackupManagerDialogProps {
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

const BACKUP_TYPE_LABELS: Record<BackupType, string> = {
  full: 'Full Backup',
  incremental: 'Incremental',
  selective: 'Selective'
};

export function BackupManagerDialog({ open, onOpenChange }: BackupManagerDialogProps) {
  const [backups, setBackups] = useState<BackupFile[]>([]);
  const [config, setConfig] = useState<BackupConfig | null>(null);
  const [currentJob, setCurrentJob] = useState<BackupJob | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedBackup, setSelectedBackup] = useState<BackupFile | null>(null);
  const [showRestoreDialog, setShowRestoreDialog] = useState(false);
  const [showPreviewDialog, setShowPreviewDialog] = useState(false);
  const [showConfigDialog, setShowConfigDialog] = useState(false);
  const [previewData, setPreviewData] = useState<any>(null);
  
  // Backup creation state
  const [createOptions, setCreateOptions] = useState<{
    type: BackupType;
    categories: DataCategory[];
    location: string;
    description: string;
  }>({
    type: 'full',
    categories: Object.values(DATA_CATEGORY_LABELS).map((_, index) => Object.keys(DATA_CATEGORY_LABELS)[index] as DataCategory),
    location: '',
    description: ''
  });
  
  // Restore options
  const [restoreOptions, setRestoreOptions] = useState({
    conflictResolution: 'overwrite' as ConflictResolution,
    createRestorePoint: true
  });

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
      const [backupsRes, configRes, statusRes] = await Promise.all([
        backupAPI.list(),
        backupAPI.getConfig(),
        backupAPI.getStatus()
      ]);
      
      setBackups(backupsRes.backups);
      setConfig(configRes.config);
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
        toast.success('Backup completed successfully');
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
      await backupAPI.create(createOptions);
      toast.success('Backup started');
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
      await backupAPI.restore(selectedBackup.filename, {
        ...restoreOptions,
        location: selectedBackup.location
      });
      
      toast.success('Restore initiated. The application will restart.');
      setShowRestoreDialog(false);
      
      // Poll for backend to come back online
      setTimeout(() => {
        window.location.reload();
      }, 3000);
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

  const formatFileSize = (bytes: number) => {
    const sizes = ['B', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 B';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const toggleCategory = (category: DataCategory) => {
    setCreateOptions((prev) => ({
      ...prev,
      categories: prev.categories.includes(category)
        ? prev.categories.filter((c: DataCategory) => c !== category)
        : [...prev.categories, category]
    }));
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Database className="w-5 h-5" />
              Professional Backup Manager
            </DialogTitle>
          </DialogHeader>
          
          <div className="flex gap-6">
            {/* Left Panel - Backup Creation & Status */}
            <div className="w-1/2 space-y-4">
              {/* Current Job Status */}
              {currentJob && (
                <div className="p-4 border rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-medium">Current Job</h3>
                    <div className="flex items-center gap-2">
                      {currentJob.status === 'running' && (
                        <Button size="sm" variant="outline" onClick={handleCancelJob}>
                          <Pause className="w-4 h-4 mr-1" />
                          Cancel
                        </Button>
                      )}
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <div>Type: {BACKUP_TYPE_LABELS[currentJob.type as BackupType]}</div>
                      <span>{currentJob.progress}%</span>
                    </div>
                    
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div 
                        className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${currentJob.progress}%` }}
                      />
                    </div>
                    
                    <p className="text-sm text-gray-600">{currentJob.currentStep}</p>
                  </div>
                </div>
              )}
              
              {/* Create Backup */}
              <div className="p-4 border rounded-lg">
                <h3 className="font-medium mb-3">Create Backup</h3>
                
                <div className="space-y-3">
                  <div>
                    <label className="text-sm font-medium">Backup Type</label>
                    <Select value={createOptions.type} onValueChange={(value: BackupType) => 
                      setCreateOptions(prev => ({ ...prev, type: value }))
                    }>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(BACKUP_TYPE_LABELS).map(([value, label]) => (
                          <SelectItem key={value} value={value}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  
                  {createOptions.type === 'selective' && (
                    <div>
                      <label className="text-sm font-medium">Data Categories</label>
                      <div className="grid grid-cols-2 gap-2 mt-1">
                        {Object.entries(DATA_CATEGORY_LABELS).map(([value, label]) => (
                          <label key={value} className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={createOptions.categories.includes(value as DataCategory)}
                              onChange={() => toggleCategory(value as DataCategory)}
                            />
                            {label}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  <div>
                    <label className="text-sm font-medium">Description (optional)</label>
                    <input
                      type="text"
                      className="w-full mt-1 px-3 py-2 border rounded-md"
                      placeholder="Backup description..."
                      value={createOptions.description}
                      onChange={(e) => setCreateOptions(prev => ({ ...prev, description: e.target.value }))}
                    />
                  </div>
                  
                  <Button 
                    onClick={handleCreateBackup} 
                    disabled={loading || currentJob?.status === 'running'}
                    className="w-full"
                  >
                    <Database className="w-4 h-4 mr-2" />
                    {currentJob?.status === 'running' ? 'Backup in Progress...' : 'Create Backup'}
                  </Button>
                </div>
              </div>
              
              {/* Quick Actions */}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setShowConfigDialog(true)} className="flex-1">
                  <Settings className="w-4 h-4 mr-2" />
                  Settings
                </Button>
                <Button variant="outline" onClick={loadData} className="flex-1">
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Refresh
                </Button>
              </div>
            </div>
            
            {/* Right Panel - Backup List */}
            <div className="w-1/2">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-medium">Available Backups</h3>
                <span className="text-sm text-gray-500">{backups.length} backups</span>
              </div>
              
              <ScrollArea className="h-96 border rounded-lg">
                <div className="p-2 space-y-2">
                  {backups.map((backup) => (
                    <div 
                      key={`${backup.location}-${backup.filename}`}
                      className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                        selectedBackup?.filename === backup.filename ? 'bg-blue-50 border-blue-200' : 'hover:bg-gray-50'
                      }`}
                      onClick={() => setSelectedBackup(backup)}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <div className={`w-2 h-2 rounded-full ${
                              backup.isValid ? 'bg-green-500' : 'bg-red-500'
                            }`} />
                            <span className="font-medium text-sm truncate">
                              {backup.metadata?.description || backup.filename}
                            </span>
                          </div>
                          
                          <div className="text-xs text-gray-500 space-y-1">
                            <div>{formatDate(backup.modifiedAt)}</div>
                            <div>{formatFileSize(backup.bytes)} • {backup.location}</div>
                            {backup.metadata && (
                              <div className="flex items-center gap-2">
                                <span className="bg-gray-100 px-1 rounded">
                                  {BACKUP_TYPE_LABELS[backup.metadata.type]}
                                </span>
                                {backup.metadata.categories.map((cat: DataCategory) => (
                                  <span key={cat} className="bg-blue-100 px-1 rounded text-xs">
                                    {DATA_CATEGORY_LABELS[cat].split(' ')[0]}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-1 ml-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              handlePreviewBackup(backup);
                            }}
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedBackup(backup);
                              setShowRestoreDialog(true);
                            }}
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
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                  
                  {backups.length === 0 && (
                    <div className="text-center py-8 text-gray-500">
                      <Database className="w-12 h-12 mx-auto mb-2 opacity-50" />
                      <p>No backups available</p>
                      <p className="text-sm">Create your first backup to get started</p>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      
      {/* Restore Confirmation Dialog */}
      <AlertDialog open={showRestoreDialog} onOpenChange={setShowRestoreDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore Backup</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to restore from "{selectedBackup?.filename}"? 
              This action will replace your current data and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          
          <div className="py-4 space-y-3">
            <div>
              <label className="text-sm font-medium">Conflict Resolution</label>
              <Select 
                value={restoreOptions.conflictResolution} 
                onValueChange={(value: ConflictResolution) => 
                  setRestoreOptions(prev => ({ ...prev, conflictResolution: value }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="overwrite">Overwrite Existing</SelectItem>
                  <SelectItem value="merge">Merge Where Possible</SelectItem>
                  <SelectItem value="skip">Skip Conflicts</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={restoreOptions.createRestorePoint}
                onChange={(e) => setRestoreOptions(prev => ({ 
                  ...prev, 
                  createRestorePoint: e.target.checked 
                }))}
              />
              Create restore point before restoring
            </label>
          </div>
          
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRestoreBackup} disabled={loading}>
              Restore Backup
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      
      {/* Preview Dialog */}
      <Dialog open={showPreviewDialog} onOpenChange={setShowPreviewDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Backup Preview</DialogTitle>
          </DialogHeader>
          
          {previewData && (
            <div className="space-y-4">
              <div>
                <h4 className="font-medium mb-2">Contents</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {previewData.preview.tracks !== undefined && (
                    <div>Tracks: {previewData.preview.tracks}</div>
                  )}
                  {previewData.preview.playlists !== undefined && (
                    <div>Playlists: {previewData.preview.playlists}</div>
                  )}
                  {previewData.preview.queueItems !== undefined && (
                    <div>Queue Items: {previewData.preview.queueItems}</div>
                  )}
                  {previewData.preview.schedules !== undefined && (
                    <div>Schedules: {previewData.preview.schedules}</div>
                  )}
                </div>
              </div>
              
              <div>
                <h4 className="font-medium mb-2">Metadata</h4>
                <div className="text-sm space-y-1">
                  <div>Type: {BACKUP_TYPE_LABELS[previewData.metadata.type]}</div>
                  <div>Created: {formatDate(previewData.metadata.createdAt)}</div>
                  <div>Size: {formatFileSize(previewData.metadata.size)}</div>
                  <div>Version: {previewData.metadata.version}</div>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

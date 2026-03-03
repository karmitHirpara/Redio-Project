import React, { useState } from 'react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Switch } from './ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { toast } from 'sonner';
import { backupAPI, BackupConfig, StorageType, BackupType } from '../services/api';
import { Plus, X, FolderOpen, TestTube, Trash2 } from 'lucide-react';

interface BackupSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: BackupConfig | null;
  onConfigUpdate: (config: BackupConfig) => void;
}

export function BackupSettingsDialog({ 
  open, 
  onOpenChange, 
  config, 
  onConfigUpdate 
}: BackupSettingsDialogProps) {
  const [localConfig, setLocalConfig] = useState<BackupConfig>(config || {
    storageLocations: [],
    retentionPolicy: { keepDaily: 7, keepWeekly: 4, keepMonthly: 12 },
    compressionEnabled: false,
    includeAudioFiles: false,
    defaultBackupType: 'full'
  });
  
  const [testingLocation, setTestingLocation] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  React.useEffect(() => {
    if (config) {
      setLocalConfig(config);
    }
  }, [config]);

  const handleSave = async () => {
    setLoading(true);
    try {
      const updated = await backupAPI.updateConfig(localConfig);
      onConfigUpdate(updated.config);
      toast.success('Backup settings saved');
      onOpenChange(false);
    } catch (error) {
      toast.error('Failed to save settings');
    } finally {
      setLoading(false);
    }
  };

  const handleAddLocation = () => {
    const newLocation = {
      name: `Location ${localConfig.storageLocations.length + 1}`,
      type: 'local' as StorageType,
      path: ''
    };
    
    setLocalConfig(prev => ({
      ...prev,
      storageLocations: [...prev.storageLocations, newLocation]
    }));
  };

  const handleUpdateLocation = (index: number, updates: Partial<typeof localConfig.storageLocations[0]>) => {
    setLocalConfig((prev: BackupConfig) => ({
      ...prev,
      storageLocations: prev.storageLocations.map((loc: any, i: number) => 
        i === index ? { ...loc, ...updates } : loc
      )
    }));
  };

  const handleRemoveLocation = (index: number) => {
    setLocalConfig((prev: BackupConfig) => ({
      ...prev,
      storageLocations: prev.storageLocations.filter((_: any, i: number) => i !== index)
    }));
  };

  const handleTestLocation = async (index: number) => {
    const location = localConfig.storageLocations[index];
    if (!location.path) {
      toast.error('Please specify a path first');
      return;
    }
    
    setTestingLocation(location.name);
    try {
      const result = await backupAPI.testLocation(location.type, location.path);
      if (result.ok) {
        toast.success(`Location "${location.name}" is accessible`);
      } else {
        toast.error(`Location test failed: ${result.error}`);
      }
    } catch (error) {
      toast.error('Failed to test location');
    } finally {
      setTestingLocation(null);
    }
  };

  const handleSelectPath = async (index: number) => {
    // In a real Electron app, this would open a native folder picker
    // For now, we'll just prompt for input
    const path = prompt('Enter folder path:');
    if (path) {
      handleUpdateLocation(index, { path });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Backup Settings</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6">
          {/* Storage Locations */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <Label className="text-base font-medium">Storage Locations</Label>
              <Button size="sm" onClick={handleAddLocation}>
                <Plus className="w-4 h-4 mr-2" />
                Add Location
              </Button>
            </div>
            
            <div className="space-y-3">
              {localConfig.storageLocations.map((location, index) => (
                <div key={index} className="p-3 border rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <Input
                      placeholder="Location name"
                      value={location.name}
                      onChange={(e) => handleUpdateLocation(index, { name: e.target.value })}
                      className="flex-1"
                    />
                    <Select 
                      value={location.type} 
                      onValueChange={(value: StorageType) => 
                        handleUpdateLocation(index, { type: value })
                      }
                    >
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="local">Local</SelectItem>
                        <SelectItem value="external">External</SelectItem>
                        <SelectItem value="network">Network</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleTestLocation(index)}
                      disabled={testingLocation === location.name}
                    >
                      {testingLocation === location.name ? (
                        <TestTube className="w-4 h-4 animate-pulse" />
                      ) : (
                        <TestTube className="w-4 h-4" />
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleRemoveLocation(index)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                  
                  {location.type === 'local' && (
                    <div className="flex items-center gap-2">
                      <Input
                        placeholder="Folder path"
                        value={location.path || ''}
                        onChange={(e) => handleUpdateLocation(index, { path: e.target.value })}
                        className="flex-1"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleSelectPath(index)}
                      >
                        <FolderOpen className="w-4 h-4" />
                      </Button>
                    </div>
                  )}
                  
                  {location.type === 'network' && (
                    <div className="space-y-2">
                      <Input
                        placeholder="Network path (e.g., //server/backups)"
                        value={location.networkPath || ''}
                        onChange={(e) => handleUpdateLocation(index, { networkPath: e.target.value })}
                      />
                      <div className="flex gap-2">
                        <Input
                          placeholder="Username (optional)"
                          value={location.credentials?.username || ''}
                          onChange={(e) => handleUpdateLocation(index, {
                            credentials: { 
                              ...location.credentials, 
                              username: e.target.value 
                            }
                          })}
                        />
                        <Input
                          type="password"
                          placeholder="Password (optional)"
                          value={location.credentials?.password || ''}
                          onChange={(e) => handleUpdateLocation(index, {
                            credentials: { 
                              ...location.credentials, 
                              password: e.target.value 
                            }
                          })}
                        />
                      </div>
                    </div>
                  )}
                </div>
              ))}
              
              {localConfig.storageLocations.length === 0 && (
                <div className="text-center py-4 text-gray-500 border rounded-lg">
                  <FolderOpen className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>No storage locations configured</p>
                  <p className="text-sm">Add a location to store backups</p>
                </div>
              )}
            </div>
          </div>
          
          {/* Retention Policy */}
          <div>
            <Label className="text-base font-medium mb-3 block">Retention Policy</Label>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label htmlFor="keepDaily" className="text-sm">Keep Daily</Label>
                <Input
                  id="keepDaily"
                  type="number"
                  min="1"
                  max="30"
                  value={localConfig.retentionPolicy.keepDaily}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLocalConfig((prev: BackupConfig) => ({
                    ...prev,
                    retentionPolicy: {
                      ...prev.retentionPolicy,
                      keepDaily: parseInt(e.target.value) || 7
                    }
                  }))}
                />
              </div>
              <div>
                <Label htmlFor="keepWeekly" className="text-sm">Keep Weekly</Label>
                <Input
                  id="keepWeekly"
                  type="number"
                  min="1"
                  max="12"
                  value={localConfig.retentionPolicy.keepWeekly}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLocalConfig((prev: BackupConfig) => ({
                    ...prev,
                    retentionPolicy: {
                      ...prev.retentionPolicy,
                      keepWeekly: parseInt(e.target.value) || 4
                    }
                  }))}
                />
              </div>
              <div>
                <Label htmlFor="keepMonthly" className="text-sm">Keep Monthly</Label>
                <Input
                  id="keepMonthly"
                  type="number"
                  min="1"
                  max="24"
                  value={localConfig.retentionPolicy.keepMonthly}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLocalConfig((prev: BackupConfig) => ({
                    ...prev,
                    retentionPolicy: {
                      ...prev.retentionPolicy,
                      keepMonthly: parseInt(e.target.value) || 12
                    }
                  }))}
                />
              </div>
            </div>
          </div>
          
          {/* Backup Options */}
          <div>
            <Label className="text-base font-medium mb-3 block">Backup Options</Label>
            
            <div className="space-y-4">
              <div>
                <Label htmlFor="defaultType" className="text-sm">Default Backup Type</Label>
                <Select 
                  value={localConfig.defaultBackupType} 
                  onValueChange={(value: BackupType) => 
                    setLocalConfig((prev: BackupConfig) => ({ ...prev, defaultBackupType: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full">Full Backup</SelectItem>
                    <SelectItem value="incremental">Incremental</SelectItem>
                    <SelectItem value="selective">Selective</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="compression" className="text-sm font-medium">
                    Enable Compression
                  </Label>
                  <p className="text-xs text-gray-500">
                    Reduce backup size but may increase processing time
                  </p>
                </div>
                <Switch
                  id="compression"
                  checked={localConfig.compressionEnabled}
                  onCheckedChange={(checked) => 
                    setLocalConfig((prev: BackupConfig) => ({ ...prev, compressionEnabled: checked }))
                  }
                />
              </div>
              
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="includeAudio" className="text-sm font-medium">
                    Include Audio Files
                  </Label>
                  <p className="text-xs text-gray-500">
                    Creates larger backups but includes actual audio files
                  </p>
                </div>
                <Switch
                  id="includeAudio"
                  checked={localConfig.includeAudioFiles}
                  onCheckedChange={(checked) => 
                    setLocalConfig((prev: BackupConfig) => ({ ...prev, includeAudioFiles: checked }))
                  }
                />
              </div>
            </div>
          </div>
        </div>
        
        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading ? 'Saving...' : 'Save Settings'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
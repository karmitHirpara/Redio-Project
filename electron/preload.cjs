// electron/preload.cjs
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('redioBackup', {
  selectDirectory: () => ipcRenderer.invoke('redio-backup-select-directory'),
});

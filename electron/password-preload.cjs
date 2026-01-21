'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('redioPassword', {
  submit: (password) => ipcRenderer.send('redio-license-password-submit', String(password || '')),
  cancel: () => ipcRenderer.send('redio-license-password-cancel'),
  onError: (cb) => {
    if (typeof cb !== 'function') return;
    ipcRenderer.on('redio-license-password-error', (_e, msg) => cb(msg));
  },
});

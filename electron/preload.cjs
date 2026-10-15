const { contextBridge, ipcRenderer } = require('electron');
const invoke = (name) => (...args) => ipcRenderer.invoke(name, ...args);
contextBridge.exposeInMainWorld('studio', {
  bootstrap: invoke('bootstrap'), settings: invoke('settings'), connect: invoke('connect'),
  createProject: invoke('create-project'), saveProject: invoke('save-project'),
  importAsset: invoke('import-asset'), generate: invoke('generate'), cancel: invoke('cancel'),
  saveMask: invoke('save-mask'),
  saveTexture: invoke('save-texture'),
  exportAsset: invoke('export-asset'), exportBytes: invoke('export-bytes'),
  openFolder: invoke('open-folder'), openComfy: invoke('open-comfy'),
  onJob(callback) { const handler = (_, job) => callback(job); ipcRenderer.on('job', handler); return () => ipcRenderer.removeListener('job', handler); },
});

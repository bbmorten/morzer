const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('tcpwatch', {
  start: (opts) => ipcRenderer.invoke('tcpwatch:start', opts),
  snapshot: (opts) => ipcRenderer.invoke('tcpwatch:snapshot', opts),
  stop: () => ipcRenderer.invoke('tcpwatch:stop'),
  isRunning: () => ipcRenderer.invoke('tcpwatch:isRunning'),
  onSnapshot: (cb) => {
    const handler = (_evt, snap) => cb(snap)
    ipcRenderer.on('tcpwatch:snapshot', handler)
    return () => ipcRenderer.removeListener('tcpwatch:snapshot', handler)
  },
  onError: (cb) => {
    const handler = (_evt, err) => cb(err)
    ipcRenderer.on('tcpwatch:error', handler)
    return () => ipcRenderer.removeListener('tcpwatch:error', handler)
  }
})

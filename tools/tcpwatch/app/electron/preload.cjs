const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('tcpwatch', {
  start: (opts) => ipcRenderer.invoke('tcpwatch:start', opts),
  snapshot: (opts) => ipcRenderer.invoke('tcpwatch:snapshot', opts),
  killProcess: (pid) => ipcRenderer.invoke('tcpwatch:killProcess', pid),
  selectDumpFolder: () => ipcRenderer.invoke('tcpwatch:selectDumpFolder'),
  listCaptureInterfaces: () => ipcRenderer.invoke('tcpwatch:listCaptureInterfaces'),
  startCapture: (opts) => ipcRenderer.invoke('tcpwatch:startCapture', opts),
  stopCapture: () => ipcRenderer.invoke('tcpwatch:stopCapture'),
  getCaptureStatus: () => ipcRenderer.invoke('tcpwatch:getCaptureStatus'),
  selectSplitFolder: () => ipcRenderer.invoke('tcpwatch:selectSplitFolder'),
  selectCaptureFile: () => ipcRenderer.invoke('tcpwatch:selectCaptureFile'),
  readSplitIndex: (splitDir) => ipcRenderer.invoke('tcpwatch:readSplitIndex', splitDir),
  openInWireshark: (filePath) => ipcRenderer.invoke('tcpwatch:openInWireshark', filePath),
  expertInfo: (filePath) => ipcRenderer.invoke('tcpwatch:expertInfo', filePath),
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
  },
  onCaptureStatus: (cb) => {
    const handler = (_evt, status) => cb(status)
    ipcRenderer.on('tcpwatch:captureStatus', handler)
    return () => ipcRenderer.removeListener('tcpwatch:captureStatus', handler)
  },
  onCaptureLog: (cb) => {
    const handler = (_evt, payload) => cb(payload)
    ipcRenderer.on('tcpwatch:captureLog', handler)
    return () => ipcRenderer.removeListener('tcpwatch:captureLog', handler)
  },
  onCaptureSplitProgress: (cb) => {
    const handler = (_evt, payload) => cb(payload)
    ipcRenderer.on('tcpwatch:captureSplitProgress', handler)
    return () => ipcRenderer.removeListener('tcpwatch:captureSplitProgress', handler)
  }
})

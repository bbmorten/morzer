import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('tcpwatch', {
  start: (opts: unknown) => ipcRenderer.invoke('tcpwatch:start', opts),
  stop: () => ipcRenderer.invoke('tcpwatch:stop'),
  isRunning: () => ipcRenderer.invoke('tcpwatch:isRunning'),
  onSnapshot: (cb: (snap: unknown) => void) => {
    const handler = (_: Electron.IpcRendererEvent, snap: unknown) => cb(snap)
    ipcRenderer.on('tcpwatch:snapshot', handler)
    return () => ipcRenderer.removeListener('tcpwatch:snapshot', handler)
  },
  onError: (cb: (err: { message: string }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, err: { message: string }) => cb(err)
    ipcRenderer.on('tcpwatch:error', handler)
    return () => ipcRenderer.removeListener('tcpwatch:error', handler)
  }
})

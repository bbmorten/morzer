/// <reference types="vite/client" />

declare global {
  interface Window {
    tcpwatch: {
      start: (opts: import('./types').StartOptions) => Promise<void>
      snapshot: (opts: import('./types').StartOptions) => Promise<import('./types').Snapshot>
      killProcess: (pid: number) => Promise<void>
      selectDumpFolder: () => Promise<string | null>
      listCaptureInterfaces: () => Promise<import('./types').CaptureInterface[]>
      startCapture: (opts: import('./types').CaptureStartOptions) => Promise<import('./types').CaptureStatus>
      stopCapture: () => Promise<void>
      getCaptureStatus: () => Promise<import('./types').CaptureStatus>
      selectSplitFolder: () => Promise<string | null>
      readSplitIndex: (splitDir: string) => Promise<import('./types').SplitIndex>
      openInWireshark: (filePath: string) => Promise<void>
      stop: () => Promise<void>
      isRunning: () => Promise<boolean>
      onSnapshot: (cb: (snap: import('./types').Snapshot) => void) => () => void
      onError: (cb: (err: { message: string }) => void) => () => void
      onCaptureStatus: (cb: (status: import('./types').CaptureStatus) => void) => () => void
      onCaptureLog: (cb: (payload: { message: string }) => void) => () => void
      onCaptureSplitProgress: (cb: (p: import('./types').CaptureSplitProgress) => void) => () => void
    }
  }
}

export {}

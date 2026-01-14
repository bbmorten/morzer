/// <reference types="vite/client" />

declare global {
  interface Window {
    tcpwatch: {
      start: (opts: import('./types').StartOptions) => Promise<void>
      snapshot: (opts: import('./types').StartOptions) => Promise<import('./types').Snapshot>
      stop: () => Promise<void>
      isRunning: () => Promise<boolean>
      onSnapshot: (cb: (snap: import('./types').Snapshot) => void) => () => void
      onError: (cb: (err: { message: string }) => void) => () => void
    }
  }
}

export {}

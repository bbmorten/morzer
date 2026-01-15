export type Row = {
  Proto: string
  Local: string
  Remote: string
  State: string
  PID: number
  Process: string
}

export type Snapshot = {
  updated: string
  title?: string
  rows: Row[]
}

export type StartOptions = {
  intervalMs: number
  stateCsv?: string
  pid?: number
  port?: number
  proc?: string
  includeListen: boolean
}

export type CaptureInterface = {
  id: string
  name: string
  description?: string
}

export type CaptureStatus = {
  running: boolean
  dumpDir?: string
  filePath?: string
  ifaceId?: string
  startedAt?: string
  durationSeconds?: number
  splitting?: boolean
  splitDir?: string
}

export type CaptureStartOptions = {
  dumpDir: string
  ifaceId: string
  durationSeconds: number
}

export type CaptureSplitProgress = {
  current: number
  total: number
  streamId: number
  file: string
}

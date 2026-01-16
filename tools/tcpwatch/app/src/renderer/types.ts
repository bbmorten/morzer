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
  snapLen?: number
}

export type CaptureStartOptions = {
  dumpDir: string
  ifaceId: string
  durationSeconds: number
  port?: number
  snapLen?: number
}

export type CaptureSplitProgress = {
  current: number
  total: number
  streamId: number
  file: string
}

export type SplitIndex = {
  version?: number
  captureFile: string
  splitDir: string
  createdAt: string
  streams: Array<{
    id: number
    file: string
    src?: { ip?: string; port?: number; hostnames?: string[] }
    dst?: { ip?: string; port?: number; hostnames?: string[] }
    description?: string
    sizeBytes?: number
    packetCount?: number
  }>
}

export type ExpertInfoItem = {
  frameNumber: number
  timeEpoch?: number
  severity: string
  group?: string
  protocol?: string
  message: string
}

export type ExpertInfoResult = {
  filePath: string
  generatedAt: string
  total: number
  countsBySeverity: Record<string, number>
  summaryText?: string
  items: ExpertInfoItem[]
}

export type PacketAnalysisResult = {
  filePath: string
  generatedAt: string
  model?: string
  text: string
}

export type DnsExtractIndex = {
  version: number
  sourceFile: string
  extractDir: string
  createdAt: string
  files: Array<{
    file: string
  }>
}

// Renderer API surface is declared in src/renderer/vite-env.d.ts.

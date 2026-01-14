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

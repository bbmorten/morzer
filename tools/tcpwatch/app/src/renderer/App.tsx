import { useEffect, useMemo, useState } from 'react'
import type { Snapshot, StartOptions } from './types'
import { ConnectionsTable } from './components/ConnectionsTable'

export function App() {
  const [running, setRunning] = useState(false)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)

  const [intervalMs, setIntervalMs] = useState(500)
  const [stateCsv, setStateCsv] = useState('')
  const [pid, setPid] = useState<string>('')
  const [port, setPort] = useState<string>('')
  const [proc, setProc] = useState<string>('')
  const [includeListen, setIncludeListen] = useState(true)

  useEffect(() => {
    if (!window.tcpwatch) {
      setLastError('Preload bridge not available (window.tcpwatch is undefined).')
      return
    }

    const offSnap = window.tcpwatch.onSnapshot((s) => {
      setSnapshot(s)
      setLastError(null)
    })
    const offErr = window.tcpwatch.onError((e) => setLastError(e.message))

    window.tcpwatch.isRunning().then(setRunning).catch(() => {})

    return () => {
      offSnap()
      offErr()
    }
  }, [])

  const startOptions: StartOptions = useMemo(
    () => ({
      intervalMs,
      stateCsv: stateCsv.trim() ? stateCsv.trim() : undefined,
      pid: pid.trim() ? Number(pid) : undefined,
      port: port.trim() ? Number(port) : undefined,
      proc: proc.trim() ? proc.trim() : undefined,
      includeListen
    }),
    [includeListen, intervalMs, pid, port, proc, stateCsv]
  )

  // While running, apply any filter edits by restarting the stream with updated args.
  // Debounced to avoid restarting on every keystroke.
  useEffect(() => {
    if (!running) return
    if (!window.tcpwatch) return

    const handle = window.setTimeout(() => {
      window.tcpwatch.start(startOptions).catch((e) => {
        const msg = e instanceof Error ? e.message : String(e)
        setLastError(msg)
      })
    }, 300)

    return () => window.clearTimeout(handle)
  }, [
    running,
    startOptions.intervalMs,
    startOptions.stateCsv,
    startOptions.pid,
    startOptions.port,
    startOptions.proc,
    startOptions.includeListen
  ])

  const onStart = async () => {
    setLastError(null)
    await window.tcpwatch.start(startOptions)
    setRunning(true)
  }

  const onStop = async () => {
    await window.tcpwatch.stop()
    setRunning(false)
  }

  const onSnapshot = async () => {
    setLastError(null)
    const snap = await window.tcpwatch.snapshot(startOptions)
    setSnapshot(snap)
  }

  const updatedLabel = snapshot?.updated ? new Date(snapshot.updated).toLocaleString() : '—'
  const title = snapshot?.title || 'tcpwatch'
  const rows = snapshot?.rows ?? []

  return (
    <div className="container">
      <div className="header">
        <div>
          <h1 className="h1">{title}</h1>
          <div className="sub">Updated: {updatedLabel} • Rows: {rows.length}</div>
          {lastError ? <div className="sub errorText">{lastError}</div> : null}
        </div>
        <span className="badge">macOS</span>
      </div>

      <div className="panel">
        <div className="controls">
          <div>
            <label htmlFor="intervalMs">Interval (ms)</label>
            <input
              id="intervalMs"
              title="Refresh interval (milliseconds)"
              type="number"
              min={100}
              step={50}
              value={intervalMs}
              onChange={(e) => setIntervalMs(Number(e.target.value))}
            />
          </div>
          <div>
            <label htmlFor="stateCsv">State CSV</label>
            <input
              id="stateCsv"
              title="Comma-separated TCP states"
              placeholder="ESTABLISHED,CLOSE_WAIT"
              value={stateCsv}
              onChange={(e) => setStateCsv(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="pid">PID</label>
            <input
              id="pid"
              title="Filter by owning process ID"
              type="number"
              placeholder="1234"
              value={pid}
              onChange={(e) => setPid(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="port">Port</label>
            <input
              id="port"
              title="Filter where local OR remote port matches"
              type="number"
              placeholder="443"
              value={port}
              onChange={(e) => setPort(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="proc">Process</label>
            <input
              id="proc"
              title="Filter by process name substring"
              placeholder="chrome"
              value={proc}
              onChange={(e) => setProc(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="includeListen">Include LISTEN</label>
            <input
              id="includeListen"
              title="Include LISTEN sockets"
              type="checkbox"
              checked={includeListen}
              onChange={(e) => setIncludeListen(e.target.checked)}
            />
          </div>
          <div>
            <label>Run</label>
            {!running ? (
              <button className="primary" onClick={onStart}>Start</button>
            ) : (
              <button className="danger" onClick={onStop}>Stop</button>
            )}
          </div>
          <div>
            <label>Snapshot</label>
            <button onClick={onSnapshot}>Run once</button>
          </div>
          <div>
            <label>Status</label>
            <div className="badge">{running ? 'running' : 'stopped'}</div>
          </div>
        </div>

        <ConnectionsTable rows={rows} />

        <div className="footerRow">
          <div>Tip: run as admin if PID names are missing.</div>
          <div>Data source: gopsutil/sysctl</div>
        </div>
      </div>
    </div>
  )
}

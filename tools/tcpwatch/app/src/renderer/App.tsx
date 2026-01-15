import { useEffect, useMemo, useState } from 'react'
import type { CaptureInterface, CaptureSplitProgress, CaptureStatus, Row, Snapshot, StartOptions } from './types'
import { ConnectionsTable } from './components/ConnectionsTable'
import { CapturesPage } from './components/CapturesPage'

export function App() {
  const [page, setPage] = useState<'connections' | 'captures'>('connections')
  const [running, setRunning] = useState(false)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)

  const [intervalMs, setIntervalMs] = useState(500)
  const [stateCsv, setStateCsv] = useState('')
  const [pid, setPid] = useState<string>('')
  const [port, setPort] = useState<string>('')
  const [proc, setProc] = useState<string>('')
  const [includeListen, setIncludeListen] = useState(true)

  const [dumpDir, setDumpDir] = useState<string>('')
  const [captureIfaces, setCaptureIfaces] = useState<CaptureInterface[]>([])
  const [captureIfaceId, setCaptureIfaceId] = useState<string>('')
  const [captureDurationSec, setCaptureDurationSec] = useState<number>(300)
  const [captureStatus, setCaptureStatus] = useState<CaptureStatus | null>(null)
  const [splitProgress, setSplitProgress] = useState<CaptureSplitProgress | null>(null)

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
    const offCapStatus = window.tcpwatch.onCaptureStatus((s) => setCaptureStatus(s))
    const offSplit = window.tcpwatch.onCaptureSplitProgress((p) => setSplitProgress(p))

    window.tcpwatch.isRunning().then(setRunning).catch(() => {})
    window.tcpwatch.getCaptureStatus().then(setCaptureStatus).catch(() => {})

    window.tcpwatch
      .listCaptureInterfaces()
      .then((ifs) => {
        setCaptureIfaces(ifs)
        if (!captureIfaceId && ifs.length > 0) setCaptureIfaceId(ifs[0].id)
      })
      .catch(() => {})

    return () => {
      offSnap()
      offErr()
      offCapStatus()
      offSplit()
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

  const onPickDumpFolder = async () => {
    if (!window.tcpwatch) return
    const picked = await window.tcpwatch.selectDumpFolder()
    if (picked) setDumpDir(picked)
  }

  const onRefreshIfaces = async () => {
    if (!window.tcpwatch) return
    setLastError(null)
    try {
      const ifs = await window.tcpwatch.listCaptureInterfaces()
      setCaptureIfaces(ifs)
      if (!ifs.some((x) => x.id === captureIfaceId)) {
        setCaptureIfaceId(ifs[0]?.id ?? '')
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setLastError(msg)
    }
  }

  const onStartCapture = async () => {
    if (!window.tcpwatch) return
    setLastError(null)
    setSplitProgress(null)
    const duration = Math.max(1, Math.min(300, Math.trunc(Number(captureDurationSec))))
    setCaptureDurationSec(duration)
    const status = await window.tcpwatch.startCapture({
      dumpDir: dumpDir.trim(),
      ifaceId: captureIfaceId,
      durationSeconds: duration,
      port: typeof startOptions.port === 'number' && Number.isFinite(startOptions.port) ? startOptions.port : undefined
    })
    setCaptureStatus(status)
  }

  const onStopCapture = async () => {
    if (!window.tcpwatch) return
    setLastError(null)
    await window.tcpwatch.stopCapture()
  }

  const onRowDoubleClick = async (row: Row) => {
    if (!window.tcpwatch) return

    const pid = row.PID
    if (!Number.isFinite(pid) || pid <= 1) return

    const label = row.Process?.trim() ? `${row.Process} (PID ${pid})` : `PID ${pid}`
    const ok = window.confirm(`Terminate ${label}?\n\nThis will send SIGTERM to the process.`)
    if (!ok) return

    try {
      await window.tcpwatch.killProcess(pid)

      // If we're not streaming, refresh once so the table updates.
      if (!running) {
        try {
          const snap = await window.tcpwatch.snapshot(startOptions)
          setSnapshot(snap)
        } catch {
          // ignore refresh errors
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setLastError(msg)
    }
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
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            className={page === 'connections' ? 'primary' : undefined}
            onClick={() => setPage('connections')}
            title="Live connections"
          >
            Connections
          </button>
          <button
            className={page === 'captures' ? 'primary' : undefined}
            onClick={() => setPage('captures')}
            title="Split captures"
          >
            Captures
          </button>
          <span className="badge">macOS</span>
        </div>
      </div>

      {page === 'captures' ? (
        <CapturesPage captureStatus={captureStatus} />
      ) : (
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

        <div className="controls" style={{ marginTop: 12 }}>
          <div style={{ gridColumn: '1 / -1' }}>
            <div className="sub" style={{ marginBottom: 6 }}>Capture (tshark)</div>
          </div>
          <div style={{ gridColumn: '1 / span 3' }}>
            <label>Dump folder</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button onClick={onPickDumpFolder}>Choose…</button>
              <div className="sub" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={dumpDir || ''}>
                {dumpDir ? dumpDir : 'No folder selected'}
              </div>
            </div>
          </div>
          <div>
            <label>Interface</label>
            <select value={captureIfaceId} onChange={(e) => setCaptureIfaceId(e.target.value)}>
              {captureIfaces.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.id}. {i.name}{i.description ? ` (${i.description})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Max duration (sec)</label>
            <input
              type="number"
              min={1}
              max={300}
              step={1}
              value={captureDurationSec}
              onChange={(e) => setCaptureDurationSec(Number(e.target.value))}
            />
          </div>
          <div>
            <label>Capture</label>
            {!captureStatus?.running ? (
              <button
                className="primary"
                onClick={onStartCapture}
                disabled={!dumpDir.trim() || !captureIfaceId || !running}
                title={!running ? 'Start tcpwatch streaming first' : undefined}
              >
                Start capture
              </button>
            ) : (
              <button className="danger" onClick={onStopCapture}>Stop capture</button>
            )}
          </div>
          <div>
            <label>Capture status</label>
            <div className="badge">{captureStatus?.running ? 'capturing' : (captureStatus?.splitting ? 'splitting' : 'idle')}</div>
          </div>
          <div>
            <label>Interfaces</label>
            <button onClick={onRefreshIfaces}>Refresh</button>
          </div>

          {captureStatus?.filePath ? (
            <div style={{ gridColumn: '1 / -1' }}>
              <div className="sub">Capture file: {captureStatus.filePath}</div>
            </div>
          ) : null}
          {captureStatus?.splitDir ? (
            <div style={{ gridColumn: '1 / -1' }}>
              <div className="sub">Split output: {captureStatus.splitDir}</div>
            </div>
          ) : null}
          {splitProgress ? (
            <div style={{ gridColumn: '1 / -1' }}>
              <div className="sub">
                Splitting… {splitProgress.current}/{splitProgress.total} (tcp.stream={splitProgress.streamId}) → {splitProgress.file}
              </div>
            </div>
          ) : null}
          <div style={{ gridColumn: '1 / -1' }}>
            <div className="sub">Requires Wireshark/tshark installed. Capture may require elevated permissions.</div>
          </div>
        </div>

        <ConnectionsTable rows={rows} onRowDoubleClick={onRowDoubleClick} />

        <div className="footerRow">
          <div>Tip: run as admin if PID names are missing.</div>
          <div>Data source: gopsutil/sysctl</div>
        </div>
      </div>
      )}
    </div>
  )
}

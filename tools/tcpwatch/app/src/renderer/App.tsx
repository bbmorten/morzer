import { useEffect, useMemo, useState } from 'react'
import type { CaptureInterface, CaptureSplitProgress, CaptureStatus, Row, Snapshot, StartOptions } from './types'
import { ConnectionsTable } from './components/ConnectionsTable'
import { CapturesPage } from './components/CapturesPage'
import { DnsPage } from './components/DnsPage'
import { PacketAnalysisPage } from './components/PacketAnalysisPage'
import type { PacketAnalysisResult } from './types'

export function App() {
  const [page, setPage] = useState<'connections' | 'captures' | 'dns' | 'analysis'>('connections')
  const [running, setRunning] = useState(false)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)

  const [analysisFilePath, setAnalysisFilePath] = useState<string>('')
  const [analysisLoading, setAnalysisLoading] = useState<boolean>(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [analysisResult, setAnalysisResult] = useState<PacketAnalysisResult | null>(null)
  const [analysisTitle, setAnalysisTitle] = useState<string>('Packet Analysis (Claude + mcpcap)')
  const [analysisKind, setAnalysisKind] = useState<'packet' | 'dns'>('packet')
  const [analysisBackTo, setAnalysisBackTo] = useState<'captures' | 'dns'>('captures')

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
  const [captureSnapLen, setCaptureSnapLen] = useState<number>(200)
  const [captureFilter, setCaptureFilter] = useState<string>('tcp')
  const [captureFilterError, setCaptureFilterError] = useState<string | null>(null)
  const [captureStatus, setCaptureStatus] = useState<CaptureStatus | null>(null)
  const [splitProgress, setSplitProgress] = useState<CaptureSplitProgress | null>(null)

  const [processInfoPid, setProcessInfoPid] = useState<number | null>(null)
  const [processInfoResult, setProcessInfoResult] = useState<string | null>(null)
  const [processInfoError, setProcessInfoError] = useState<string | null>(null)
  const [processInfoLoading, setProcessInfoLoading] = useState(false)

  const effectiveSnapLen = useMemo(() => {
    const n = Math.trunc(Number(captureSnapLen))
    if (!Number.isFinite(n)) return 200
    return Math.max(0, Math.min(262144, n))
  }, [captureSnapLen])

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

  const onValidateCaptureFilter = async () => {
    if (!window.tcpwatch) return
    const f = captureFilter.trim()
    if (!f) {
      setCaptureFilterError('Capture filter cannot be empty')
      return
    }
    try {
      const result = await window.tcpwatch.validateCaptureFilter(f, captureIfaceId)
      setCaptureFilterError(result.valid ? null : (result.error ?? 'Invalid capture filter'))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setCaptureFilterError(msg)
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
      port: typeof startOptions.port === 'number' && Number.isFinite(startOptions.port) ? startOptions.port : undefined,
      snapLen: effectiveSnapLen,
      captureFilter: captureFilter.trim() || undefined
    })
    setCaptureStatus(status)
  }

  const onStopCapture = async () => {
    if (!window.tcpwatch) return
    setLastError(null)
    await window.tcpwatch.stopCapture()
  }

  const onKillProcess = async (row: Row) => {
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

  const onProcessInfo = async (pid: number) => {
    if (!window.tcpwatch) return
    setProcessInfoPid(pid)
    setProcessInfoResult(null)
    setProcessInfoError(null)
    setProcessInfoLoading(true)
    try {
      const res = await window.tcpwatch.processInfo(pid)
      if ('error' in res) {
        setProcessInfoError(res.error)
      } else {
        setProcessInfoResult(res.output)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setProcessInfoError(msg)
    } finally {
      setProcessInfoLoading(false)
    }
  }

  const closeProcessInfo = () => {
    setProcessInfoPid(null)
    setProcessInfoResult(null)
    setProcessInfoError(null)
  }

  const updatedLabel = snapshot?.updated ? new Date(snapshot.updated).toLocaleString() : '—'
  const title = snapshot?.title || 'tcpwatch'
  const rows = snapshot?.rows ?? []

  const runAnalysis = async (filePath: string, kind: 'packet' | 'dns') => {
    if (!window.tcpwatch) return
    const p = filePath.trim()
    if (!p) return
    setAnalysisFilePath(p)
    setAnalysisKind(kind)
    setAnalysisTitle(kind === 'dns' ? 'DNS Analysis (Claude + mcpcap)' : 'Packet Analysis (Claude + mcpcap)')
    setAnalysisLoading(true)
    setAnalysisError(null)
    setAnalysisResult(null)
    try {
      const res = kind === 'dns' ? await window.tcpwatch.analyzeDnsCapture(p) : await window.tcpwatch.analyzeCapture(p)
      setAnalysisResult(res)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setAnalysisError(msg)
    } finally {
      setAnalysisLoading(false)
    }
  }

  return (
    <div className="container">
      <div className="header">
        <div>
          <h1 className="h1">{title}</h1>
          <div className="sub">Updated: {updatedLabel} • Rows: {rows.length}</div>
          {lastError ? <div className="sub errorText">{lastError}</div> : null}
        </div>
        <div className="headerActions">
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
          <button className={page === 'dns' ? 'primary' : undefined} onClick={() => setPage('dns')} title="DNS extraction and analysis">
            DNS
          </button>
          <span className="badge">macOS</span>
        </div>
      </div>

      {page === 'analysis' ? (
        <PacketAnalysisPage
          title={analysisTitle}
          result={analysisResult ?? (analysisFilePath ? { filePath: analysisFilePath, generatedAt: '', text: '' } : null)}
          loading={analysisLoading}
          error={analysisError}
          onBack={() => setPage(analysisBackTo)}
          onRerun={() => runAnalysis(analysisFilePath, analysisKind)}
        />
      ) : page === 'dns' ? (
        <DnsPage
          onAnalyze={(filePath) => {
            setAnalysisBackTo('dns')
            setPage('analysis')
            runAnalysis(filePath, 'dns')
          }}
        />
      ) : page === 'captures' ? (
        <CapturesPage
          captureStatus={captureStatus}
          onAnalyze={(filePath) => {
            setAnalysisBackTo('captures')
            setPage('analysis')
            runAnalysis(filePath, 'packet')
          }}
        />
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

        <div className="controls mt12">
          <div className="capGridAll">
            <div className="sub mb6">Capture (tshark)</div>
          </div>
          <div className="capGridSpan3">
            <label>Dump folder</label>
            <div className="capRowFlex">
              <button onClick={onPickDumpFolder}>Choose…</button>
              <div className="sub capEllipsis" title={dumpDir || ''}>
                {dumpDir ? dumpDir : 'No folder selected'}
              </div>
            </div>
          </div>
          <div>
            <label htmlFor="captureIface">Interface</label>
            <select
              id="captureIface"
              value={captureIfaceId}
              onChange={(e) => setCaptureIfaceId(e.target.value)}
              title="Capture interface"
            >
              {captureIfaces.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.id}. {i.name}{i.description ? ` (${i.description})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="captureDurationSec">Max duration (sec)</label>
            <input
              id="captureDurationSec"
              type="number"
              min={1}
              max={300}
              step={1}
              value={captureDurationSec}
              onChange={(e) => setCaptureDurationSec(Number(e.target.value))}
              title="Max capture duration in seconds"
            />
          </div>
          <div>
            <label htmlFor="captureSnapLen">Snaplen (bytes)</label>
            <input
              id="captureSnapLen"
              type="number"
              min={0}
              max={262144}
              step={1}
              value={captureSnapLen}
              onChange={(e) => setCaptureSnapLen(Number(e.target.value))}
              title="Max bytes per packet written to each split tcp-stream-*.pcapng (0 disables truncation). Default 200."
            />
          </div>
          <div className={`capGridSpan3${captureFilterError ? ' capFilterError' : ''}`}>
            <label htmlFor="captureFilter">Capture filter (BPF)</label>
            <input
              id="captureFilter"
              type="text"
              value={captureFilter}
              onChange={(e) => { setCaptureFilter(e.target.value); setCaptureFilterError(null) }}
              onBlur={onValidateCaptureFilter}
              placeholder="e.g. tcp, tcp port 443, host 10.0.0.1"
              title="BPF capture filter passed to tshark -f. Validated on blur."
            />
            {captureFilterError && <div className="sub capFilterHint">{captureFilterError}</div>}
          </div>
          <div>
            <label>Capture</label>
            {!captureStatus?.running ? (
              <button
                className="primary"
                onClick={onStartCapture}
                disabled={!dumpDir.trim() || !captureIfaceId || !running || !!captureFilterError}
                title={!running ? 'Start tcpwatch streaming first' : captureFilterError ? 'Fix capture filter first' : undefined}
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
            <div className="capGridAll">
              <div className="sub">Capture file: <a href="#" className="capFileLink" onClick={(e) => { e.preventDefault(); window.tcpwatch?.openInWireshark(captureStatus.filePath!) }}>{captureStatus.filePath}</a></div>
            </div>
          ) : null}
          {captureStatus?.splitDir ? (
            <div className="capGridAll">
              <div className="sub">Split output: {captureStatus.splitDir}</div>
            </div>
          ) : null}
          {splitProgress ? (
            <div className="capGridAll">
              <div className="sub">
                Splitting… {splitProgress.current}/{splitProgress.total} (tcp.stream={splitProgress.streamId}) → {splitProgress.file}
              </div>
            </div>
          ) : null}
          <div className="capGridAll">
            <div className="sub">Requires Wireshark/tshark installed. Capture may require elevated permissions.</div>
          </div>
        </div>

        <ConnectionsTable rows={rows} onKillProcess={onKillProcess} onProcessInfo={onProcessInfo} />

        <div className="footerRow">
          <div>Tip: run as admin if PID names are missing.</div>
          <div>Data source: gopsutil/sysctl</div>
        </div>
      </div>
      )}

      {processInfoPid !== null && (
        <div className="capModalBackdrop" onClick={closeProcessInfo}>
          <div className="capModal" onClick={(e) => e.stopPropagation()}>
            <div className="capModalHeader">
              <h2 className="capModalTitle">Process Info - PID {processInfoPid} (witr)</h2>
              <button type="button" onClick={closeProcessInfo}>Close</button>
            </div>
            <div className="capAnalysisWrap">
              {processInfoLoading ? (
                <div className="capAnalysisPre">Loading...</div>
              ) : processInfoError ? (
                <div className="capAnalysisPre errorText">{processInfoError}</div>
              ) : processInfoResult ? (
                <pre className="capAnalysisPre">{processInfoResult}</pre>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

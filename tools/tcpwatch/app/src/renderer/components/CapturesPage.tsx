import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { CaptureStatus, ExpertInfoResult, SplitIndex } from '../types'

export function CapturesPage({
  captureStatus,
  onAnalyze,
}: {
  captureStatus: CaptureStatus | null
  onAnalyze?: (filePath: string) => void
}) {
  const [splitDir, setSplitDir] = useState<string>('')
  const [index, setIndex] = useState<SplitIndex | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [descFilter, setDescFilter] = useState<string>('')
  const [dragActive, setDragActive] = useState<boolean>(false)
  const [loading, setLoading] = useState<boolean>(false)
  const [importSnapLenText, setImportSnapLenText] = useState<string>('200')

  const [ctxMenu, setCtxMenu] = useState<{
    x: number
    y: number
    stream: SplitIndex['streams'][number]
  } | null>(null)

  const ctxMenuRef = useRef<HTMLDivElement | null>(null)

  const [expertOpen, setExpertOpen] = useState<boolean>(false)
  const [expertLoading, setExpertLoading] = useState<boolean>(false)
  const [expertError, setExpertError] = useState<string | null>(null)
  const [expertResult, setExpertResult] = useState<ExpertInfoResult | null>(null)
  const [expertSeverity, setExpertSeverity] = useState<string>('')
  const [expertQuery, setExpertQuery] = useState<string>('')

  useEffect(() => {
    const fromStatus = captureStatus?.splitDir
    // Avoid switching the selected path while splitting is still running.
    // Otherwise we can attempt to load a split folder before index.json is written.
    if (fromStatus && !captureStatus?.splitting) setSplitDir(fromStatus)
  }, [captureStatus?.splitDir, captureStatus?.splitting])

  useEffect(() => {
    // Reset search when switching folders so the table doesn't appear "empty".
    setDescFilter('')
  }, [splitDir])

  function formatEndpoint(ep: SplitIndex['streams'][number]['src'] | undefined): string {
    if (!ep?.ip) return ''
    const host = (ep.hostnames ?? []).find((h) => h && h.trim())?.trim()
    const addr = host && host !== ep.ip ? `${host} (${ep.ip})` : ep.ip
    const port = typeof ep.port === 'number' ? `:${ep.port}` : ''
    return `${addr}${port}`
  }

  function getDescription(s: SplitIndex['streams'][number]): string {
    if (s.description && s.description.trim()) return s.description.trim()
    const left = formatEndpoint(s.src)
    const right = formatEndpoint(s.dst)
    if (left && right) return `${left} → ${right}`
    return ''
  }

  function formatBytes(n: number | undefined): string {
    if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
    const abs = Math.abs(n)
    if (abs < 1024) return `${n} B`
    const kb = n / 1024
    if (Math.abs(kb) < 1024) return `${kb.toFixed(1)} KB`
    const mb = kb / 1024
    if (Math.abs(mb) < 1024) return `${mb.toFixed(1)} MB`
    const gb = mb / 1024
    return `${gb.toFixed(2)} GB`
  }

  function formatPacketCount(n: number | undefined): string {
    if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
    return n.toLocaleString()
  }

  const canLoad = Boolean(window.tcpwatch && splitDir.trim())

  function isPcapPath(p: string): boolean {
    const lower = p.toLowerCase()
    return lower.endsWith('.pcap') || lower.endsWith('.pcapng')
  }

  const onPickSplitFolder = async () => {
    if (!window.tcpwatch) return
    setError(null)
    const picked = await window.tcpwatch.selectSplitFolder()
    if (picked) setSplitDir(picked)
  }

  const onPickCaptureFile = async () => {
    if (!window.tcpwatch) return
    setError(null)
    const picked = await window.tcpwatch.selectCaptureFile()
    if (picked) setSplitDir(picked)
  }

  const onLoad = async () => {
    if (!window.tcpwatch) return
    setError(null)
    setLoading(true)
    try {
      const pickedPath = splitDir.trim()
      const rawImportSnapLen = Number(importSnapLenText)
      const importSnapLen = Number.isFinite(rawImportSnapLen) ? rawImportSnapLen : undefined

      const idx = await window.tcpwatch.readSplitIndex(
        pickedPath,
        isPcapPath(pickedPath)
          ? {
              snapLen: importSnapLen,
            }
          : undefined
      )
      setIndex(idx)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      setIndex(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!canLoad) return
    onLoad().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canLoad, splitDir])

  const rows = useMemo(() => {
    const all = index?.streams ?? []
    const q = descFilter.trim().toLowerCase()
    if (!q) return all
    return all.filter((s) => getDescription(s).toLowerCase().includes(q))
  }, [descFilter, index?.streams])

  const totalCount = index?.streams?.length ?? 0
  const shownCount = rows.length

  const onOpen = async (fileName: string) => {
    if (!window.tcpwatch || !index) return
    setError(null)
    try {
      await window.tcpwatch.openInWireshark(`${index.splitDir}/${fileName}`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
    }
  }

  const onRowContextMenu = (e: React.MouseEvent, stream: SplitIndex['streams'][number]) => {
    e.preventDefault()
    e.stopPropagation()
    setCtxMenu({ x: e.clientX, y: e.clientY, stream })
  }

  const closeCtxMenu = () => setCtxMenu(null)

  const closeExpert = () => {
    setExpertOpen(false)
    setExpertLoading(false)
    setExpertError(null)
    // Keep last result so reopening is instant; cleared when starting a new run.
  }

  const runExpertInfo = async (stream: SplitIndex['streams'][number]) => {
    if (!window.tcpwatch || !index) return
    closeCtxMenu()
    setExpertOpen(true)
    setExpertLoading(true)
    setExpertError(null)
    setExpertResult(null)
    setExpertSeverity('')
    setExpertQuery('')

    try {
      const filePath = `${index.splitDir}/${stream.file}`
      const res = await window.tcpwatch.expertInfo(filePath)
      setExpertResult(res)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setExpertError(msg)
    } finally {
      setExpertLoading(false)
    }
  }

  const runAnalyze = (stream: SplitIndex['streams'][number]) => {
    if (!index) return
    closeCtxMenu()
    const filePath = `${index.splitDir}/${stream.file}`
    onAnalyze?.(filePath)
  }

  useEffect(() => {
    if (!ctxMenuRef.current || !ctxMenu) return
    ctxMenuRef.current.style.left = `${ctxMenu.x}px`
    ctxMenuRef.current.style.top = `${ctxMenu.y}px`
  }, [ctxMenu])

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        closeCtxMenu()
        if (expertOpen) closeExpert()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expertOpen])

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(true)
  }

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
  }

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    setError(null)

    const f = e.dataTransfer?.files?.[0]
    const p = f ? String((f as unknown as { path?: unknown }).path ?? '') : ''
    const pickedPath = p.trim()
    if (!pickedPath) {
      setError('Drop a .pcap/.pcapng file from Finder.')
      return
    }
    if (!isPcapPath(pickedPath)) {
      setError('Unsupported file type. Drop a .pcap or .pcapng file.')
      return
    }

    // This will auto-split and generate index.json via readSplitIndex.
    setSplitDir(pickedPath)
  }

  return (
    <div className={dragActive ? 'panel capDropActive' : 'panel'} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <div className="controls">
        <div className="capGridAll">
          <div className="sub mb6">Split Captures</div>
          {error ? <div className="sub errorText">{error}</div> : null}
        </div>

        <div className="capGridSpan3">
          <label>Split folder / capture file</label>
          <div className="capRowFlex">
            <button onClick={onPickSplitFolder} title="Choose a tcpwatch-split-* folder">Split folder…</button>
            <button onClick={onPickCaptureFile} title="Import a .pcap/.pcapng file (auto-split + index.json)">Capture file…</button>
            <div className="sub capEllipsis" title={splitDir || ''}>
              {splitDir ? splitDir : 'No folder selected'}
            </div>
          </div>
          <div className="sub capDropHint">Tip: you can also drag & drop a .pcap/.pcapng file here.</div>
        </div>

        <div>
          <label>Snaplen (bytes)</label>
          <input
            type="number"
            min={0}
            step={1}
            value={importSnapLenText}
            onChange={(e) => setImportSnapLenText(e.target.value)}
            title="Applies when importing/splitting capture files (.pcap/.pcapng). 0 disables truncation."
          />
          <div className="sub">Default 200; set 0 to disable truncation.</div>
        </div>

        <div>
          <label>Index</label>
          <button onClick={onLoad} disabled={!canLoad || loading}>{loading ? 'Loading…' : 'Load'}</button>
        </div>

        <div className="capGridSpan3">
          <label htmlFor="descFilter">Search (Description)</label>
          <div className="capRowFlex">
            <input
              id="descFilter"
              type="text"
              placeholder="Type IP / hostname (FQDN)…"
              value={descFilter}
              onChange={(e) => setDescFilter(e.target.value)}
            />
            <button onClick={() => setDescFilter('')} disabled={!descFilter.trim()} title="Clear search">
              Clear
            </button>
          </div>
        </div>

        <div className="capGridFrom4">
          <div className="sub mb6">
            Results
          </div>
          <div className="sub">
            {shownCount} / {totalCount}
          </div>
        </div>

        <div className="capGridAll">
          <div className="sub">
            Tip: double-click a stream to open in Wireshark. Right-click for analysis.
          </div>
        </div>
      </div>

      {index ? (
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>TCP STREAM</th>
                <th>DESCRIPTION</th>
                <th>FILE</th>
                <th className="capNumCol">PACKETS</th>
                <th className="capNumCol">SIZE</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr
                  key={s.id}
                  onDoubleClick={() => onOpen(s.file)}
                  onContextMenu={(e) => onRowContextMenu(e, s)}
                  className="capClickableRow"
                  title="Double-click to open in Wireshark. Right-click for analysis."
                >
                  <td>{s.id}</td>
                  <td className="capDescCell" title={getDescription(s) || ''}>
                    {getDescription(s)}
                  </td>
                  <td>{s.file}</td>
                  <td className="capNumCol" title={typeof s.packetCount === 'number' ? String(s.packetCount) : ''}>
                    {formatPacketCount(s.packetCount)}
                  </td>
                  <td className="capNumCol" title={typeof s.sizeBytes === 'number' ? String(s.sizeBytes) : ''}>
                    {formatBytes(s.sizeBytes)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="sub capPad12">
          Select a split folder to view files.
        </div>
      )}

      {index ? (
        <div className="footerRow">
          <div>Capture: <a href="#" className="capFileLink" onClick={(e) => { e.preventDefault(); window.tcpwatch?.openInWireshark(index.captureFile) }}>{index.captureFile}</a></div>
          <div>Created: {new Date(index.createdAt).toLocaleString()}</div>
        </div>
      ) : null}

      {ctxMenu ? (
        <div className="capCtxBackdrop" onMouseDown={closeCtxMenu} onContextMenu={(e) => e.preventDefault()}>
          <div
            className="capCtxMenu"
            ref={ctxMenuRef}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button className="capCtxItem" onClick={() => runExpertInfo(ctxMenu.stream)}>
              Expert Information
            </button>
            <button className="capCtxItem" onClick={() => runAnalyze(ctxMenu.stream)}>
              Analyze
            </button>
          </div>
        </div>
      ) : null}

      {expertOpen ? (
        <div className="capModalBackdrop" onMouseDown={closeExpert}>
          <div className="capModal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="capModalHeader">
              <div className="capMinWidth0">
                <div className="capModalTitle">Expert Information</div>
                <div className="sub capEllipsis" title={expertResult?.filePath || ''}>
                  {expertResult?.filePath || (index ? `${index.splitDir}/…` : '')}
                </div>
              </div>
              <button onClick={closeExpert}>Close</button>
            </div>

            {expertLoading ? <div className="sub capPad12">Analyzing packets…</div> : null}
            {expertError ? <div className="sub errorText capPad12">{expertError}</div> : null}

            {expertResult && !expertLoading ? (
              <>
                {expertResult.summaryText ? (
                  <details className="capExpertSummary">
                    <summary>Summary (tshark -z expert)</summary>
                    <pre className="capExpertSummaryPre">{expertResult.summaryText}</pre>
                  </details>
                ) : null}

                <div className="capModalControls">
                  <div>
                    <label htmlFor="expertSeverity">Severity</label>
                    <select
                      id="expertSeverity"
                      value={expertSeverity}
                      onChange={(e) => setExpertSeverity(e.target.value)}
                      title="Filter by expert severity"
                    >
                      <option value="">All</option>
                      {Object.keys(expertResult.countsBySeverity)
                        .sort((a, b) => a.localeCompare(b))
                        .map((k) => (
                          <option key={k} value={k}>
                            {k} ({expertResult.countsBySeverity[k]})
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="capGridSpan3">
                    <label htmlFor="expertQuery">Search (message)</label>
                    <input
                      id="expertQuery"
                      type="text"
                      placeholder="e.g. retransmission, checksum, out-of-order"
                      value={expertQuery}
                      onChange={(e) => setExpertQuery(e.target.value)}
                    />
                  </div>
                  <div>
                    <label>Total</label>
                    <div className="sub">{expertResult.total}</div>
                  </div>
                </div>

                <div className="tableWrap">
                  <table>
                    <thead>
                      <tr>
                        <th>PKT</th>
                        <th>SEVERITY</th>
                        <th>GROUP</th>
                        <th>PROTO</th>
                        <th>MESSAGE</th>
                      </tr>
                    </thead>
                    <tbody>
                      {expertResult.items
                        .filter((it) => (!expertSeverity ? true : it.severity === expertSeverity))
                        .filter((it) => {
                          const q = expertQuery.trim().toLowerCase()
                          if (!q) return true
                          const msg = (it.message ?? '').toLowerCase()
                          const grp = (it.group ?? '').toLowerCase()
                          const proto = (it.protocol ?? '').toLowerCase()
                          return msg.includes(q) || grp.includes(q) || proto.includes(q)
                        })
                        .map((it, i) => (
                          <tr key={`${it.frameNumber}-${i}`}>
                            <td>{it.frameNumber}</td>
                            <td>{it.severity}</td>
                            <td>{it.group ?? ''}</td>
                            <td>{it.protocol ?? ''}</td>
                            <td className="capExpertMsg" title={it.message}>
                              {it.message}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

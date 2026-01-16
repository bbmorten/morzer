import React, { useEffect, useRef, useState } from 'react'
import type { DnsExtractIndex } from '../types'

export function DnsPage({
  onAnalyze,
}: {
  onAnalyze?: (filePath: string) => void
}) {
  const [sourceFile, setSourceFile] = useState<string>('')
  const [result, setResult] = useState<DnsExtractIndex | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState<boolean>(false)
  const [dragActive, setDragActive] = useState<boolean>(false)

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; file: string } | null>(null)
  const ctxMenuRef = useRef<HTMLDivElement | null>(null)

  function isPcapPath(p: string): boolean {
    const lower = p.toLowerCase()
    return lower.endsWith('.pcap') || lower.endsWith('.pcapng')
  }

  const onPickCaptureFile = async () => {
    if (!window.tcpwatch) return
    setError(null)
    const picked = await window.tcpwatch.selectCaptureFile()
    if (picked) setSourceFile(picked)
  }

  const onExtract = async () => {
    if (!window.tcpwatch) return
    const p = sourceFile.trim()
    if (!p) return
    setError(null)
    setLoading(true)
    setResult(null)
    try {
      const res = await window.tcpwatch.extractDns(p)
      setResult(res)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  // Auto-run extraction when a new capture file is selected/dropped.
  useEffect(() => {
    const p = sourceFile.trim()
    if (!p) return
    if (loading) return
    if (result?.sourceFile === p) return

    const handle = window.setTimeout(() => {
      onExtract().catch(() => {})
    }, 150)
    return () => window.clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceFile])

  const onOpen = async (fileName: string) => {
    if (!window.tcpwatch || !result) return
    setError(null)
    try {
      await window.tcpwatch.openInWireshark(`${result.extractDir}/${fileName}`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
    }
  }

  const onRowContextMenu = (e: React.MouseEvent, fileName: string) => {
    e.preventDefault()
    e.stopPropagation()
    setCtxMenu({ x: e.clientX, y: e.clientY, file: fileName })
  }

  const closeCtxMenu = () => setCtxMenu(null)

  const runAnalyze = (fileName: string) => {
    if (!result) return
    closeCtxMenu()
    const filePath = `${result.extractDir}/${fileName}`
    onAnalyze?.(filePath)
  }

  useEffect(() => {
    if (!ctxMenuRef.current || !ctxMenu) return
    ctxMenuRef.current.style.left = `${ctxMenu.x}px`
    ctxMenuRef.current.style.top = `${ctxMenu.y}px`
  }, [ctxMenu])

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') closeCtxMenu()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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

    setSourceFile(pickedPath)
  }

  return (
    <div className={dragActive ? 'panel capDropActive' : 'panel'} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <div className="controls">
        <div className="capGridAll">
          <div className="sub mb6">DNS (includes mDNS + LLMNR)</div>
          {error ? <div className="sub errorText">{error}</div> : null}
        </div>

        <div className="capGridSpan3">
          <label>Capture file</label>
          <div className="capRowFlex">
            <button onClick={onPickCaptureFile} title="Choose a .pcap/.pcapng file">Capture file…</button>
            <div className="sub capEllipsis" title={sourceFile || ''}>
              {sourceFile ? sourceFile : 'No file selected'}
            </div>
          </div>
          <div className="sub capDropHint">Tip: you can also drag & drop a .pcap/.pcapng file here.</div>
        </div>

        <div>
          <label>Actions</label>
          <div className="capRowFlex">
            <button className="primary" onClick={onExtract} disabled={!sourceFile.trim() || loading}>
              {loading ? 'Extracting…' : 'Extract DNS'}
            </button>
          </div>
        </div>

        {result ? (
          <>
            <div className="capGridFrom4">
              <label>Extract folder</label>
              <div className="sub capEllipsis" title={result.extractDir}>{result.extractDir}</div>
            </div>
            <div className="capGridAll">
              <div className="sub">Tip: click to open in Wireshark. Right-click to Analyze.</div>
            </div>
          </>
        ) : null}
      </div>

      {result ? (
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>FILE</th>
              </tr>
            </thead>
            <tbody>
              {result.files.map((f) => (
                <tr
                  key={f.file}
                  onClick={() => onOpen(f.file)}
                  onContextMenu={(e) => onRowContextMenu(e, f.file)}
                  className="capClickableRow"
                  title="Click to open in Wireshark. Right-click for analysis."
                >
                  <td>{f.file}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="sub capPad12">Select a capture file to extract DNS.</div>
      )}

      {ctxMenu && result ? (
        <div className="capCtxBackdrop" onMouseDown={closeCtxMenu} onContextMenu={(e) => e.preventDefault()}>
          <div className="capCtxMenu" ref={ctxMenuRef} onMouseDown={(e) => e.stopPropagation()}>
            <button className="capCtxItem" onClick={() => runAnalyze(ctxMenu.file)}>
              Analyze
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import type { CaptureStatus, SplitIndex } from '../types'

export function CapturesPage({ captureStatus }: { captureStatus: CaptureStatus | null }) {
  const [splitDir, setSplitDir] = useState<string>('')
  const [index, setIndex] = useState<SplitIndex | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [descFilter, setDescFilter] = useState<string>('')

  useEffect(() => {
    const fromStatus = captureStatus?.splitDir
    if (fromStatus) setSplitDir(fromStatus)
  }, [captureStatus?.splitDir])

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

  const canLoad = Boolean(window.tcpwatch && splitDir.trim())

  const onPickSplitFolder = async () => {
    if (!window.tcpwatch) return
    setError(null)
    const picked = await window.tcpwatch.selectSplitFolder()
    if (picked) setSplitDir(picked)
  }

  const onLoad = async () => {
    if (!window.tcpwatch) return
    setError(null)
    try {
      const idx = await window.tcpwatch.readSplitIndex(splitDir.trim())
      setIndex(idx)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      setIndex(null)
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

  return (
    <div className="panel">
      <div className="controls">
        <div className="capGridAll">
          <div className="sub mb6">Split Captures</div>
          {error ? <div className="sub errorText">{error}</div> : null}
        </div>

        <div className="capGridSpan3">
          <label>Split folder</label>
          <div className="capRowFlex">
            <button onClick={onPickSplitFolder}>Choose…</button>
            <div className="sub capEllipsis" title={splitDir || ''}>
              {splitDir ? splitDir : 'No folder selected'}
            </div>
          </div>
        </div>

        <div>
          <label>Index</label>
          <button onClick={onLoad} disabled={!canLoad}>Load</button>
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
            Tip: double-click a stream to open in Wireshark.
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
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr
                  key={s.id}
                  onDoubleClick={() => onOpen(s.file)}
                  className="capClickableRow"
                  title="Double-click to open in Wireshark"
                >
                  <td>{s.id}</td>
                  <td className="capDescCell" title={getDescription(s) || ''}>
                    {getDescription(s)}
                  </td>
                  <td>{s.file}</td>
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
          <div>Capture: {index.captureFile}</div>
          <div>Created: {new Date(index.createdAt).toLocaleString()}</div>
        </div>
      ) : null}
    </div>
  )
}

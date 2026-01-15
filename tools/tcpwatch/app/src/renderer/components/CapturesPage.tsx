import { useEffect, useMemo, useState } from 'react'
import type { CaptureStatus } from '../types'

type SplitIndex = {
  captureFile: string
  splitDir: string
  createdAt: string
  streams: Array<{ id: number; file: string }>
}

export function CapturesPage({ captureStatus }: { captureStatus: CaptureStatus | null }) {
  const [splitDir, setSplitDir] = useState<string>('')
  const [index, setIndex] = useState<SplitIndex | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fromStatus = captureStatus?.splitDir
    if (fromStatus) setSplitDir(fromStatus)
  }, [captureStatus?.splitDir])

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

  const rows = useMemo(() => index?.streams ?? [], [index?.streams])

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
        <div style={{ gridColumn: '1 / -1' }}>
          <div className="sub" style={{ marginBottom: 6 }}>Split Captures</div>
          {error ? <div className="sub errorText">{error}</div> : null}
        </div>

        <div style={{ gridColumn: '1 / span 3' }}>
          <label>Split folder</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={onPickSplitFolder}>Choose…</button>
            <div className="sub" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={splitDir || ''}>
              {splitDir ? splitDir : 'No folder selected'}
            </div>
          </div>
        </div>

        <div>
          <label>Index</label>
          <button onClick={onLoad} disabled={!canLoad}>Load</button>
        </div>

        <div style={{ gridColumn: '1 / -1' }}>
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
                <th>FILE</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr
                  key={s.id}
                  onDoubleClick={() => onOpen(s.file)}
                  style={{ cursor: 'pointer' }}
                  title="Double-click to open in Wireshark"
                >
                  <td>{s.id}</td>
                  <td>{s.file}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="sub" style={{ padding: 12 }}>
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

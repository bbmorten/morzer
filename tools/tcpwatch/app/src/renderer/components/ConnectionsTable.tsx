import { useState } from 'react'
import type { Row } from '../types'

interface ContextMenu {
  x: number
  y: number
  row: Row
}

export function ConnectionsTable({
  rows,
  onKillProcess,
  onProcessInfo
}: {
  rows: Row[]
  onKillProcess?: (row: Row) => void
  onProcessInfo?: (pid: number) => void
}) {
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null)

  const handleContextMenu = (e: React.MouseEvent, row: Row) => {
    if (!onKillProcess && !onProcessInfo) return
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, row })
  }

  const handleKill = () => {
    if (contextMenu && onKillProcess) {
      onKillProcess(contextMenu.row)
    }
    setContextMenu(null)
  }

  const handleInfo = () => {
    if (contextMenu && onProcessInfo) {
      const pid = contextMenu.row.PID
      if (Number.isFinite(pid) && pid > 0) {
        onProcessInfo(pid)
      }
    }
    setContextMenu(null)
  }

  const closeMenu = () => setContextMenu(null)

  return (
    <div className="tableWrap" onClick={closeMenu}>
      <table>
        <thead>
          <tr>
            <th>PROTO</th>
            <th>LOCAL</th>
            <th>REMOTE</th>
            <th>STATE</th>
            <th>PID</th>
            <th>PROCESS</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => (
            <tr
              key={`${r.Proto}-${r.Local}-${r.Remote}-${r.PID}-${idx}`}
              onContextMenu={(e) => handleContextMenu(e, r)}
              title={onKillProcess ? 'Right-click for options' : undefined}
            >
              <td>{r.Proto}</td>
              <td>{r.Local}</td>
              <td>{r.Remote}</td>
              <td>{r.State}</td>
              <td>{r.PID}</td>
              <td>{r.Process || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {contextMenu && (
        <>
          <div className="connCtxBackdrop" onClick={closeMenu} />
          <div
            className="connCtxMenu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            {onProcessInfo && contextMenu.row.PID > 0 && (
              <button type="button" className="connCtxItem" onClick={handleInfo}>
                Info (PID {contextMenu.row.PID})
              </button>
            )}
            {onKillProcess && (
              <button type="button" className="connCtxItem danger" onClick={handleKill}>
                Kill Process (PID {contextMenu.row.PID})
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

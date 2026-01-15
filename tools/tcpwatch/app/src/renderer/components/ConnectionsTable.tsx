import type { Row } from '../types'

export function ConnectionsTable({
  rows,
  onRowDoubleClick
}: {
  rows: Row[]
  onRowDoubleClick?: (row: Row) => void
}) {
  return (
    <div className="tableWrap">
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
              onDoubleClick={() => onRowDoubleClick?.(r)}
              style={onRowDoubleClick ? { cursor: 'pointer' } : undefined}
              title={onRowDoubleClick ? 'Double-click to terminate this PID' : undefined}
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
    </div>
  )
}

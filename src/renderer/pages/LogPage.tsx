import { useCallback, useEffect, useState } from 'react'
import type { LogRow } from '../../shared/ipc'

export function LogPage() {
  const [rows, setRows] = useState<LogRow[]>([])
  const refresh = useCallback(() => {
    window.api.getLog(100).then(setRows)
  }, [])
  useEffect(refresh, [refresh])

  return (
    <div>
      <h2 className="h4 mb-3">
        <i className="bi bi-journal-text me-2" />Log Keputusan
        <button className="btn btn-sm btn-outline-secondary ms-3" onClick={refresh}>
          <i className="bi bi-arrow-clockwise" /> Muat ulang
        </button>
      </h2>
      <div className="table-responsive">
        <table className="table table-sm align-middle">
          <thead>
            <tr><th>Waktu</th><th>Pesan</th><th>Keputusan</th><th>Skor</th><th>Sumber</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.message_id}>
                <td className="text-nowrap">{new Date(r.created_at).toLocaleString('id-ID')}</td>
                <td className="text-break">{r.text ?? <em className="text-body-secondary">(non-teks)</em>}</td>
                <td><code>{r.decision}</code></td>
                <td>{r.top_score == null ? '–' : r.top_score.toFixed(2)}</td>
                <td>{r.sources ? (JSON.parse(r.sources) as string[]).join(', ') : ''}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="text-body-secondary">Belum ada pesan.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

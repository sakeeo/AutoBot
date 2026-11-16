import { useCallback, useEffect, useState } from 'react'
import type { LogRow } from '../../shared/ipc'
import { Card } from '../ui/Card'
import { DataTable } from '../ui/DataTable'
import { PageHeader } from '../ui/PageHeader'
import { EmptyState, ErrorState, LoadingState } from '../ui/States'
import { StatusBadge, type Tone } from '../ui/StatusBadge'

const tone = (d: string): Tone =>
  d.startsWith('replied') ? 'success' : d.startsWith('handoff') ? 'info' : d.startsWith('error') ? 'danger' : 'neutral'

function sourcesOf(raw: string | null): string {
  if (!raw) return ''
  try {
    return (JSON.parse(raw) as string[]).join(', ')
  } catch {
    return ''
  }
}

export function LogPage() {
  const [rows, setRows] = useState<LogRow[] | null>(null)
  const [failed, setFailed] = useState(false)
  const refresh = useCallback(() => {
    setFailed(false)
    window.api.getLog(100).then(setRows).catch(() => setFailed(true))
  }, [])
  useEffect(refresh, [refresh])

  return (
    <div>
      <PageHeader icon="bi-journal-text" title="Log Keputusan" subtitle="Keputusan bot untuk setiap pesan yang masuk."
        actions={
          <button className="btn btn-outline-secondary" onClick={refresh}>
            <i className="bi bi-arrow-clockwise me-1" aria-hidden="true" />Muat ulang
          </button>
        } />
      <Card title="Pesan terakhir">
        {failed ? (
          <ErrorState message="Gagal memuat log." onRetry={refresh} />
        ) : rows === null ? (
          <LoadingState />
        ) : (
          <DataTable<LogRow>
            caption="Log keputusan"
            rows={rows}
            rowKey={(r) => r.message_id}
            pageSize={10}
            empty={<EmptyState title="Belum ada pesan." hint="Pesan yang masuk akan tercatat di sini." />}
            columns={[
              { key: 'time', header: 'Waktu', render: (r) => <span className="text-nowrap">{new Date(r.created_at).toLocaleString('id-ID')}</span> },
              { key: 'decision', header: 'Keputusan', render: (r) => <StatusBadge tone={tone(r.decision)}>{r.decision}</StatusBadge> },
              { key: 'score', header: 'Skor', align: 'end', render: (r) => (r.top_score == null ? '–' : r.top_score.toFixed(2)) },
              { key: 'sources', header: 'Sumber', render: (r) => sourcesOf(r.sources) },
              { key: 'text', header: 'Pesan', render: (r) => <span className="text-break">{r.text ?? <em className="text-body-secondary">(non-teks)</em>}</span> }
            ]}
          />
        )}
      </Card>
    </div>
  )
}

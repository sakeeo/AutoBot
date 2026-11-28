import { useCallback, useEffect, useState } from 'react'
import type { LogRow } from '@autobot/contracts/ipc'
import { Card } from '../ui/Card'
import { DataTable } from '../ui/DataTable'
import { PageHeader } from '../ui/PageHeader'
import { EmptyState, ErrorState, LoadingState } from '../ui/States'
import { StatusBadge, type Tone } from '../ui/StatusBadge'
import { useNarrow } from '../useNarrow'

const tone = (d: string): Tone =>
  d.startsWith('replied') ? 'success' : d.startsWith('handoff') ? 'warning' : d.startsWith('error') ? 'danger' : 'neutral'
/** Figma "Log": the decision in plain words, with the internal code kept as a tooltip. */
const label = (d: string): string => {
  const [kind, why] = d.split(':')
  if (kind === 'replied') return why === 'ai' ? 'Dibalas AI' : 'Dibalas dari dokumen'
  if (kind === 'handoff') return `Diserahkan: ${why ?? 'admin'}`
  if (kind === 'out_of_context') return 'Di luar konteks — tidak dibalas'
  if (kind === 'error') return 'Galat'
  return d
}

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
  const narrow = useNarrow()
  const refresh = useCallback(() => {
    setFailed(false)
    window.api.getLog(100).then(setRows).catch(() => setFailed(true))
  }, [])
  useEffect(refresh, [refresh])

  return (
    <div>
      <PageHeader title="Log" subtitle="Setiap balasan bot dan alasannya."
        actions={<button className="btn btn-outline-secondary" onClick={refresh}>Muat ulang</button>} />
      <Card title="Pesan terakhir">
        {failed ? (
          <ErrorState message="Gagal memuat log." onRetry={refresh} />
        ) : rows === null ? (
          <LoadingState />
        ) : (
          narrow ? (
          <ul className="log-cards" aria-label="Log keputusan">
            {rows.length === 0 && <li><EmptyState title="Belum ada pesan." hint="Pesan yang masuk akan tercatat di sini." /></li>}
            {rows.slice(0, 50).map((r) => (
              <li key={r.message_id}>
                <small>{new Date(r.created_at).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} · {r.chat_id.split('@')[0]}</small>
                <span className="text-break">{r.text ?? '(non-teks)'}</span>
                <span title={r.decision}><StatusBadge tone={tone(r.decision)}>{label(r.decision)}</StatusBadge></span>
              </li>
            ))}
          </ul>
          ) : (
          <DataTable<LogRow>
            caption="Log keputusan"
            rows={rows}
            rowKey={(r) => r.message_id}
            pageSize={10}
            empty={<EmptyState title="Belum ada pesan." hint="Pesan yang masuk akan tercatat di sini." />}
            columns={[
              { key: 'time', header: 'Waktu', render: (r) => <span className="text-nowrap">{new Date(r.created_at).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span> },
              { key: 'who', header: 'Pelanggan', render: (r) => <span className="text-nowrap">{r.chat_id.split('@')[0]}</span> },
              { key: 'decision', header: 'Keputusan', render: (r) => <span title={r.decision}><StatusBadge tone={tone(r.decision)}>{label(r.decision)}</StatusBadge></span> },
              { key: 'score', header: 'Skor', align: 'end', render: (r) => (r.top_score == null ? '–' : r.top_score.toFixed(2)) },
              { key: 'sources', header: 'Sumber', render: (r) => sourcesOf(r.sources) },
              { key: 'text', header: 'Pesan', render: (r) => <span className="text-break">{r.text ?? <em className="text-body-secondary">(non-teks)</em>}</span> }
            ]}
          />
          )
        )}
      </Card>
    </div>
  )
}

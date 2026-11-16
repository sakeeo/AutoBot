import { useCallback, useEffect, useState } from 'react'
import type { ConnStatus, Settings } from '../../shared/types'
import type { DashboardData, DashboardPeriod, LogRow } from '../../shared/ipc'
import { id } from '../i18n/id'
import { Card } from '../ui/Card'
import { DataTable } from '../ui/DataTable'
import { EmptyState, ErrorState, LoadingState } from '../ui/States'
import { PageHeader } from '../ui/PageHeader'
import { StatusBadge, type Tone } from '../ui/StatusBadge'

const REFRESH_MS = 15_000
const CONN_TONE: Record<ConnStatus['state'], Tone> = {
  disconnected: 'neutral',
  connecting: 'warning',
  waiting_qr: 'warning',
  connected: 'success'
}
const ROWS: [keyof DashboardPeriod, string][] = [
  ['replied', 'Dibalas'],
  ['refused', 'Ditolak'],
  ['handoff', 'Diserahkan ke admin'],
  ['errors', 'Galat'],
  ['links', 'Tautan terkirim']
]

const decisionTone = (d: string): Tone =>
  d.startsWith('replied') ? 'success' : d.startsWith('handoff') ? 'info' : d.startsWith('error') ? 'danger' : 'neutral'

function PeriodCard({ title, data }: { title: string; data: DashboardPeriod }) {
  return (
    <Card title={title} className="h-100">
      <dl className="metric-list">
        {ROWS.map(([k, label], i) => (
          <Row key={k} label={label} value={data[k]} kpi={i === 0} />
        ))}
      </dl>
    </Card>
  )
}

function Row({ label, value, kpi }: { label: string; value: number; kpi: boolean }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className={kpi ? 'kpi-value' : undefined}>{value}</dd>
    </>
  )
}

export function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState(false)
  const [status, setStatus] = useState<ConnStatus['state']>('disconnected')
  const [settings, setSettings] = useState<Settings | null>(null)
  const [hasKey, setHasKey] = useState(false)
  const [adminCount, setAdminCount] = useState<number | null>(null)
  const [dismissed, setDismissed] = useState<string[]>([])

  const load = useCallback(async () => {
    try {
      const [d, s, k] = await Promise.all([window.api.getDashboard(), window.api.getSettings(), window.api.hasApiKey()])
      setData(d)
      setSettings(s)
      setHasKey(k)
      setError(false)
    } catch {
      setError(true)
      return
    }
    try {
      setAdminCount((await window.api.getBrand()).active.admins.length)
    } catch {
      setAdminCount(null)
    }
  }, [])

  useEffect(() => {
    let live = true
    window.api.getStatus().then((s) => live && setStatus(s.state))
    const off = window.api.onStatus((s) => setStatus(s.state))
    load()
    const timer = window.setInterval(() => load(), REFRESH_MS)
    return () => {
      live = false
      off()
      window.clearInterval(timer)
    }
  }, [load])

  const header = <PageHeader icon="bi-speedometer2" title="Dashboard" subtitle="Ringkasan aktivitas bot Anda." />
  if (!data || !settings)
    return (
      <div>
        {header}
        {error ? <ErrorState message="Gagal memuat dashboard." onRetry={load} /> : <LoadingState />}
      </div>
    )

  const aiOn = settings.mode === 'ai' && hasKey
  const warnings: string[] = []
  if (adminCount === 0) warnings.push('Belum ada admin: pelanggan yang diserahkan tidak akan dikabari lewat WhatsApp. Atur di Pengaturan → Brand & Konversi → Tautan & Admin.')
  if (settings.mode === 'ai' && !hasKey) warnings.push('API key belum diatur untuk mode AI. Atur di Pengaturan → Connector → AI.')
  if (settings.knowledgeFolders.length === 0) warnings.push('Belum ada folder pengetahuan. Pilih folder di Pengaturan → Pengetahuan.')

  return (
    <div>
      {header}

      {warnings.filter((w) => !dismissed.includes(w)).map((w) => (
        <div key={w} className="announcement-banner" role="status">
          <i className="bi bi-info-circle" aria-hidden="true" />
          <span className="text">{w}</span>
          <button type="button" className="close-btn" aria-label="Tutup peringatan" onClick={() => setDismissed((d) => [...d, w])}>
            <i className="bi bi-x-lg" aria-hidden="true" />
          </button>
        </div>
      ))}

      <div className="d-flex flex-wrap gap-2 mb-4">
        <StatusBadge tone={CONN_TONE[status]}>{id.state[status]}</StatusBadge>
        <StatusBadge tone={aiOn ? 'success' : 'neutral'}>{`AI: ${aiOn ? 'Aktif' : 'Nonaktif'}`}</StatusBadge>
        <StatusBadge tone={data.files.failed > 0 ? 'warning' : 'neutral'}>
          {`${data.files.indexed} file terindeks${data.files.failed > 0 ? ` · ${data.files.failed} gagal` : ''}`}
        </StatusBadge>
      </div>

      <div className="row g-3 mb-3">
        <div className="col-md-4"><PeriodCard title="Hari ini" data={data.today} /></div>
        <div className="col-md-4"><PeriodCard title="7 hari terakhir" data={data.week} /></div>
        <div className="col-md-4">
          <Card title="Menunggu admin" className="h-100">
            <div className="display-6 fw-bold">{data.waitingAdmin}</div>
            <div className="small text-body-secondary">chat yang menunggu balasan manusia</div>
          </Card>
        </div>
      </div>

      <Card title="Aktivitas terakhir">
        <DataTable<LogRow>
          caption="Aktivitas terakhir"
          rows={data.recent}
          rowKey={(r) => r.message_id}
          pageSize={5}
          empty={<EmptyState title="Belum ada aktivitas." hint="Pesan yang masuk akan muncul di sini." />}
          columns={[
            { key: 'time', header: 'Waktu', render: (r) => new Date(r.created_at).toLocaleString('id-ID') },
            { key: 'decision', header: 'Keputusan', render: (r) => <StatusBadge tone={decisionTone(r.decision)}>{r.decision}</StatusBadge> },
            { key: 'text', header: 'Pesan', render: (r) => <span className="d-inline-block text-truncate" style={{ maxWidth: 320 }}>{r.text ?? ''}</span> }
          ]}
        />
      </Card>
    </div>
  )
}

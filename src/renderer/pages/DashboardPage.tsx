import { useCallback, useEffect, useState } from 'react'
import type { ConnStatus, Settings } from '../../shared/types'
import type { DashboardData, DashboardPeriod } from '../../shared/ipc'
import { id } from '../i18n/id'

const REFRESH_MS = 15_000
const BADGE: Record<ConnStatus['state'], string> = {
  disconnected: 'text-bg-secondary',
  connecting: 'text-bg-warning',
  waiting_qr: 'text-bg-warning',
  connected: 'text-bg-success'
}
const ROWS: [keyof DashboardPeriod, string][] = [
  ['replied', 'Dibalas'],
  ['refused', 'Ditolak'],
  ['handoff', 'Diserahkan ke admin'],
  ['errors', 'Galat'],
  ['links', 'Tautan terkirim']
]

function PeriodCard({ title, data }: { title: string; data: DashboardPeriod }) {
  return (
    <section className="card h-100" aria-label={title}>
      <div className="card-body">
        <h3 className="h6 text-body-secondary">{title}</h3>
        <dl className="row mb-0">
          {ROWS.map(([k, label]) => (
            <Row key={k} label={label} value={data[k]} />
          ))}
        </dl>
      </div>
    </section>
  )
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <>
      <dt className="col-8 fw-normal">{label}</dt>
      <dd className="col-4 text-end fw-semibold mb-1">{value}</dd>
    </>
  )
}

export function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [status, setStatus] = useState<ConnStatus['state']>('disconnected')
  const [settings, setSettings] = useState<Settings | null>(null)
  const [hasKey, setHasKey] = useState(false)
  const [adminCount, setAdminCount] = useState<number | null>(null)

  const load = useCallback(async () => {
    const [d, s, k] = await Promise.all([window.api.getDashboard(), window.api.getSettings(), window.api.hasApiKey()])
    setData(d)
    setSettings(s)
    setHasKey(k)
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
    load().catch(() => undefined)
    const timer = window.setInterval(() => load().catch(() => undefined), REFRESH_MS)
    return () => {
      live = false
      off()
      window.clearInterval(timer)
    }
  }, [load])

  if (!data || !settings) return <p className="text-body-secondary">Memuat…</p>

  const aiOn = settings.mode === 'ai' && hasKey
  const warnings: string[] = []
  if (adminCount === 0) warnings.push('Belum ada admin: pelanggan yang diserahkan tidak akan dikabari lewat WhatsApp. Atur di Pengaturan → Brand & Konversi → Tautan & Admin.')
  if (settings.mode === 'ai' && !hasKey) warnings.push('API key belum diatur untuk mode AI. Atur di Pengaturan → Connector → AI.')
  if (settings.knowledgeFolders.length === 0) warnings.push('Belum ada folder pengetahuan. Pilih folder di Pengaturan → Pengetahuan.')

  return (
    <div>
      <h2 className="h4 mb-3"><i className="bi bi-speedometer2 me-2" />Dashboard</h2>

      <div className="d-flex flex-wrap gap-2 mb-3">
        <span className={`badge ${BADGE[status]} fs-6`}><i className="bi bi-whatsapp me-1" />{id.state[status]}</span>
        <span className={`badge ${aiOn ? 'text-bg-success' : 'text-bg-secondary'} fs-6`}>
          <i className="bi bi-stars me-1" />AI: {aiOn ? 'Aktif' : 'Nonaktif'}
        </span>
        <span className="badge text-bg-light border fs-6">
          <i className="bi bi-files me-1" />{data.files.indexed} file terindeks
          {data.files.failed > 0 && <span className="text-danger"> · {data.files.failed} gagal</span>}
        </span>
      </div>

      {warnings.map((w) => (
        <div key={w} className="alert alert-warning py-2" role="status">
          <i className="bi bi-exclamation-triangle me-2" />{w}
        </div>
      ))}

      <div className="row g-3 mb-3">
        <div className="col-md-4"><PeriodCard title="Hari ini" data={data.today} /></div>
        <div className="col-md-4"><PeriodCard title="7 hari terakhir" data={data.week} /></div>
        <div className="col-md-4">
          <section className="card h-100" aria-label="Menunggu admin">
            <div className="card-body">
              <h3 className="h6 text-body-secondary">Menunggu admin</h3>
              <div className="display-6">{data.waitingAdmin}</div>
              <div className="small text-body-secondary">chat yang menunggu balasan manusia</div>
            </div>
          </section>
        </div>
      </div>

      <section className="card" aria-label="Aktivitas terakhir">
        <div className="card-body">
          <h3 className="h6 text-body-secondary">Aktivitas terakhir</h3>
          {data.recent.length === 0 ? (
            <p className="mb-0 text-body-secondary">Belum ada aktivitas.</p>
          ) : (
            <ul className="list-group list-group-flush">
              {data.recent.map((r) => (
                <li key={r.message_id} className="list-group-item px-0">
                  <div className="small text-body-secondary">
                    {new Date(r.created_at).toLocaleString('id-ID')} · <code>{r.decision}</code>
                  </div>
                  <div className="text-truncate">{r.text ?? ''}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  )
}

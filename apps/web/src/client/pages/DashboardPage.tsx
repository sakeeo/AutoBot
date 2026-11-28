import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import type { ConnStatus, Settings } from '@autobot/contracts/types'
import type { DashboardData, LogRow } from '@autobot/contracts/ipc'
import { EmptyState, ErrorState, LoadingState } from '../ui/States'
import { PageHeader } from '../ui/PageHeader'
import { StatusBadge, type Tone } from '../ui/StatusBadge'
import { Counter } from '../dashboard/useCountUp'
import { TESTED_KEY } from './TestPanel'

const REFRESH_MS = 15_000

const decisionTone = (d: string): Tone =>
  d.startsWith('replied') ? 'success' : d.startsWith('handoff') ? 'warning' : d.startsWith('error') ? 'danger' : 'neutral'
const decisionLabel = (d: string): string =>
  d.startsWith('replied') ? 'Dibalas bot' : d.startsWith('handoff') ? `Diserahkan: ${d.split(':')[1] ?? 'admin'}` : d.startsWith('error') ? 'Galat' : 'Tidak dibalas'
const number = (chatId: string): string => chatId.split('@')[0]

interface Step { done: boolean; title: string; hint: string; action: string; href: string }

/** Figma "Mulai cepat": the bot switch, then what is still missing, each with a button straight to the fix. */
function QuickStart({ steps, botOn, onToggle }: { steps: Step[]; botOn: boolean; onToggle(): void }) {
  const left = steps.filter((s) => !s.done).length
  return (
    <section className={`quickstart${botOn ? ' is-on' : ''}`} aria-label="Mulai cepat">
      <div className="quickstart-band">
        <strong>{botOn ? 'Bot aktif — pelanggan dibalas otomatis' : 'Bot nonaktif — pelanggan belum dibalas'}</strong>
        {botOn
          ? <button type="button" className="btn btn-outline-secondary" onClick={onToggle}>Matikan bot</button>
          : <button type="button" className="btn btn-cta" onClick={onToggle}>Aktifkan bot</button>}
      </div>
      {left > 0 && (
        <div className="quickstart-body">
          <p className="quickstart-lead">Selesaikan langkah ini agar bot siap · ±{left * 2} menit lagi</p>
          <ul className="quickstart-list">
            {steps.map((s) => (
              <li key={s.title} className={s.done ? 'is-done' : undefined}>
                <span className="quickstart-mark" aria-hidden="true"><i className={`bi ${s.done ? 'bi-check-lg' : 'bi-circle'}`} /></span>
                <span className="quickstart-text">
                  <strong>{s.title}</strong>
                  <small>{s.done ? 'Selesai' : s.hint}</small>
                </span>
                {!s.done && <Link href={s.href} className="btn btn-outline-secondary quickstart-btn">{s.action}</Link>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function Metric({ label, value, suffix, hint }: { label: string; value: number; suffix?: string; hint: string }) {
  return (
    <div className="metric-card">
      <div className="metric-label">{label}</div>
      <div className="metric-value"><Counter value={value} />{suffix}</div>
      <div className="metric-hint">{hint}</div>
    </div>
  )
}

export function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState(false)
  const [status, setStatus] = useState<ConnStatus['state']>('disconnected')
  const [settings, setSettings] = useState<Settings | null>(null)
  const [hasKey, setHasKey] = useState(false)
  const [adminCount, setAdminCount] = useState<number | null>(null)
  const [botOn, setBotOn] = useState<boolean | null>(null)
  const [switchError, setSwitchError] = useState<string | null>(null)
  const [tested, setTested] = useState(false)

  const load = useCallback(async () => {
    try {
      const [d, s, k, b] = await Promise.all([window.api.getDashboard(), window.api.getSettings(), window.api.hasApiKey(), window.api.getBotEnabled()])
      setData(d)
      setSettings(s)
      setHasKey(k)
      setBotOn(b)
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
    try { setTested(localStorage.getItem(TESTED_KEY) === '1') } catch { /* private mode: treat as not tested */ }
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

  const header = <PageHeader title="Dashboard" subtitle="Ringkasan aktivitas bot Anda." />
  if (!data || !settings)
    return (
      <div>
        {header}
        {error ? <ErrorState message="Gagal memuat dashboard." onRetry={load} /> : <LoadingState />}
      </div>
    )

  async function toggleBot(): Promise<void> {
    setSwitchError(null)
    try {
      setBotOn(await window.api.setBotEnabled(!botOn))
    } catch (e) {
      // the password prompt being cancelled is not an error worth showing
      if ((e as { code?: string }).code !== 'CANCELLED') setSwitchError('Gagal mengubah status bot.')
    }
  }

  const steps: Step[] = [
    { done: status === 'connected', title: 'Bot tersambung ke WhatsApp', hint: 'Pindai QR di Connector', action: 'Hubungkan', href: '/pengaturan/connector' },
    { done: data.files.indexed > 0, title: 'Bot tahu jawaban soal harga', hint: 'Unggah dokumen atau hubungkan Google Sheet', action: 'Tambah', href: '/pengaturan/pengetahuan' },
    { done: adminCount !== null && adminCount > 0, title: 'Admin dikabari saat chat diserahkan', hint: 'Isi nomor admin di Brand & Konversi', action: 'Atur', href: '/pengaturan/brand' },
    { done: tested, title: 'Jawaban sudah dicoba', hint: 'Kirim beberapa pertanyaan di Uji Jawaban', action: 'Buka Uji', href: '/uji' }
  ]
  const today = data.today
  const week = data.week
  const answeredToday = today.replied + today.refused + today.handoff + today.errors
  const rate = answeredToday ? Math.round((today.replied / answeredToday) * 100) : 0

  return (
    <div className="dash">
      {header}
      <QuickStart steps={steps} botOn={!!botOn} onToggle={() => void toggleBot()} />
      {switchError && <div className="alert alert-danger" role="alert">{switchError}</div>}
      {settings.mode === 'ai' && !hasKey && (
        <div className="alert alert-warning" role="status">
          API key belum diatur untuk mode AI. <Link href="/pengaturan/ai">Atur di halaman AI</Link>.
        </div>
      )}

      <div className="metric-grid">
        <Metric label="Pesan masuk hari ini" value={data.incomingToday ?? answeredToday}
          hint={`7 hari: ${week.replied + week.refused + week.handoff + week.errors} pesan dijawab`} />
        <Metric label="Dibalas bot" value={rate} suffix="%" hint={`${today.replied} dari ${answeredToday} hari ini · target ≥ 80%`} />
        <Metric label="Diserahkan ke admin" value={today.handoff} hint={`${data.waitingAdmin} masih menunggu admin`} />
        <Metric label="Lead terkumpul" value={data.leads ?? 0} hint="Nama dan kebutuhan pelanggan" />
      </div>

      <section className="card activity-card" aria-label="Aktivitas terbaru">
        <div className="card-body">
          <h2 className="section-title">Aktivitas terbaru</h2>
          {data.recent.length === 0 ? (
            <EmptyState title="Belum ada aktivitas." hint="Setelah bot aktif, chat terbaru muncul di sini." />
          ) : (
            <ul className="activity-list">
              {data.recent.map((r: LogRow) => (
                <li key={r.message_id}>
                  <Link className="activity-link" href={`/pesan?chat=${encodeURIComponent(r.chat_id)}`} aria-label={`Buka chat ${number(r.chat_id)}`} />
                  <time>{new Date(r.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</time>
                  <span className="activity-who">{number(r.chat_id)}</span>
                  <span className="activity-text">{r.text ?? ''}</span>
                  <StatusBadge tone={decisionTone(r.decision)}>{decisionLabel(r.decision)}</StatusBadge>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  )
}

import { useCallback, useEffect, useState } from 'react'
import type { OverviewView, SafetyView } from '../../shared/broadcast'
import { Card } from '../ui/Card'
import { ConfirmButton } from '../ui/ConfirmButton'
import { ErrorState, LoadingState } from '../ui/States'
import { StatusBadge, type Tone } from '../ui/StatusBadge'
import { TIER_LABEL } from './labels'

const HEALTH: Record<OverviewView['health']['level'], { label: string; tone: Tone }> = {
  aman: { label: 'Aman', tone: 'success' }, 'hati-hati': { label: 'Hati-hati', tone: 'warning' }, dijeda: { label: 'Dijeda', tone: 'danger' }
}

export function SafetyTab() {
  const [safety, setSafety] = useState<SafetyView | null>(null)
  const [health, setHealth] = useState<OverviewView['health'] | null>(null)
  const [failed, setFailed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [age, setAge] = useState('15')

  const load = useCallback(() => {
    setFailed(false)
    window.api.bcGetSafety().then(setSafety).catch(() => setFailed(true))
    window.api.bcOverview().then((o) => setHealth(o.health)).catch(() => undefined)
  }, [])
  useEffect(load, [load])

  async function change(patch: Record<string, unknown>): Promise<void> {
    const r = await window.api.bcSetSafety(patch)
    setError(r.ok ? null : r.error)
    load()
  }

  const emergency = (
    <button type="button" className="btn btn-danger" onClick={() => window.api.bcStopAll().then(load)}>
      <i className="bi bi-sign-stop me-1" aria-hidden="true" />Hentikan semua
    </button>
  )
  if (failed) return <ErrorState message="Gagal memuat pengaturan keamanan." onRetry={load} />
  if (!safety) return <LoadingState />

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <div className="d-flex align-items-center gap-2">
          {health && <StatusBadge tone={HEALTH[health.level].tone}>{HEALTH[health.level].label}</StatusBadge>}
          {health && <span className="text-body-secondary">{health.reason}</span>}
        </div>
        {emergency}
      </div>
      {error && <div className="alert alert-danger" role="alert">{error}</div>}

      {!safety.configured && (
        <Card title="Deklarasi usia nomor" className="mb-3">
          <p className="text-body-secondary">
            Dinyatakan sekali. Nomor baru dibatasi ketat dan batasnya naik sendiri seiring waktu; tidak bisa dinaikkan manual.
          </p>
          <div className="mb-3" style={{ maxWidth: 320 }}>
            <label htmlFor="age" className="form-label">Usia nomor WhatsApp</label>
            <select id="age" className="form-select" value={age} onChange={(e) => setAge(e.target.value)}>
              <option value="15">Baru (kurang dari 30 hari)</option>
              <option value="60">Berkembang (30–90 hari)</option>
              <option value="180">Mapan (lebih dari 90 hari)</option>
            </select>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => change({ ageDays: Number(age), enabled: true })}>
            Simpan dan aktifkan
          </button>
        </Card>
      )}

      <Card title="Batas dan jam kirim" className="mb-3">
        <dl className="metric-list mb-3">
          <dt>Tingkat nomor</dt><dd>{TIER_LABEL[safety.tier]}</dd>
          <dt>Batas hari ini</dt><dd>{`${safety.sentToday} dari ${safety.dailyCap} pesan hari ini`}</dd>
          <dt>Jam kirim</dt><dd>{`${safety.window.start}–${safety.window.end} (${safety.window.timezone})`}</dd>
        </dl>
        <div className="form-check form-switch mb-3">
          <input id="bc-enabled" type="checkbox" role="switch" className="form-check-input" checked={safety.enabled} disabled={!safety.configured}
            onChange={(e) => change({ enabled: e.target.checked })} />
          <label htmlFor="bc-enabled" className="form-check-label">Broadcast aktif</label>
        </div>
        <div className="mb-3" style={{ maxWidth: 280 }}>
          <label htmlFor="gap" className="form-label">Jarak minimal per kontak (hari)</label>
          <select id="gap" className="form-select" value={safety.minGapDays} onChange={(e) => change({ minGapDays: Number(e.target.value) })}>
            {[3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <div className="form-text">Dapat diturunkan sampai 3 hari, tidak lebih rendah.</div>
        </div>
        {safety.configured && (
          <ConfirmButton label="Saya mengganti nomor" confirmLabel="Ya, ganti nomor" className="btn btn-outline-secondary"
            onConfirm={() => change({ changeNumber: true, confirm: true })} />
        )}
      </Card>
    </div>
  )
}

import { useCallback, useEffect, useState } from 'react'
import QRCode from 'qrcode'
import type { ConnStatus } from '@autobot/contracts/types'
import { id } from '../i18n/id'
import { Card } from '../ui/Card'
import { ConfirmButton } from '../ui/ConfirmButton'
import { PageHeader } from '../ui/PageHeader'
import { ErrorState } from '../ui/States'
import { StatusBadge, type Tone } from '../ui/StatusBadge'

const TONE: Record<ConnStatus['state'], Tone> = {
  disconnected: 'neutral',
  connecting: 'warning',
  waiting_qr: 'warning',
  connected: 'success'
}

export function ConnectionPage() {
  const [status, setStatus] = useState<ConnStatus>({ state: 'disconnected' })
  const [failed, setFailed] = useState(false)
  const [agreed, setAgreed] = useState(false)
  const [qrSrc, setQrSrc] = useState<string | null>(null)
  const [selfNumber, setSelfNumber] = useState<string | null>(null)
  const [botOn, setBotOn] = useState<boolean | null>(null)
  const [switchError, setSwitchError] = useState<string | null>(null)

  useEffect(() => {
    window.api.getBotEnabled?.().then(setBotOn).catch(() => undefined)
  }, [])
  useEffect(() => {
    if (status.state !== 'connected') { setSelfNumber(null); return }
    window.api.getSelfNumber?.().then(setSelfNumber).catch(() => undefined)
  }, [status.state])

  async function toggleBot(): Promise<void> {
    setSwitchError(null)
    try {
      setBotOn(await window.api.setBotEnabled(!botOn))
    } catch (e) {
      if ((e as { code?: string }).code !== 'CANCELLED') setSwitchError('Gagal mengubah status bot.')
    }
  }

  const load = useCallback(() => {
    setFailed(false)
    return window.api.getStatus().then(setStatus).catch(() => setFailed(true))
  }, [])

  useEffect(() => {
    let live = true
    window.api.getStatus().then((s) => live && setStatus(s)).catch(() => live && setFailed(true))
    const off = window.api.onStatus((s) => live && setStatus(s))
    return () => { live = false; off() }
  }, [])

  useEffect(() => {
    if (status.state !== 'waiting_qr' || !status.qr) { setQrSrc(null); return }
    let live = true
    QRCode.toString(status.qr, { type: 'svg', margin: 1, width: 260 })
      .then((svg) => live && setQrSrc('data:image/svg+xml;utf8,' + encodeURIComponent(svg)))
      .catch(() => live && setQrSrc(null))
    return () => { live = false }
  }, [status])

  const busy = status.state === 'connecting' || status.state === 'waiting_qr'

  return (
    <div>
      <PageHeader title="Connector" subtitle="Koneksi WhatsApp bot, saklar bot, dan status layanan." />
      {failed && <div className="mb-3"><ErrorState message="Gagal memuat status koneksi." onRetry={load} /></div>}

      <div className="connector-grid">
        <Card title="WhatsApp" aria-label="WhatsApp">
          <StatusBadge tone={TONE[status.state]}>{id.state[status.state]}</StatusBadge>
          {status.state === 'connected' ? (
            <>
              <div className="connector-number">
                <small>Nomor bot</small>
                <strong>{selfNumber ? `+${selfNumber}` : '—'}</strong>
              </div>
              <ConfirmButton label="Putuskan" confirmLabel="Ya, putuskan" ariaLabel="Putuskan WhatsApp" className="btn btn-outline-danger"
                onConfirm={() => window.api.logout()}>
                Putuskan
              </ConfirmButton>
            </>
          ) : (
            <>
              <div className="alert alert-warning small mt-3">
                {id.risk}
                <div className="form-check mt-2 mb-0">
                  <input className="form-check-input" type="checkbox" id="agree" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                  <label className="form-check-label" htmlFor="agree">Saya mengerti risikonya dan memakai nomor yang siap menanggungnya</label>
                </div>
              </div>
              {qrSrc && (
                <div className="connector-qr" aria-label="QR WhatsApp">
                  <img src={qrSrc} alt="QR WhatsApp" width={220} height={220} />
                  <small>WhatsApp → Perangkat tertaut → Tautkan perangkat, lalu pindai kode ini.</small>
                </div>
              )}
              <button className="btn btn-primary" disabled={!agreed || busy} onClick={() => window.api.connect()}>
                {status.state === 'waiting_qr' ? 'Menunggu pindai…' : 'Hubungkan WhatsApp'}
              </button>
            </>
          )}
        </Card>

        <Card title="Status bot" aria-label="Status bot">
          <div className="connector-switch">
            <span>
              <strong>Bot membalas pelanggan</strong>
              <small>{botOn ? 'Aktif: pesan pelanggan dijawab otomatis.' : 'Matikan untuk menjeda semua balasan otomatis.'}</small>
            </span>
            <div className="form-check form-switch m-0">
              <input className="form-check-input" type="checkbox" role="switch" id="bot-switch" aria-label="Bot membalas pelanggan"
                checked={!!botOn} disabled={botOn === null} onChange={() => void toggleBot()} />
            </div>
          </div>
          {switchError && <div className="text-danger small mt-2" role="alert">{switchError}</div>}
        </Card>
      </div>

      <Card title="Layanan" aria-label="Layanan">
        <div className="d-flex flex-wrap gap-2 mb-2">
          <StatusBadge tone="success">Web: aktif</StatusBadge>
          <StatusBadge tone={failed ? 'danger' : 'success'}>{failed ? 'Worker: tidak terjangkau' : 'Worker: aktif'}</StatusBadge>
        </div>
        <small className="text-body-secondary">Bila worker mati, panel tetap bisa dibuka, tetapi bot tidak membalas sampai worker hidup lagi.</small>
      </Card>
    </div>
  )
}

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
      <PageHeader icon="bi-whatsapp" title="Koneksi WhatsApp"
        subtitle="Hubungkan nomor WhatsApp yang dipakai bot."
        actions={<StatusBadge tone={TONE[status.state]}>{id.state[status.state]}</StatusBadge>} />

      {failed && <div className="mb-3"><ErrorState message="Gagal memuat status koneksi." onRetry={load} /></div>}

      {status.state !== 'connected' && (
        <div className="alert alert-warning">
          <i className="bi bi-exclamation-triangle me-2" aria-hidden="true" />{id.risk}
          <div className="form-check mt-3">
            <input className="form-check-input" type="checkbox" id="agree" checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)} />
            <label className="form-check-label" htmlFor="agree">
              Saya mengerti risikonya dan memakai nomor yang siap menanggungnya
            </label>
          </div>
        </div>
      )}

      {qrSrc && (
        <Card title="Scan untuk menautkan" className="mb-3" aria-label="QR WhatsApp">
          <div className="text-center">
            <img src={qrSrc} alt="QR WhatsApp" width={260} height={260} />
            <p className="small text-body-secondary mb-0 mt-2">
              WhatsApp → Perangkat tertaut → Tautkan perangkat, lalu scan kode ini.
            </p>
          </div>
        </Card>
      )}

      {status.state === 'connected' ? (
        <ConfirmButton label="Keluar dari WhatsApp" confirmLabel="Ya, keluar" className="btn btn-outline-danger"
          onConfirm={() => window.api.logout()}>
          <><i className="bi bi-box-arrow-right me-1" aria-hidden="true" />Keluar dari WhatsApp</>
        </ConfirmButton>
      ) : (
        <button className="btn btn-primary" disabled={!agreed || busy} onClick={() => window.api.connect()}>
          <i className="bi bi-link-45deg me-1" aria-hidden="true" />Hubungkan WhatsApp
        </button>
      )}
    </div>
  )
}

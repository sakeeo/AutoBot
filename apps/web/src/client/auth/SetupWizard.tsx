'use client'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { ConnStatus } from '@autobot/contracts/types'
import { id } from '../i18n/id'
import { installApi, postJson } from '../api-client'
import { QrImage } from '../ui/QrImage'
import { AuthLayout, ErrorLine, TextField, messageOf } from './parts'

installApi()

type Step = 'token' | 'phone' | 'whatsapp' | 'verify' | 'account' | 'authenticator' | 'recovery'
const ORDER: Step[] = ['token', 'phone', 'whatsapp', 'verify', 'account', 'authenticator', 'recovery']
const LABEL: Record<Step, string> = {
  token: 'Token', phone: 'Nomor pemilik', whatsapp: 'WhatsApp bot', verify: 'Verifikasi nomor',
  account: 'Akun', authenticator: 'Authenticator', recovery: 'Kode pemulihan'
}

interface State {
  progress: { ownerPhone: string | null; phoneVerified: boolean; hasAccount: boolean; totpVerified: boolean }
  wa: ConnStatus | { state: 'unknown' }
  botNumber: string | null
}

function Progress({ step }: { step: Step }) {
  const at = ORDER.indexOf(step)
  return (
    <ol className="list-inline small mb-3" aria-label="Langkah setup">
      {ORDER.slice(1).map((s, i) => (
        <li key={s} className={`list-inline-item ${ORDER.indexOf(s) === at ? 'fw-semibold' : ORDER.indexOf(s) < at ? 'text-success' : 'text-body-secondary'}`}
          aria-current={ORDER.indexOf(s) === at ? 'step' : undefined}>
          {i + 1}. {LABEL[s]}
        </li>
      ))}
    </ol>
  )
}

export function SetupWizard() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('token')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [state, setState] = useState<State | null>(null)
  const [token, setToken] = useState('')
  const [phone, setPhone] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [otpSentTo, setOtpSentTo] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [username, setUsername] = useState(''); const [password, setPassword] = useState(''); const [again, setAgain] = useState('')
  const [totp, setTotp] = useState<{ secret: string; uri: string } | null>(null)
  const [recovery, setRecovery] = useState<string[] | null>(null)
  const [saved, setSaved] = useState(false)
  const [qr, setQr] = useState<string | null>(null)

  /** Where the wizard stands on the server, so a closed tab can carry on where it left off. */
  const refresh = useCallback(async (): Promise<State | null> => {
    const r = await fetch('/api/setup/state', { credentials: 'same-origin', cache: 'no-store' })
    if (r.status === 404) { router.replace('/login'); return null }
    if (!r.ok) return null
    const s = (await r.json()) as State & { ok: boolean }
    setState(s)
    return s
  }, [router])

  useEffect(() => {
    fetch('/api/public/auth-status', { cache: 'no-store' }).then((r) => r.json()).then((a) => { if (a.setupComplete) router.replace('/login') }).catch(() => undefined)
    refresh().then((s) => {
      if (!s) return
      const p = s.progress
      setStep(!p.ownerPhone ? 'phone' : s.wa.state !== 'connected' ? 'whatsapp' : !p.phoneVerified ? 'verify' : !p.hasAccount ? 'account' : 'authenticator')
    })
  }, [refresh, router])

  // WhatsApp link: live status and QR while the wizard waits for the scan
  useEffect(() => {
    if (step !== 'whatsapp') return
    let live = true
    const apply = (s: ConnStatus): void => { if (live) { setState((o) => (o ? { ...o, wa: s } : o)); setQr(s.state === 'waiting_qr' && s.qr ? s.qr : null) } }
    window.api.getStatus().then(apply).catch(() => undefined)
    const off = window.api.onStatus(apply)
    return () => { live = false; off() }
  }, [step])
  useEffect(() => {
    if (step === 'whatsapp' && state?.wa.state === 'connected') refresh().then(() => setStep('verify'))
  }, [step, state?.wa.state, refresh])

  async function call<T>(path: string, body: unknown, ok: (d: any) => T | Promise<T>): Promise<T | undefined> {
    setError(null); setBusy(true)
    try {
      const r = await postJson(path, body)
      if (r.res.status === 401 && r.data?.code === 'SESSION_EXPIRED') { setStep('token'); setError(r.data.message); return undefined }
      if (!r.res.ok) { setError(messageOf(r.data)); return undefined }
      return await ok(r.data)
    } finally { setBusy(false) }
  }

  const submit = (e: FormEvent): void => {
    e.preventDefault()
    if (step === 'token') void call('/api/setup/token', { token }, async () => { setToken(''); const s = await refresh(); setStep(s?.progress.ownerPhone ? (s.wa.state !== 'connected' ? 'whatsapp' : 'verify') : 'phone') })
    else if (step === 'phone') void call('/api/setup/owner-phone', { phone }, async () => { await refresh(); setStep('whatsapp') })
    else if (step === 'verify') {
      if (!otpSentTo) void call('/api/setup/owner-otp/send', {}, (d) => setOtpSentTo(d.sentTo))
      else void call('/api/setup/owner-otp/verify', { code }, () => { setCode(''); setStep('account') })
    } else if (step === 'account') {
      if (password !== again) return setError('Konfirmasi password tidak sama.')
      void call('/api/setup/account', { username, password }, (d) => { setTotp({ secret: d.secret, uri: d.uri }); setPassword(''); setAgain(''); setStep('authenticator') })
    } else if (step === 'authenticator') void call('/api/setup/totp', { code }, (d) => { setRecovery(d.recoveryCodes); setCode(''); setStep('recovery') })
    else if (step === 'recovery') void call('/api/setup/finish', { savedRecoveryCodes: saved }, () => { router.replace('/'); router.refresh() })
  }

  const download = (): void => {
    const blob = new Blob([`Kode pemulihan AutoBot\nSimpan di tempat aman. Tiap kode hanya sekali pakai.\n\n${(recovery ?? []).join('\n')}\n`], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob); a.download = 'kode-pemulihan-autobot.txt'; a.click()
    URL.revokeObjectURL(a.href)
  }

  const titles: Record<Step, string> = {
    token: 'Setup AutoBot', phone: 'Nomor pemilik', whatsapp: 'Hubungkan WhatsApp bot', verify: 'Verifikasi nomor pemilik',
    account: 'Buat akun pemilik', authenticator: 'Aktifkan authenticator', recovery: 'Simpan kode pemulihan'
  }
  const subtitles: Record<Step, string> = {
    token: 'Masukkan token setup yang tercetak di log server (docker compose logs web). Token hanya diketahui orang yang memegang server.',
    phone: 'Nomor WhatsApp pribadi Anda. Kode verifikasi dan pemberitahuan keamanan dikirim ke sini. Harus berbeda dari nomor yang dipakai bot.',
    whatsapp: 'Tautkan nomor WhatsApp yang akan dipakai bot (lebih baik nomor khusus, bukan nomor pribadi).',
    verify: 'Bot mengirim kode 6 digit ke nomor pemilik. Ini membuktikan nomor itu milik Anda dan jalur kodenya berfungsi.',
    account: 'Username dan password untuk masuk ke panel. Setelah ini, panel hanya bisa dibuka dengan password dan kode authenticator.',
    authenticator: 'Pindai dengan aplikasi authenticator (Google Authenticator, Aegis, 1Password, dll.), lalu masukkan kode 6 digit.',
    recovery: 'Jika ponsel hilang, kode ini satu-satunya jalan masuk selain perintah di server. Simpan di tempat aman, terpisah dari ponsel.'
  }
  const canGo =
    step === 'token' ? !!token : step === 'phone' ? !!phone : step === 'verify' ? (otpSentTo ? !!code : true) :
    step === 'account' ? !!username && !!password : step === 'authenticator' ? !!code : step === 'recovery' ? saved : false

  return (
    <AuthLayout title={titles[step]} subtitle={subtitles[step]} wide>
      {step !== 'token' && <Progress step={step} />}
      <form onSubmit={submit}>
        <ErrorLine message={error} />

        {step === 'token' && <TextField id="token" label="Token setup" value={token} onChange={setToken} autoComplete="off" autoFocus />}

        {step === 'phone' && <TextField id="phone" label="Nomor WhatsApp pemilik" value={phone} onChange={setPhone} inputMode="numeric" autoFocus hint="Dengan kode negara, misalnya 62812xxxxxxx atau 0812xxxxxxx." />}

        {step === 'whatsapp' && (
          <div>
            <div className="alert alert-warning small">
              <i className="bi bi-exclamation-triangle me-2" aria-hidden="true" />{id.risk}
              <div className="form-check mt-2">
                <input className="form-check-input" type="checkbox" id="agree" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                <label className="form-check-label" htmlFor="agree">Saya mengerti risikonya dan memakai nomor yang siap menanggungnya</label>
              </div>
            </div>
            {qr && (
              <div className="text-center mb-3">
                <QrImage text={qr} alt="QR WhatsApp" size={260} />
                <p className="small text-body-secondary mt-2 mb-0">WhatsApp → Perangkat tertaut → Tautkan perangkat, lalu pindai kode ini.</p>
              </div>
            )}
            <p className="small mb-2">Status: <strong>{state && state.wa.state !== 'unknown' ? id.state[state.wa.state] : 'Memeriksa…'}</strong></p>
            <button type="button" className="btn btn-primary" disabled={!agreed || state?.wa.state === 'connecting' || state?.wa.state === 'waiting_qr'}
              onClick={() => { setError(null); window.api.connect().catch((e: Error) => setError(e.message)) }}>
              <i className="bi bi-link-45deg me-1" aria-hidden="true" />Hubungkan WhatsApp
            </button>
            {state?.botNumber && <p className="small text-body-secondary mt-2 mb-0">Terhubung sebagai {state.botNumber}.</p>}
          </div>
        )}

        {step === 'verify' && (
          <div>
            <p className="small">Nomor pemilik: <strong>{state?.progress.ownerPhone ?? '—'}</strong>{state?.botNumber && <> · nomor bot: <strong>{state.botNumber}</strong></>}</p>
            {otpSentTo ? (
              <>
                <p className="small text-body-secondary">Kode dikirim ke {otpSentTo}. Berlaku 5 menit. Pesan masuk dari nomor bot; jika tidak muncul, cek juga permintaan pesan di WhatsApp.</p>
                <TextField id="otp" label="Kode dari WhatsApp" value={code} onChange={setCode} inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={6} />
                <button type="button" className="btn btn-link btn-sm p-0 mb-3" disabled={busy}
                  onClick={() => void call('/api/setup/owner-otp/send', {}, (d) => setOtpSentTo(d.sentTo))}>Kirim ulang kode</button>
              </>
            ) : (
              <p className="small text-body-secondary">Tekan tombol untuk mengirim kode ke nomor pemilik.</p>
            )}
          </div>
        )}

        {step === 'account' && (
          <>
            <TextField id="username" label="Username" value={username} onChange={setUsername} autoComplete="username" autoFocus hint="3–32 karakter: huruf kecil, angka, titik, garis bawah atau strip." />
            <TextField id="password" label="Password" type="password" value={password} onChange={setPassword} autoComplete="new-password" hint="Minimal 12 karakter. Kalimat sandi yang panjang lebih baik daripada simbol acak." />
            <TextField id="password2" label="Ulangi password" type="password" value={again} onChange={setAgain} autoComplete="new-password" />
          </>
        )}

        {step === 'authenticator' && (
          <>
            {totp ? (
              <div className="text-center mb-3">
                <QrImage text={totp.uri} alt="Kode QR authenticator" />
                <p className="small mt-2 mb-0">Atau ketik kuncinya: <code className="user-select-all">{totp.secret}</code></p>
              </div>
            ) : (
              <div className="alert alert-info small">Kode QR hanya ditampilkan sekali. Jika aplikasi authenticator Anda sudah memilikinya, masukkan kodenya. Jika belum, <button type="button" className="btn btn-link btn-sm p-0 align-baseline" onClick={() => setStep('account')}>ulangi langkah akun</button> untuk kode QR baru.</div>
            )}
            <TextField id="totp" label="Kode 6 digit dari aplikasi" value={code} onChange={setCode} inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={6} />
          </>
        )}

        {step === 'recovery' && recovery && (
          <>
            <div className="alert alert-info" role="status">Kode ini hanya ditampilkan sekali.</div>
            <ul className="list-unstyled font-monospace row row-cols-2 g-1 mb-3" aria-label="Kode pemulihan">
              {recovery.map((c) => <li key={c} className="col">{c}</li>)}
            </ul>
            <div className="d-flex gap-2 mb-3">
              <button type="button" className="btn btn-outline-secondary btn-sm" onClick={download}><i className="bi bi-download me-1" aria-hidden="true" />Unduh .txt</button>
              <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => window.print()}><i className="bi bi-printer me-1" aria-hidden="true" />Cetak</button>
            </div>
            <div className="form-check mb-3">
              <input className="form-check-input" type="checkbox" id="saved" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
              <label className="form-check-label" htmlFor="saved">Saya sudah menyimpan kode pemulihan ini di tempat aman</label>
            </div>
          </>
        )}

        {step !== 'whatsapp' && (
          <button className="btn btn-primary w-100" disabled={busy || !canGo}>
            {step === 'token' ? 'Mulai' : step === 'verify' && !otpSentTo ? 'Kirim kode' : step === 'recovery' ? 'Selesai, buka panel' : 'Lanjut'}
          </button>
        )}
      </form>
    </AuthLayout>
  )
}

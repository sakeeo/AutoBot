'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState, type FormEvent } from 'react'
import { postJson } from '../api-client'
import { QrImage } from '../ui/QrImage'
import { AuthLayout, ErrorLine, TextField, messageOf } from './parts'

type Step = 'credentials' | 'totp' | 'recovery' | 'enroll'

export function LoginFlow() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('credentials')
  const [username, setUsername] = useState(''); const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [enroll, setEnroll] = useState<{ secret: string; uri: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // A panel that has no owner yet goes to the setup wizard instead.
  useEffect(() => {
    fetch('/api/public/auth-status', { cache: 'no-store' }).then((r) => r.json()).then((s) => { if (s.setupComplete === false) router.replace('/setup') }).catch(() => undefined)
  }, [router])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null); setBusy(true)
    try {
      if (step === 'credentials') {
        const r = await postJson('/api/auth/login', { username, password })
        if (!r.res.ok) return setError(messageOf(r.data))
        setPassword(''); setCode('')
        if (r.data.enroll) { setEnroll(r.data.enroll); setStep('enroll') } else setStep('totp')
      } else if (step === 'recovery') {
        const r = await postJson('/api/auth/recovery', { code })
        if (!r.res.ok) return setError(messageOf(r.data))
        router.replace('/login/authenticator')
      } else {
        const r = await postJson('/api/auth/totp', { code })
        if (!r.res.ok) {
          if (r.data?.code === 'SESSION_EXPIRED') { setStep('credentials'); setCode('') }
          return setError(messageOf(r.data))
        }
        router.replace('/'); router.refresh()
      }
    } finally {
      setBusy(false)
    }
  }

  const titles: Record<Step, string> = { credentials: 'Masuk', totp: 'Kode authenticator', recovery: 'Kode pemulihan', enroll: 'Daftarkan authenticator baru' }
  const subtitle: Record<Step, string> = {
    credentials: 'Masuk ke panel AutoBot.',
    totp: 'Buka aplikasi authenticator di ponsel Anda dan masukkan kode 6 digit.',
    recovery: 'Masukkan salah satu kode pemulihan yang Anda simpan saat setup. Tiap kode hanya sekali pakai.',
    enroll: 'Authenticator Anda direset. Pindai kode ini dengan aplikasi authenticator, lalu masukkan kode 6 digit untuk masuk.'
  }
  return (
    <AuthLayout title={titles[step]} subtitle={subtitle[step]}>
      <form onSubmit={submit}>
        <ErrorLine message={error} />
        {step === 'credentials' && (
          <>
            <TextField id="username" label="Username" value={username} onChange={setUsername} autoComplete="username" autoFocus />
            <TextField id="password" label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" />
          </>
        )}
        {step === 'enroll' && enroll && (
          <div className="mb-3 text-center">
            <QrImage text={enroll.uri} alt="Kode QR authenticator" />
            <p className="small mt-2 mb-0">Atau ketik kuncinya: <code className="user-select-all">{enroll.secret}</code></p>
          </div>
        )}
        {(step === 'totp' || step === 'enroll') && (
          <TextField id="code" label="Kode 6 digit" value={code} onChange={setCode} inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={6} />
        )}
        {step === 'recovery' && <TextField id="code" label="Kode pemulihan" value={code} onChange={setCode} autoComplete="off" autoFocus />}
        <button className="btn btn-primary w-100" disabled={busy || (step === 'credentials' ? !username || !password : !code)}>
          {step === 'credentials' ? 'Lanjut' : 'Masuk'}
        </button>
      </form>
      <div className="d-flex justify-content-between mt-3 small">
        {step === 'credentials' && <Link href="/login/lupa">Lupa password?</Link>}
        {step === 'totp' && <button type="button" className="btn btn-link btn-sm p-0" onClick={() => { setStep('recovery'); setCode(''); setError(null) }}>Pakai kode pemulihan</button>}
        {(step === 'recovery' || step === 'totp' || step === 'enroll') && <button type="button" className="btn btn-link btn-sm p-0" onClick={() => { setStep('credentials'); setCode(''); setError(null) }}>Kembali</button>}
      </div>
    </AuthLayout>
  )
}

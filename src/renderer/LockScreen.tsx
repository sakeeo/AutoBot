import { useState, type FormEvent } from 'react'
import { id } from './i18n/id'
import logoUrl from './assets/autobot-icon.svg'
import { Card } from './ui/Card'

const ERRORS = {
  bad: 'Username atau password salah.',
  throttled: 'Terlalu banyak percobaan. Tunggu 30 detik lalu coba lagi.',
  invalid: 'Password baru minimal 8 karakter.'
} as const

export function LockScreen({ onUnlocked }: { onUnlocked(): void }) {
  const [mode, setMode] = useState<'login' | 'reset'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [newCode, setNewCode] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function login(e: FormEvent): Promise<void> {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const r = await window.api.authLogin(username, password)
      if (r.ok) onUnlocked()
      else setError(ERRORS[r.error])
    } finally {
      setBusy(false)
    }
  }

  async function reset(e: FormEvent): Promise<void> {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const r = await window.api.authReset(code, password)
      if (r.ok) {
        setNewCode(r.recoveryCode ?? null)
        setPassword('')
      } else setError(r.error === 'bad' ? 'Kode pemulihan salah.' : ERRORS[r.error])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-screen">
      <Card aria-label="Login aplikasi" className="lock-card">
        <div className="p-2">
          <div className="login-brand">
            <img src={logoUrl} alt="" width={48} height={48} className="login-logo" />
            <h1 className="login-title">{id.appName}</h1>
            <p className="login-tagline">{id.tagline}</p>
          </div>

          {newCode ? (
            <>
              <div className="alert alert-success">Password diganti. Simpan kode pemulihan baru ini; kode lama tidak berlaku lagi.</div>
              <div className="alert alert-warning font-monospace fs-5 text-center user-select-all">{newCode}</div>
              <button type="button" className="btn btn-primary w-100"
                onClick={() => { setNewCode(null); setMode('login'); setCode('') }}>
                Kembali ke login
              </button>
            </>
          ) : mode === 'login' ? (
            <form onSubmit={login}>
              <div className="mb-3">
                <label htmlFor="lock-user" className="form-label">Username</label>
                <input id="lock-user" className="form-control" autoFocus autoComplete="username"
                  value={username} onChange={(e) => setUsername(e.target.value)} />
              </div>
              <div className="mb-3">
                <label htmlFor="lock-pass" className="form-label">Password</label>
                <input id="lock-pass" type="password" className="form-control" autoComplete="current-password"
                  value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              {error && <div className="alert alert-danger py-2" role="alert">{error}</div>}
              <button type="submit" className="btn btn-primary w-100" disabled={busy}>Masuk</button>
              <button type="button" className="btn btn-link w-100 mt-2"
                onClick={() => { setMode('reset'); setError(null); setPassword('') }}>
                Lupa password?
              </button>
            </form>
          ) : (
            <form onSubmit={reset}>
              <p className="small text-body-secondary">Masukkan kode pemulihan yang ditampilkan saat login dibuat.</p>
              <div className="mb-3">
                <label htmlFor="reset-code" className="form-label">Kode pemulihan</label>
                <input id="reset-code" className="form-control font-monospace" value={code}
                  onChange={(e) => setCode(e.target.value)} />
              </div>
              <div className="mb-3">
                <label htmlFor="reset-pass" className="form-label">Password baru</label>
                <input id="reset-pass" type="password" className="form-control" autoComplete="new-password"
                  value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              {error && <div className="alert alert-danger py-2" role="alert">{error}</div>}
              <button type="submit" className="btn btn-primary w-100" disabled={busy}>Reset password</button>
              <button type="button" className="btn btn-link w-100 mt-2"
                onClick={() => { setMode('login'); setError(null); setPassword('') }}>
                Kembali ke login
              </button>
            </form>
          )}
        </div>
      </Card>
    </div>
  )
}

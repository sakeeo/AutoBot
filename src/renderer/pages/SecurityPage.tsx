import { useState } from 'react'
import { useSettings } from '../useSettings'
import { useAuth } from '../auth-context'
import { Card } from '../ui/Card'
import { ConfirmButton } from '../ui/ConfirmButton'
import { PageHeader } from '../ui/PageHeader'

function GeneralSection() {
  const [settings, patch] = useSettings()
  if (!settings) return null
  return (
    <Card title="Umum" className="mb-3" aria-label="Umum">
      <div className="mb-3">
        <label htmlFor="theme" className="form-label">Tema</label>
        <select id="theme" className="form-select" value={settings.theme}
          onChange={(e) => patch({ theme: e.target.value as 'light' | 'dark' | 'auto' })}>
          <option value="auto">Otomatis</option>
          <option value="light">Terang</option>
          <option value="dark">Gelap</option>
        </select>
      </div>
      <div className="form-check form-switch mb-3">
        <input id="notify-incoming" type="checkbox" role="switch" className="form-check-input"
          checked={settings.notifyIncoming} onChange={(e) => patch({ notifyIncoming: e.target.checked })} />
        <label htmlFor="notify-incoming" className="form-check-label">Notifikasi pesan masuk</label>
        <div className="form-text">Menampilkan notifikasi desktop untuk setiap pesan baru. Saat aplikasi terkunci, isinya disamarkan.</div>
      </div>
      <div className="form-check form-switch">
        <input id="autostart" type="checkbox" role="switch" className="form-check-input"
          checked={settings.autoStart} onChange={(e) => patch({ autoStart: e.target.checked })} />
        <label htmlFor="autostart" className="form-check-label">Jalankan saat login</label>
      </div>
    </Card>
  )
}

const FAIL = {
  bad: 'Password salah.',
  throttled: 'Terlalu banyak percobaan. Tunggu 30 detik.',
  invalid: 'Password baru minimal 8 karakter.'
} as const
type Msg = { kind: 'success' | 'danger'; text: string } | null

function Notice({ msg }: { msg: Msg }) {
  return msg ? <div className={`alert alert-${msg.kind} py-2 mt-2`} role="alert">{msg.text}</div> : null
}

function LoginSection() {
  const { state, refresh } = useAuth()
  const [username, setUsername] = useState('')
  const [pass, setPass] = useState('')
  const [again, setAgain] = useState('')
  const [recovery, setRecovery] = useState<string | null>(null)
  const [setupMsg, setSetupMsg] = useState<Msg>(null)
  const [oldPass, setOldPass] = useState('')
  const [newPass, setNewPass] = useState('')
  const [changeMsg, setChangeMsg] = useState<Msg>(null)
  const [disablePass, setDisablePass] = useState('')
  const [disableMsg, setDisableMsg] = useState<Msg>(null)

  async function enable(): Promise<void> {
    setSetupMsg(null)
    if (!username.trim()) return setSetupMsg({ kind: 'danger', text: 'Username wajib diisi.' })
    if (pass.length < 8) return setSetupMsg({ kind: 'danger', text: 'Password minimal 8 karakter.' })
    if (pass !== again) return setSetupMsg({ kind: 'danger', text: 'Password tidak sama.' })
    const r = await window.api.authSetup(username, pass)
    if (!r.ok) return setSetupMsg({ kind: 'danger', text: 'Login tidak dapat diaktifkan. Periksa isian.' })
    setRecovery(r.recoveryCode)
    setPass(''); setAgain('')
    await refresh()
  }
  async function change(): Promise<void> {
    const r = await window.api.authChangePassword(oldPass, newPass)
    if (r.ok) { setChangeMsg({ kind: 'success', text: 'Password diganti.' }); setOldPass(''); setNewPass('') }
    else setChangeMsg({ kind: 'danger', text: FAIL[r.error] })
  }
  async function disable(): Promise<void> {
    const r = await window.api.authDisable(disablePass)
    if (r.ok) { setDisablePass(''); await refresh() }
    else setDisableMsg({ kind: 'danger', text: FAIL[r.error] })
  }

  return (
    <Card title="Login aplikasi" className="mb-3" aria-label="Login aplikasi">

      {recovery && (
        <div className="alert alert-warning">
          <strong>Simpan kode pemulihan ini sekarang.</strong> Kode ini satu-satunya cara mengatur ulang password dan
          tidak akan ditampilkan lagi.
          <div className="font-monospace fs-5 text-center my-2 user-select-all">{recovery}</div>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => setRecovery(null)}>
            Saya sudah menyimpannya
          </button>
        </div>
      )}

      {!state.enabled ? (
        <>
          <p className="text-body-secondary">Kunci aplikasi dengan username dan password. Saat ini login belum aktif.</p>
          <div className="mb-3">
            <label htmlFor="su-user" className="form-label">Username</label>
            <input id="su-user" className="form-control" autoComplete="off" value={username}
              onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div className="mb-3">
            <label htmlFor="su-pass" className="form-label">Password</label>
            <input id="su-pass" type="password" className="form-control" autoComplete="new-password" value={pass}
              onChange={(e) => setPass(e.target.value)} />
            <div className="form-text">Minimal 8 karakter.</div>
          </div>
          <div className="mb-3">
            <label htmlFor="su-again" className="form-label">Ulangi password</label>
            <input id="su-again" type="password" className="form-control" autoComplete="new-password" value={again}
              onChange={(e) => setAgain(e.target.value)} />
          </div>
          <button type="button" className="btn btn-primary" onClick={enable}>Aktifkan login</button>
          <Notice msg={setupMsg} />
        </>
      ) : (
        <>
          <p>Login aktif sebagai <strong>{state.username}</strong>.</p>
          <button type="button" className="btn btn-outline-secondary mb-4" onClick={async () => {
            await window.api.authLock()
            await refresh()
          }}>
            <i className="bi bi-lock me-1" />Kunci sekarang
          </button>

          <div className="mb-4">
            <label htmlFor="autolock" className="form-label">Kunci otomatis setelah (menit, 0 = mati)</label>
            <input id="autolock" type="number" className="form-control" min={0} max={240}
              key={state.autoLockMin} defaultValue={state.autoLockMin} style={{ maxWidth: 160 }}
              onBlur={async (e) => {
                const v = Math.max(0, Math.min(240, Math.round(Number(e.target.value) || 0)))
                await window.api.authSetAutoLock(v)
                await refresh()
              }} />
          </div>

          <h4 className="h6">Ganti password</h4>
          <div className="mb-2">
            <label htmlFor="old-pass" className="form-label">Password lama</label>
            <input id="old-pass" type="password" className="form-control" value={oldPass}
              onChange={(e) => setOldPass(e.target.value)} />
          </div>
          <div className="mb-2">
            <label htmlFor="new-pass" className="form-label">Password baru</label>
            <input id="new-pass" type="password" className="form-control" value={newPass}
              onChange={(e) => setNewPass(e.target.value)} />
          </div>
          <button type="button" className="btn btn-outline-primary" onClick={change}>Ganti password</button>
          <Notice msg={changeMsg} />

          <h4 className="h6 mt-4">Nonaktifkan login</h4>
          <div className="mb-2">
            <label htmlFor="dis-pass" className="form-label">Password untuk menonaktifkan</label>
            <input id="dis-pass" type="password" className="form-control" value={disablePass}
              onChange={(e) => setDisablePass(e.target.value)} />
          </div>
          <ConfirmButton label="Nonaktifkan login" confirmLabel="Ya, nonaktifkan" className="btn btn-outline-danger"
            onConfirm={disable} />
          <Notice msg={disableMsg} />
        </>
      )}

      <p className="small text-body-secondary mt-3 mb-0">
        <i className="bi bi-info-circle me-1" />
        Login hanya mengunci tampilan aplikasi, bukan mengenkripsi data di komputer ini. Bot tetap berjalan saat
        aplikasi terkunci.
      </p>
    </Card>
  )
}

export function SecurityPage() {
  return (
    <div>
      <PageHeader icon="bi-shield-lock" title="Keamanan & Umum" subtitle="Login aplikasi, tema, dan pengaturan umum." />
      <LoginSection />
      <GeneralSection />
    </div>
  )
}

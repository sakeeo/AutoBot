'use client'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { postJson } from '../api-client'
import { useSettings } from '../settings-context'
import { Card } from '../ui/Card'
import { ConfirmButton } from '../ui/ConfirmButton'
import { PageHeader } from '../ui/PageHeader'
import { QrImage } from '../ui/QrImage'
import { StatusBadge } from '../ui/StatusBadge'

interface Device { id: string; createdAt: number; lastSeenAt: number; userAgent: string | null; current: boolean }
type Note = { kind: 'success' | 'danger'; text: string } | null

const getJson = async (path: string): Promise<{ ok: boolean; data: any }> => {
  const r = await fetch(path, { credentials: 'same-origin', cache: 'no-store' })
  return { ok: r.ok, data: await r.json().catch(() => null) }
}
const when = (ms: number): string => new Date(ms).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })

function Notice({ note }: { note: Note }) {
  return note ? <div className={`alert alert-${note.kind} py-2`} role={note.kind === 'danger' ? 'alert' : 'status'}>{note.text}</div> : null
}

/** A text field with a visible label. */
function Field(p: { id: string; label: string; type?: string; value: string; onChange(v: string): void; autoComplete?: string; hint?: string; inputMode?: 'numeric' | 'text' }) {
  return (
    <div className="mb-3">
      <label htmlFor={p.id} className="form-label">{p.label}</label>
      <input id={p.id} className="form-control" type={p.type ?? 'text'} value={p.value} autoComplete={p.autoComplete}
        inputMode={p.inputMode} onChange={(e) => p.onChange(e.target.value)} />
      {p.hint && <div className="form-text">{p.hint}</div>}
    </div>
  )
}

function Devices() {
  const router = useRouter()
  const [devices, setDevices] = useState<Device[]>([])
  const [note, setNote] = useState<Note>(null)
  const load = useCallback(() => { getJson('/api/auth/devices').then((r) => r.ok && setDevices(r.data.devices)).catch(() => undefined) }, [])
  useEffect(load, [load])
  async function revoke(id: string) {
    const r = await postJson('/api/auth/devices/revoke', { id })
    setNote(r.res.ok ? { kind: 'success', text: 'Perangkat dikeluarkan.' } : { kind: 'danger', text: r.data?.message ?? 'Gagal mengeluarkan perangkat.' })
    load()
  }
  async function all() {
    await postJson('/api/auth/logout-all', {})
    router.replace('/login')
  }
  return (
    <Card title="Perangkat yang sedang masuk" icon="bi-laptop" className="mb-3">
      <Notice note={note} />
      <ul className="list-group list-group-flush mb-3">
        {devices.map((d) => (
          <li key={d.id} className="list-group-item px-0 d-flex flex-wrap justify-content-between align-items-center gap-2">
            <span>
              <span className="d-block text-break">{d.userAgent ?? 'Perangkat tidak dikenal'}</span>
              <small className="text-body-secondary">Masuk {when(d.createdAt)} · aktif terakhir {when(d.lastSeenAt)}</small>
            </span>
            {d.current ? <StatusBadge tone="success">Perangkat ini</StatusBadge> : (
              <ConfirmButton label="Keluarkan" confirmLabel="Keluarkan" ariaLabel="keluarkan perangkat ini" onConfirm={() => revoke(d.id)} />
            )}
          </li>
        ))}
      </ul>
      <ConfirmButton label="Keluar dari semua perangkat" confirmLabel="Ya, keluar semua" className="btn btn-outline-danger" onConfirm={all}>
        <i className="bi bi-box-arrow-right me-1" aria-hidden="true" />Keluar dari semua perangkat
      </ConfirmButton>
    </Card>
  )
}

function ChangePassword() {
  const router = useRouter()
  const [oldPassword, setOld] = useState(''); const [totp, setTotp] = useState('')
  const [newPassword, setNew] = useState(''); const [again, setAgain] = useState('')
  const [note, setNote] = useState<Note>(null)
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (newPassword !== again) return setNote({ kind: 'danger', text: 'Konfirmasi password baru tidak sama.' })
    const r = await postJson('/api/auth/password', { oldPassword, totp, newPassword })
    if (r.res.ok) {
      setNote({ kind: 'success', text: 'Password diganti. Perangkat lain sudah dikeluarkan.' })
      setOld(''); setTotp(''); setNew(''); setAgain('')
      router.refresh()
    } else setNote({ kind: 'danger', text: r.data?.message ?? 'Gagal mengganti password.' })
  }
  return (
    <Card title="Ganti password" icon="bi-key" className="mb-3">
      <form onSubmit={submit} style={{ maxWidth: 420 }}>
        <Notice note={note} />
        <Field id="pw-old" label="Password saat ini" type="password" autoComplete="current-password" value={oldPassword} onChange={setOld} />
        <Field id="pw-totp" label="Kode authenticator" inputMode="numeric" autoComplete="one-time-code" value={totp} onChange={setTotp} />
        <Field id="pw-new" label="Password baru" type="password" autoComplete="new-password" hint="Minimal 12 karakter. Kalimat sandi yang panjang lebih baik daripada simbol acak." value={newPassword} onChange={setNew} />
        <Field id="pw-again" label="Ulangi password baru" type="password" autoComplete="new-password" value={again} onChange={setAgain} />
        <button className="btn btn-primary" disabled={!oldPassword || !totp || !newPassword}>Ganti password</button>
      </form>
    </Card>
  )
}

function Recovery({ warn }: { warn: boolean }) {
  const [password, setPassword] = useState(''); const [totp, setTotp] = useState('')
  const [codes, setCodes] = useState<string[] | null>(null)
  const [note, setNote] = useState<Note>(null)
  async function submit(e: FormEvent) {
    e.preventDefault()
    const r = await postJson('/api/auth/recovery-codes', { password, totp })
    if (r.res.ok) { setCodes(r.data.recoveryCodes); setNote(null); setPassword(''); setTotp('') }
    else setNote({ kind: 'danger', text: r.data?.message ?? 'Gagal membuat kode pemulihan.' })
  }
  return (
    <Card title="Kode pemulihan" icon="bi-life-preserver" className="mb-3">
      {warn && <div className="alert alert-warning py-2" role="status">Kode pemulihan Anda tinggal sedikit. Buat yang baru.</div>}
      <p className="small text-body-secondary">Kode ini menggantikan kode authenticator saat Anda kehilangan ponsel, dan sekali pakai. Simpan seperti password. Membuat ulang mematikan semua kode lama.</p>
      {codes ? (
        <div>
          <div className="alert alert-info" role="status">Simpan sekarang. Kode ini tidak akan ditampilkan lagi.</div>
          <ul className="list-unstyled font-monospace row row-cols-2 g-1 mb-3" aria-label="Kode pemulihan baru">
            {codes.map((c) => <li key={c} className="col">{c}</li>)}
          </ul>
          <button className="btn btn-outline-secondary" onClick={() => setCodes(null)}>Sudah saya simpan</button>
        </div>
      ) : (
        <form onSubmit={submit} style={{ maxWidth: 420 }}>
          <Notice note={note} />
          <Field id="rc-pw" label="Password" type="password" autoComplete="current-password" value={password} onChange={setPassword} />
          <Field id="rc-totp" label="Kode authenticator" inputMode="numeric" autoComplete="one-time-code" value={totp} onChange={setTotp} />
          <button className="btn btn-primary" disabled={!password || !totp}>Buat ulang kode pemulihan</button>
        </form>
      )}
    </Card>
  )
}

function Authenticator() {
  const [password, setPassword] = useState(''); const [totp, setTotp] = useState('')
  const [enroll, setEnroll] = useState<{ secret: string; uri: string } | null>(null)
  const [code, setCode] = useState('')
  const [note, setNote] = useState<Note>(null)
  async function start(e: FormEvent) {
    e.preventDefault()
    const r = await postJson('/api/auth/totp/enroll', { password, totp })
    if (r.res.ok) { setEnroll({ secret: r.data.secret, uri: r.data.uri }); setNote(null); setPassword(''); setTotp('') }
    else setNote({ kind: 'danger', text: r.data?.message ?? 'Gagal memulai.' })
  }
  async function confirm(e: FormEvent) {
    e.preventDefault()
    const r = await postJson('/api/auth/totp/enroll/confirm', { code })
    if (r.res.ok) { setEnroll(null); setCode(''); setNote({ kind: 'success', text: 'Authenticator baru aktif. Yang lama tidak berlaku lagi.' }) }
    else setNote({ kind: 'danger', text: r.data?.message ?? 'Kode salah.' })
  }
  return (
    <Card title="Authenticator" icon="bi-phone" className="mb-3">
      <Notice note={note} />
      {enroll ? (
        <form onSubmit={confirm} style={{ maxWidth: 420 }}>
          <p className="small">Pindai kode ini dengan aplikasi authenticator, lalu masukkan kode 6 digit yang muncul.</p>
          <QrImage text={enroll.uri} alt="Kode QR authenticator" />
          <p className="small mt-2">Atau ketik kuncinya: <code className="user-select-all">{enroll.secret}</code></p>
          <Field id="en-code" label="Kode dari aplikasi" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={setCode} />
          <button className="btn btn-primary" disabled={!code}>Aktifkan</button>
        </form>
      ) : (
        <form onSubmit={start} style={{ maxWidth: 420 }}>
          <p className="small text-body-secondary">Ganti ponsel atau aplikasi? Daftarkan authenticator baru. Yang lama berhenti berlaku.</p>
          <Field id="en-pw" label="Password" type="password" autoComplete="current-password" value={password} onChange={setPassword} />
          <Field id="en-totp" label="Kode authenticator saat ini" inputMode="numeric" autoComplete="one-time-code" value={totp} onChange={setTotp} />
          <button className="btn btn-outline-primary" disabled={!password || !totp}>Daftarkan authenticator baru</button>
        </form>
      )}
    </Card>
  )
}

function OwnerPhone({ current }: { current: string | null }) {
  const [password, setPassword] = useState(''); const [totp, setTotp] = useState('')
  const [phone, setPhone] = useState(''); const [code, setCode] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [note, setNote] = useState<Note>(null)
  async function start(e: FormEvent) {
    e.preventDefault()
    const r = await postJson('/api/auth/phone/start', { password, totp, newPhone: phone })
    if (r.res.ok) { setSentTo(r.data.sentTo); setNote(null); setPassword(''); setTotp('') }
    else setNote({ kind: 'danger', text: r.data?.message ?? 'Gagal mengirim kode.' })
  }
  async function confirm(e: FormEvent) {
    e.preventDefault()
    const r = await postJson('/api/auth/phone/confirm', { code })
    if (r.res.ok) { setSentTo(null); setCode(''); setPhone(''); setNote({ kind: 'success', text: 'Nomor pemilik diganti. Nomor lama diberi tahu lewat WhatsApp.' }) }
    else setNote({ kind: 'danger', text: r.data?.message ?? 'Kode salah.' })
  }
  return (
    <Card title="Nomor pemilik" icon="bi-whatsapp" className="mb-3">
      <p className="small text-body-secondary">Kode verifikasi (setup dan lupa password) dikirim ke nomor ini{current ? <>: <strong>{current}</strong></> : ''}. Harus berbeda dari nomor WhatsApp bot.</p>
      <Notice note={note} />
      {sentTo ? (
        <form onSubmit={confirm} style={{ maxWidth: 420 }}>
          <p className="small">Kode dikirim ke {sentTo}.</p>
          <Field id="ph-code" label="Kode dari WhatsApp" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={setCode} />
          <button className="btn btn-primary" disabled={!code}>Konfirmasi nomor baru</button>
        </form>
      ) : (
        <form onSubmit={start} style={{ maxWidth: 420 }}>
          <Field id="ph-new" label="Nomor baru" inputMode="numeric" hint="Dengan kode negara, misalnya 62812xxxxxxx." value={phone} onChange={setPhone} />
          <Field id="ph-pw" label="Password" type="password" autoComplete="current-password" value={password} onChange={setPassword} />
          <Field id="ph-totp" label="Kode authenticator" inputMode="numeric" autoComplete="one-time-code" value={totp} onChange={setTotp} />
          <button className="btn btn-outline-primary" disabled={!phone || !password || !totp}>Kirim kode ke nomor baru</button>
        </form>
      )}
    </Card>
  )
}

function Appearance() {
  const [settings, patch] = useSettings()
  if (!settings) return null
  return (
    <Card title="Tampilan" icon="bi-circle-half" className="mb-3">
      <label htmlFor="theme" className="form-label">Tema</label>
      <select id="theme" className="form-select" style={{ maxWidth: 260 }} value={settings.theme}
        onChange={(e) => patch({ theme: e.target.value as 'light' | 'dark' | 'auto' })}>
        <option value="auto">Ikuti sistem</option>
        <option value="light">Terang</option>
        <option value="dark">Gelap</option>
      </select>
    </Card>
  )
}

function Notifications() {
  const [settings, patch] = useSettings()
  const [perm, setPerm] = useState<string>(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)
  if (!settings) return null
  return (
    <Card title="Notifikasi di browser" icon="bi-bell" className="mb-3">
      <div className="form-check form-switch mb-2">
        <input className="form-check-input" type="checkbox" role="switch" id="notify" checked={settings.notifyIncoming}
          onChange={(e) => patch({ notifyIncoming: e.target.checked })} />
        <label className="form-check-label" htmlFor="notify">Beri tahu setiap pesan pelanggan yang masuk</label>
      </div>
      {perm === 'unsupported' && <p className="small text-body-secondary mb-0">Browser ini tidak mendukung notifikasi.</p>}
      {perm === 'denied' && <p className="small text-body-secondary mb-0">Notifikasi diblokir di pengaturan browser untuk situs ini.</p>}
      {perm === 'default' && (
        <button className="btn btn-sm btn-outline-secondary" onClick={() => Notification.requestPermission().then(setPerm)}>Izinkan notifikasi</button>
      )}
      {perm === 'granted' && <StatusBadge tone="success">Diizinkan</StatusBadge>}
    </Card>
  )
}

export function SecurityPage() {
  const [info, setInfo] = useState<{ ownerPhone: string | null; recoveryWarning: boolean; username: string | null } | null>(null)
  useEffect(() => { getJson('/api/auth/session').then((r) => r.ok && setInfo(r.data)).catch(() => undefined) }, [])
  return (
    <div>
      <PageHeader icon="bi-shield-lock" title="Keamanan & Umum" subtitle={info?.username ? `Masuk sebagai ${info.username}.` : 'Akun, perangkat, dan verifikasi.'} />
      <Devices />
      <ChangePassword />
      <Recovery warn={!!info?.recoveryWarning} />
      <Authenticator />
      <OwnerPhone current={info?.ownerPhone ?? null} />
      <Appearance />
      <Notifications />
    </div>
  )
}

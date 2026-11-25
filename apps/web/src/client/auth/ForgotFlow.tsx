'use client'
import Link from 'next/link'
import { useState, type FormEvent } from 'react'
import { postJson } from '../api-client'
import { AuthLayout, ErrorLine, TextField, messageOf } from './parts'

type Step = 'ask' | 'code' | 'new' | 'done'

export function ForgotFlow() {
  const [step, setStep] = useState<Step>('ask')
  const [username, setUsername] = useState(''); const [code, setCode] = useState('')
  const [useRecovery, setUseRecovery] = useState(false)
  const [pw, setPw] = useState(''); const [again, setAgain] = useState('')
  const [info, setInfo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null); setBusy(true)
    try {
      if (step === 'ask') {
        const r = await postJson('/api/auth/forgot', { username })
        if (!r.res.ok) return setError(messageOf(r.data))
        setInfo(r.data.message); setStep('code')
      } else if (step === 'code') {
        const r = await postJson('/api/auth/forgot/verify', useRecovery ? { recoveryCode: code } : { code })
        if (!r.res.ok) return setError(messageOf(r.data))
        setStep('new')
      } else if (step === 'new') {
        if (pw !== again) return setError('Konfirmasi password tidak sama.')
        const r = await postJson('/api/auth/forgot/reset', { newPassword: pw })
        if (!r.res.ok) {
          if (r.data?.code === 'SESSION_EXPIRED') { setStep('ask'); setPw(''); setAgain('') }
          return setError(messageOf(r.data))
        }
        setPw(''); setAgain(''); setStep('done')
      }
    } finally {
      setBusy(false)
    }
  }

  if (step === 'done')
    return (
      <AuthLayout title="Password diganti">
        <div className="alert alert-success" role="status">Password baru sudah aktif dan semua perangkat dikeluarkan. Masuk dengan password baru; kode authenticator tetap diminta.</div>
        <Link className="btn btn-primary w-100" href="/login">Ke halaman masuk</Link>
      </AuthLayout>
    )
  return (
    <AuthLayout title="Lupa password" subtitle={step === 'ask' ? 'Kami kirim kode verifikasi ke WhatsApp pemilik.' : step === 'code' ? undefined : 'Pilih password baru.'}>
      <form onSubmit={submit}>
        {info && step === 'code' && <div className="alert alert-info py-2" role="status">{info}</div>}
        <ErrorLine message={error} />
        {step === 'ask' && <TextField id="username" label="Username" value={username} onChange={setUsername} autoComplete="username" autoFocus />}
        {step === 'code' && (
          <>
            <TextField id="code" label={useRecovery ? 'Kode pemulihan' : 'Kode dari WhatsApp'} value={code} onChange={setCode}
              inputMode={useRecovery ? 'text' : 'numeric'} autoComplete="one-time-code" autoFocus />
            <button type="button" className="btn btn-link btn-sm p-0 mb-3" onClick={() => { setUseRecovery(!useRecovery); setCode(''); setError(null) }}>
              {useRecovery ? 'Pakai kode dari WhatsApp' : 'WhatsApp tidak bisa dipakai? Pakai kode pemulihan'}
            </button>
          </>
        )}
        {step === 'new' && (
          <>
            <TextField id="new-pw" label="Password baru" type="password" value={pw} onChange={setPw} autoComplete="new-password" autoFocus hint="Minimal 12 karakter." />
            <TextField id="new-pw2" label="Ulangi password baru" type="password" value={again} onChange={setAgain} autoComplete="new-password" />
          </>
        )}
        <button className="btn btn-primary w-100" disabled={busy || (step === 'ask' ? !username : step === 'code' ? !code : !pw)}>
          {step === 'ask' ? 'Kirim kode' : step === 'code' ? 'Verifikasi' : 'Ganti password'}
        </button>
      </form>
      <div className="mt-3 small"><Link href="/login">Kembali ke halaman masuk</Link></div>
    </AuthLayout>
  )
}

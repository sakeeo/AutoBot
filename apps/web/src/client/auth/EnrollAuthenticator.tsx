'use client'
import { useRouter } from 'next/navigation'
import { useEffect, useState, type FormEvent } from 'react'
import { postJson } from '../api-client'
import { QrImage } from '../ui/QrImage'
import { AuthLayout, ErrorLine, TextField, messageOf } from './parts'

/** After signing in with a recovery code, the only thing left to do is to set up a new authenticator. */
export function EnrollAuthenticator() {
  const router = useRouter()
  const [enroll, setEnroll] = useState<{ secret: string; uri: string } | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    postJson('/api/auth/totp/enroll', {}).then((r) => {
      if (r.res.status === 401) router.replace('/login')
      else if (r.res.ok) setEnroll({ secret: r.data.secret, uri: r.data.uri })
      else setError(messageOf(r.data))
    })
  }, [router])

  async function submit(e: FormEvent) {
    e.preventDefault()
    const r = await postJson('/api/auth/totp/enroll/confirm', { code })
    if (!r.res.ok) return setError(messageOf(r.data))
    router.replace('/'); router.refresh()
  }
  return (
    <AuthLayout title="Daftarkan authenticator baru" subtitle="Anda masuk dengan kode pemulihan. Daftarkan authenticator baru dulu sebelum memakai panel.">
      <form onSubmit={submit}>
        <ErrorLine message={error} />
        {enroll && (
          <>
            <div className="mb-3 text-center">
              <QrImage text={enroll.uri} alt="Kode QR authenticator" />
              <p className="small mt-2 mb-0">Atau ketik kuncinya: <code className="user-select-all">{enroll.secret}</code></p>
            </div>
            <TextField id="code" label="Kode 6 digit" value={code} onChange={setCode} inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={6} />
            <button className="btn btn-primary w-100" disabled={!code}>Aktifkan dan masuk</button>
          </>
        )}
      </form>
    </AuthLayout>
  )
}

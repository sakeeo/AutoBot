'use client'
import { useEffect, useRef, useState } from 'react'
import { registerPasswordPrompt } from '../api-client'

/**
 * Asks for the password again before a risky action (switching the bot, connecting WhatsApp, saving an API key...).
 * The api client calls it when the server says STEP_UP_REQUIRED, and carries on with the action once it is answered.
 */
export function StepUpDialog() {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const resolver = useRef<((v: string | null) => void) | null>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    registerPasswordPrompt(() => new Promise<string | null>((resolve) => { resolver.current = resolve; setValue(''); setOpen(true) }))
    return () => registerPasswordPrompt(null)
  }, [])
  useEffect(() => { if (open) input.current?.focus() }, [open])

  function done(v: string | null): void {
    setOpen(false)
    resolver.current?.(v)
    resolver.current = null
  }
  if (!open) return null
  return (
    <div className="app-backdrop" role="presentation" style={{ display: 'grid', placeItems: 'center' }}>
      <form role="dialog" aria-modal="true" aria-labelledby="stepup-title" className="card p-4" style={{ maxWidth: 420, width: '92%' }}
        onSubmit={(e) => { e.preventDefault(); if (value) done(value) }}
        onKeyDown={(e) => { if (e.key === 'Escape') done(null) }}>
        <h2 id="stepup-title" className="h6 mb-2">Masukkan password Anda</h2>
        <p className="small text-body-secondary">Tindakan ini mengubah hal penting. Konfirmasi dulu bahwa ini memang Anda.</p>
        <label htmlFor="stepup-pw" className="form-label">Password</label>
        <input id="stepup-pw" ref={input} type="password" autoComplete="current-password" className="form-control mb-3"
          value={value} onChange={(e) => setValue(e.target.value)} />
        <div className="d-flex gap-2 justify-content-end">
          <button type="button" className="btn btn-outline-secondary" onClick={() => done(null)}>Batal</button>
          <button type="submit" className="btn btn-primary" disabled={!value}>Lanjutkan</button>
        </div>
      </form>
    </div>
  )
}

'use client'
import type { ReactNode } from 'react'

/** The centred card every sign-in screen sits in. */
export function AuthLayout({ title, subtitle, children, wide }: { title: string; subtitle?: string; children: ReactNode; wide?: boolean }) {
  return (
    <main className="d-flex align-items-center justify-content-center min-vh-100 p-3">
      <div className="card shadow-sm w-100" style={{ maxWidth: wide ? 640 : 440 }}>
        <div className="card-body p-4">
          <div className="d-flex align-items-center gap-2 mb-3">
            <img src="/icon.svg" alt="" width={32} height={32} />
            <span className="fw-semibold">AutoBot</span>
          </div>
          <h1 className="h4 mb-1">{title}</h1>
          {subtitle && <p className="text-body-secondary small">{subtitle}</p>}
          {children}
        </div>
      </div>
    </main>
  )
}

export function TextField(p: {
  id: string; label: string; value: string; onChange(v: string): void; type?: string; autoComplete?: string
  inputMode?: 'numeric' | 'text'; hint?: string; autoFocus?: boolean; maxLength?: number
}) {
  return (
    <div className="mb-3">
      <label htmlFor={p.id} className="form-label">{p.label}</label>
      <input id={p.id} className="form-control" type={p.type ?? 'text'} value={p.value} autoComplete={p.autoComplete}
        inputMode={p.inputMode} autoFocus={p.autoFocus} maxLength={p.maxLength} onChange={(e) => p.onChange(e.target.value)} />
      {p.hint && <div className="form-text">{p.hint}</div>}
    </div>
  )
}

export function ErrorLine({ message }: { message: string | null }) {
  return message ? <div className="alert alert-danger py-2" role="alert">{message}</div> : null
}

/** What to tell the person for a failed request. A throttle says how long to wait. */
export function messageOf(data: { message?: string; retryAfterSec?: number } | null, fallback = 'Terjadi kesalahan. Coba lagi.'): string {
  if (!data?.message) return fallback
  return data.retryAfterSec ? `${data.message} Coba lagi dalam ${data.retryAfterSec} detik.` : data.message
}

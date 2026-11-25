import type { ReactNode } from 'react'

export function LoadingState({ label = 'Memuat…' }: { label?: string }) {
  return (
    <div role="status" className="state-box text-body-secondary">
      <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />
      {label}
    </div>
  )
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="state-box state-empty">
      <i className="bi bi-inbox" aria-hidden="true" />
      <div className="fw-semibold">{title}</div>
      {hint && <div className="text-body-secondary">{hint}</div>}
      {action}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="alert alert-danger d-flex align-items-center gap-3 mb-0">
      <i className="bi bi-exclamation-circle" aria-hidden="true" />
      <span className="flex-grow-1">{message}</span>
      {onRetry && <button type="button" className="btn btn-sm btn-outline-danger" onClick={onRetry}>Coba lagi</button>}
    </div>
  )
}

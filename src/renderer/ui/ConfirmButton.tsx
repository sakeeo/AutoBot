import { useEffect, useRef, useState, type ReactNode } from 'react'

interface Props {
  label: string
  onConfirm(): void
  confirmLabel?: string
  ariaLabel?: string
  className?: string
  disabled?: boolean
  children?: ReactNode
}

/** Two-step destructive action (design-guide §9): the first click only asks; "Batal" or Escape backs out. */
export function ConfirmButton({ label, onConfirm, confirmLabel = 'Hapus', ariaLabel, className, disabled, children }: Props) {
  const [asking, setAsking] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const refocus = useRef(false)

  useEffect(() => {
    if (!asking && refocus.current) {
      refocus.current = false
      trigger.current?.focus()
    }
  }, [asking])
  useEffect(() => {
    if (!asking) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { refocus.current = true; setAsking(false) }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [asking])

  if (!asking)
    return (
      <button type="button" ref={trigger} className={className ?? 'btn btn-sm btn-outline-danger'} disabled={disabled}
        aria-label={ariaLabel} onClick={() => setAsking(true)}>
        {children ?? label}
      </button>
    )
  return (
    <span className="confirm-inline" role="group" aria-label="Konfirmasi">
      <span className="confirm-text">Yakin?</span>
      <button type="button" className="btn btn-sm btn-danger" autoFocus aria-label={ariaLabel ? `Ya, ${ariaLabel}` : undefined}
        onClick={() => { setAsking(false); onConfirm() }}>
        {confirmLabel}
      </button>
      <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => { refocus.current = true; setAsking(false) }}>
        Batal
      </button>
    </span>
  )
}

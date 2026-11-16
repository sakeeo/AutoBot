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

/**
 * Two-step destructive action (design-guide §9): the first click only asks; "Batal" or Escape backs out.
 * The question is a popover anchored to the trigger, which keeps its footprint, so it never overflows narrow cells.
 */
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

  const cls = className ?? 'btn btn-sm btn-outline-danger'
  return (
    <span className={`confirm-wrap${cls.includes('w-100') ? ' w-100' : ''}`}>
      <button type="button" ref={trigger} className={asking ? `${cls} confirm-ghost` : cls} disabled={disabled}
        aria-label={ariaLabel} aria-hidden={asking ? true : undefined} tabIndex={asking ? -1 : undefined}
        onClick={() => setAsking(true)}>
        {children ?? label}
      </button>
      {asking && (
        <span className="confirm-pop" role="group" aria-label="Konfirmasi">
          <span className="confirm-text">Yakin?</span>
          <button type="button" className="btn btn-sm btn-danger" autoFocus aria-label={ariaLabel ? `Ya, ${ariaLabel}` : undefined}
            onClick={() => { refocus.current = true; setAsking(false); onConfirm() }}>
            {confirmLabel}
          </button>
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => { refocus.current = true; setAsking(false) }}>
            Batal
          </button>
        </span>
      )}
    </span>
  )
}

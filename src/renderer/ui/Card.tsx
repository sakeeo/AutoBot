import type { ReactNode } from 'react'

export function Card({ title, icon, actions, children, className, ...rest }: {
  title?: string
  /** Optional Bootstrap icon class shown before the title, e.g. "bi-activity". */
  icon?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
  'aria-label'?: string
}) {
  const label = rest['aria-label'] ?? title
  return (
    <section className={`card${className ? ` ${className}` : ''}`} aria-label={label}>
      {(title || actions) && (
        <div className="card-header d-flex align-items-center justify-content-between gap-2">
          {title ? <h3 className="card-title">{icon && <i className={`bi ${icon} card-icon`} aria-hidden="true" />}{title}</h3> : <span />}
          {actions}
        </div>
      )}
      <div className="card-body">{children}</div>
    </section>
  )
}

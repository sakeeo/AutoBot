import type { ReactNode } from 'react'

export function Card({ title, actions, children, className, ...rest }: {
  title?: string
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
          <span>{title}</span>
          {actions}
        </div>
      )}
      <div className="card-body">{children}</div>
    </section>
  )
}

import type { ReactNode } from 'react'

export function PageHeader({ icon, title, subtitle, actions }: { icon?: string; title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h2 className="page-title">
          {icon && <i className={`bi ${icon}`} aria-hidden="true" />}
          {title}
        </h2>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  )
}

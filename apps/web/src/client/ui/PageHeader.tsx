import type { ReactNode } from 'react'

/** Page title, subtitle and actions (Figma: a plain 28 px title, no icon). `icon` is kept for callers but not drawn. */
export function PageHeader({ title, subtitle, actions }: { icon?: string; title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  )
}

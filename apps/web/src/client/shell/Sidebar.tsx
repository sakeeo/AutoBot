'use client'
import Link from 'next/link'
import { id } from '../i18n/id'
import { SIDEBAR_ITEMS, type NavKey } from '../nav'

/** Desktop sidebar (Figma): brand, then one flat list of pages. Phones use the bottom bar instead. */
export function Sidebar({ page }: { page: NavKey }) {
  return (
    <nav className="app-sidebar" aria-label="Menu utama">
      <div className="sidebar-brand">
        <span className="sidebar-name">{id.appName}</span>
        <span className="sidebar-tagline">{id.tagline}</span>
      </div>
      <ul className="sidebar-list">
        {SIDEBAR_ITEMS.map((p) => (
          <li key={p.key}>
            <Link href={p.href} className="sidebar-link" aria-current={p.key === page ? 'page' : undefined}>{p.label}</Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

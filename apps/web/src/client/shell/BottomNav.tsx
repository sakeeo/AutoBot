'use client'
import Link from 'next/link'
import { BOTTOM_ITEMS, bottomKeyOf, type NavKey } from '../nav'

const SHORT: Partial<Record<NavKey, string>> = { dashboard: 'Beranda', test: 'Uji' }

/** Phone navigation (Figma M11–M22): Beranda, Pesan, Uji, Lainnya. */
export function BottomNav({ page }: { page: NavKey }) {
  const lit = bottomKeyOf(page)
  return (
    <nav className="app-bottomnav" aria-label="Menu utama">
      {BOTTOM_ITEMS.map((p) => (
        <Link key={p.key} href={p.href} className="bottomnav-link" aria-current={p.key === lit ? 'page' : undefined}>
          <i className={`bi ${p.icon}`} aria-hidden="true" />
          <span>{SHORT[p.key] ?? p.label}</span>
        </Link>
      ))}
    </nav>
  )
}

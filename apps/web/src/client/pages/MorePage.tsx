'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { SETTINGS_ITEMS } from '../nav'
import { PageHeader } from '../ui/PageHeader'

/** "Lainnya" on a phone (Figma M15): every settings page, then sign out. */
export function MorePage() {
  const router = useRouter()
  return (
    <div>
      <PageHeader title="Lainnya" />
      <ul className="more-list">
        {SETTINGS_ITEMS.map((p) => (
          <li key={p.key}>
            <Link href={p.href} className="more-item">
              <span><strong>{p.label}</strong>{p.hint && <small>{p.hint}</small>}</span>
              <i className="bi bi-chevron-right" aria-hidden="true" />
            </Link>
          </li>
        ))}
        <li>
          <button type="button" className="more-item more-danger" onClick={async () => {
            await fetch('/api/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', credentials: 'same-origin' })
            router.replace('/login')
          }}>
            <span><strong>Keluar</strong></span>
            <i className="bi bi-chevron-right" aria-hidden="true" />
          </button>
        </li>
      </ul>
    </div>
  )
}

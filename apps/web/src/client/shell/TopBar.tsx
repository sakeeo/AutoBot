'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, type RefObject } from 'react'
import type { ConnStatus } from '@autobot/contracts/types'
import { id } from '../i18n/id'
import { useSettings } from '../settings-context'
import { useEffectiveTheme } from '../theme'
import { Breadcrumb } from './Breadcrumb'

const TONE: Record<ConnStatus['state'], string> = {
  disconnected: 'text-bg-secondary',
  connecting: 'text-bg-warning',
  waiting_qr: 'text-bg-warning',
  connected: 'text-bg-success'
}
const POLL_MS = 15_000

interface Props {
  crumbs: string[]
  showMenuButton: boolean
  onMenu(): void
  menuRef: RefObject<HTMLButtonElement | null>
  username: string
}

export function TopBar({ crumbs, showMenuButton, onMenu, menuRef, username }: Props) {
  const router = useRouter()
  const [settings, patchSettings] = useSettings()
  const shown = useEffectiveTheme(settings?.theme ?? 'light')
  const [status, setStatus] = useState<ConnStatus['state']>('disconnected')
  const [waiting, setWaiting] = useState(0)
  const [profileOpen, setProfileOpen] = useState(false)
  const profileRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let live = true
    window.api.getStatus().then((s) => live && setStatus(s.state))
    const off = window.api.onStatus((s) => setStatus(s.state))
    const poll = (): void => {
      window.api.getDashboard().then((d) => live && setWaiting(d.waitingAdmin)).catch(() => undefined)
    }
    poll()
    const timer = window.setInterval(poll, POLL_MS)
    return () => {
      live = false
      off()
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    if (!profileOpen) return
    const close = (e: Event): void => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !profileRef.current?.contains(e.target as Node)) setProfileOpen(false)
    }
    document.addEventListener('keydown', close)
    document.addEventListener('mousedown', close)
    return () => {
      document.removeEventListener('keydown', close)
      document.removeEventListener('mousedown', close)
    }
  }, [profileOpen])

  const bellLabel = waiting > 0 ? `Notifikasi: ${waiting} chat menunggu admin` : 'Tidak ada notifikasi'
  return (
    <header className="app-topbar">
      {showMenuButton && (
        <button type="button" ref={menuRef} className="topbar-btn" aria-label="Buka menu" onClick={onMenu}>
          <i className="bi bi-list" aria-hidden="true" />
        </button>
      )}
      <Breadcrumb crumbs={crumbs} />
      <div className="spacer" />
      <span className={`badge ${TONE[status]}`}><i className="bi bi-whatsapp me-1" aria-hidden="true" />{id.state[status]}</span>
      <Link href="/pesan" className="topbar-btn" aria-label={bellLabel}>
        <i className="bi bi-bell" aria-hidden="true" />
        {waiting > 0 && <span className="topbar-count" aria-hidden="true">{waiting}</span>}
      </Link>
      {settings && (() => {
        const dark = shown === 'dark'
        return (
          <button type="button" className="topbar-btn" aria-label={dark ? 'Beralih ke mode terang' : 'Beralih ke mode gelap'}
            onClick={() => patchSettings({ theme: dark ? 'light' : 'dark' })}>
            <i className={`bi ${dark ? 'bi-sun' : 'bi-moon'}`} aria-hidden="true" />
          </button>
        )
      })()}
      <div className="profile-wrap" ref={profileRef}>
        <button type="button" className="topbar-btn" aria-label="Menu profil" aria-haspopup="menu" aria-expanded={profileOpen}
          onClick={() => setProfileOpen((o) => !o)}>
          <i className="bi bi-person-circle" aria-hidden="true" />
        </button>
        {profileOpen && (
          <div className="profile-menu" role="menu">
            <div className="who">{username}</div>
            <button type="button" role="menuitem" onClick={() => { setProfileOpen(false); router.push('/pengaturan/keamanan') }}>
              <i className="bi bi-shield-lock" aria-hidden="true" />{id.nav.security}
            </button>
            <button type="button" role="menuitem" onClick={async () => {
              setProfileOpen(false)
              await fetch('/api/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', credentials: 'same-origin' })
              router.replace('/login')
            }}>
              <i className="bi bi-box-arrow-right" aria-hidden="true" />Keluar
            </button>
          </div>
        )}
      </div>
    </header>
  )
}

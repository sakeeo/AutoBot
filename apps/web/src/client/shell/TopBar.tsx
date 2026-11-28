'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import type { ConnStatus } from '@autobot/contracts/types'
import { id } from '../i18n/id'
import { useSettings } from '../settings-context'
import { useEffectiveTheme } from '../theme'
import { groupOf, labelOf, type NavKey } from '../nav'

/** The bot pill (Figma topbar): what a customer gets right now. */
function botPill(state: ConnStatus['state'], enabled: boolean | null): { text: string; tone: 'success' | 'warning' | 'danger' } {
  if (state !== 'connected') return { text: `Bot: WA ${id.state[state].toLowerCase()}`, tone: state === 'disconnected' ? 'danger' : 'warning' }
  return enabled ? { text: 'Bot: aktif membalas', tone: 'success' } : { text: 'Bot: nonaktif', tone: 'warning' }
}
const POLL_MS = 15_000

interface Props {
  page: NavKey
  narrow: boolean
  username: string
}

export function TopBar({ page, narrow, username }: Props) {
  const router = useRouter()
  const [settings, patchSettings] = useSettings()
  const shown = useEffectiveTheme(settings?.theme ?? 'light')
  const [status, setStatus] = useState<ConnStatus['state']>('disconnected')
  const [reachable, setReachable] = useState(true)
  const [botOn, setBotOn] = useState<boolean | null>(null)
  const [waiting, setWaiting] = useState(0)
  const [profileOpen, setProfileOpen] = useState(false)
  const profileRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let live = true
    const off = window.api.onStatus((s) => setStatus(s.state))
    const poll = (): void => {
      window.api.getStatus().then((s) => { if (live) { setStatus(s.state); setReachable(true) } }).catch(() => live && setReachable(false))
      window.api.getBotEnabled?.().then((on) => live && setBotOn(on)).catch(() => undefined)
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
  const bot = botPill(status, botOn)
  const sub = groupOf(page) === 'settings'
  return (
    <header className="app-topbar">
      {narrow && (
        <div className="topbar-title">
          {sub && (
            <button type="button" className="topbar-btn" aria-label="Kembali ke Lainnya" onClick={() => router.push('/lainnya')}>
              <i className="bi bi-chevron-left" aria-hidden="true" />
            </button>
          )}
          <span>{page === 'dashboard' ? 'Beranda' : labelOf(page)}</span>
        </div>
      )}
      <div className="spacer" />
      {narrow ? (
        <span className={`topbar-dot is-${bot.tone}`} title={bot.text}><span className="visually-hidden">{bot.text}</span>Bot</span>
      ) : (
        <>
          <span className={`topbar-pill is-${reachable ? 'success' : 'danger'}`}>{reachable ? 'Panel aktif' : 'Server bot tidak terjangkau'}</span>
          <span className={`topbar-pill is-${bot.tone}`}>{bot.text}</span>
        </>
      )}
      {!narrow && <Link href="/pesan" className="topbar-btn" aria-label={bellLabel}>
        <i className="bi bi-bell" aria-hidden="true" />
        {waiting > 0 && <span className="topbar-count" aria-hidden="true">{waiting}</span>}
      </Link>}
      {settings && (() => {
        const dark = shown === 'dark'
        return (
          <button type="button" className="topbar-btn" aria-label={dark ? 'Beralih ke mode terang' : 'Beralih ke mode gelap'}
            onClick={() => patchSettings({ theme: dark ? 'light' : 'dark' })}>
            <i className={`bi ${dark ? 'bi-sun' : 'bi-moon'}`} aria-hidden="true" />
          </button>
        )
      })()}
      {!narrow && <div className="profile-wrap" ref={profileRef}>
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
      </div>}
    </header>
  )
}

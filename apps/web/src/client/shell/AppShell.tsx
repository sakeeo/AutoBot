'use client'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import { SettingsProvider, useSettings } from '../settings-context'
import { applyTheme } from '../theme'
import { keyOfPath } from '../nav'
import { attentionNotification, incomingNotification } from '../notify'
import { installApi, SESSION_EXPIRED_EVENT } from '../api-client'
import { Sidebar } from './Sidebar'
import { useNarrow } from '../useNarrow'
import { BottomNav } from './BottomNav'
import { TopBar } from './TopBar'
import { StepUpDialog } from './StepUpDialog'

installApi() // before any page below runs its first effect

const SESSION_CHECK_MS = 60_000
const WARN_BEFORE_MS = 10 * 60_000

/** Sends the person to the login page the moment the session is gone, and warns before the 12-hour limit. */
function useSessionWatch(): { endsSoonAt: number | null } {
  const router = useRouter()
  const [endsSoonAt, setEndsSoonAt] = useState<number | null>(null)
  useEffect(() => {
    const out = (): void => router.replace('/login')
    window.addEventListener(SESSION_EXPIRED_EVENT, out)
    let live = true
    const check = async (): Promise<void> => {
      try {
        const r = await fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' })
        if (r.status === 401) return out()
        const d = await r.json()
        if (live && typeof d.expiresAt === 'number') setEndsSoonAt(d.expiresAt - Date.now() < WARN_BEFORE_MS ? d.expiresAt : null)
      } catch { /* offline for a moment: the next check tries again */ }
    }
    const timer = window.setInterval(check, SESSION_CHECK_MS)
    return () => { live = false; window.removeEventListener(SESSION_EXPIRED_EVENT, out); window.clearInterval(timer) }
  }, [router])
  return { endsSoonAt }
}

/** Shows a browser notification for new customer messages and chats that need a person, when the tab is in the background. */
function useBrowserNotifications(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || typeof Notification === 'undefined') return
    const show = (n: { title: string; body: string } | null): void => {
      if (n && Notification.permission === 'granted' && document.hidden) new Notification(n.title, { body: n.body })
    }
    const offs = [
      window.api.onMessage((m) => show(incomingNotification(m, { enabled: true, now: Date.now() }))),
      window.api.onEscalate((e) => show(attentionNotification('escalate', e))),
      window.api.onHandoff((e) => show(attentionNotification('handoff', e)))
    ]
    return () => offs.forEach((off) => off())
  }, [enabled])
}

function Shell({ username, children }: { username: string; children: ReactNode }) {
  const pathname = usePathname()
  const page = keyOfPath(pathname)
  const [settings] = useSettings()
  const narrow = useNarrow()
  const { endsSoonAt } = useSessionWatch()
  useBrowserNotifications(!!settings?.notifyIncoming)

  useEffect(() => {
    if (!settings) return
    applyTheme(settings.theme)
    if (settings.theme !== 'auto') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const on = (): void => applyTheme('auto')
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [settings])

  return (
    <div className={`app-shell${narrow ? ' is-narrow' : ''}`}>
      {!narrow && <Sidebar page={page} />}
      <div className="app-main">
        <TopBar page={page} narrow={narrow} username={username} />
        {endsSoonAt && (
          <div className="announcement-banner" role="alert">
            <i className="bi bi-hourglass-split" aria-hidden="true" />
            <span className="text">Sesi Anda berakhir sekitar pukul {new Date(endsSoonAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}. Simpan pekerjaan Anda, lalu masuk lagi.</span>
          </div>
        )}
        <main className="app-content">{children}</main>
      </div>
      {narrow && <BottomNav page={page} />}
      <StepUpDialog />
    </div>
  )
}

export function AppShell({ username, children }: { username: string; children: ReactNode }) {
  return (
    <SettingsProvider>
      <Shell username={username}>{children}</Shell>
    </SettingsProvider>
  )
}

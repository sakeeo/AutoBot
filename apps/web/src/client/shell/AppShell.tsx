'use client'
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { SettingsProvider, useSettings } from '../settings-context'
import { applyTheme } from '../theme'
import { crumbsOf, groupOf, keyOfPath } from '../nav'
import { attentionNotification, incomingNotification } from '../notify'
import { installApi, SESSION_EXPIRED_EVENT } from '../api-client'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { StepUpDialog } from './StepUpDialog'

installApi() // before any page below runs its first effect

const SESSION_CHECK_MS = 60_000
const WARN_BEFORE_MS = 10 * 60_000

/** True below the desktop breakpoint, where the sidebar becomes a drawer. Starts false so the server and the browser agree. */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 991.98px)')
    const on = (): void => setNarrow(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return narrow
}

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
  const [settingsOpen, setSettingsOpen] = useState(groupOf(page) === 'settings')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [settings] = useSettings()
  const narrow = useNarrow()
  const menuRef = useRef<HTMLButtonElement>(null)
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

  const closeDrawer = useCallback(() => setDrawerOpen(false), [])
  // The page behind a modal drawer is inert, so focus goes back to the menu button only after it re-enables.
  const wasOpen = useRef(false)
  useEffect(() => {
    if (wasOpen.current && !drawerOpen) menuRef.current?.focus()
    wasOpen.current = drawerOpen
  }, [drawerOpen])
  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') closeDrawer() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [drawerOpen, closeDrawer])
  useEffect(() => { if (!narrow) setDrawerOpen(false) }, [narrow])
  useEffect(() => { if (groupOf(page) === 'settings') setSettingsOpen(true) }, [page])

  const sidebar = (drawer: boolean) => (
    <Sidebar page={page} onNavigate={drawer ? closeDrawer : undefined} settingsOpen={settingsOpen}
      onToggleSettings={() => setSettingsOpen((o) => !o)} drawer={drawer} />
  )
  return (
    <div className="app-shell">
      {!narrow && sidebar(false)}
      {narrow && drawerOpen && (
        <>
          <div className="app-backdrop" data-testid="drawer-backdrop" onClick={closeDrawer} />
          {sidebar(true)}
        </>
      )}
      <div className="app-main" inert={drawerOpen}>
        <TopBar crumbs={crumbsOf(page)} showMenuButton={narrow} onMenu={() => setDrawerOpen(true)} menuRef={menuRef} username={username} />
        {endsSoonAt && (
          <div className="announcement-banner" role="alert">
            <i className="bi bi-hourglass-split" aria-hidden="true" />
            <span className="text">Sesi Anda berakhir sekitar pukul {new Date(endsSoonAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}. Simpan pekerjaan Anda, lalu masuk lagi.</span>
          </div>
        )}
        <main className="app-content">{children}</main>
      </div>
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

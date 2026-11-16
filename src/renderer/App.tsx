import { useCallback, useEffect, useRef, useState } from 'react'
import { SettingsProvider, useSettings } from './settings-context'
import { applyTheme } from './theme'
import { SETTINGS_ITEMS, TOP_ITEMS, crumbsOf, groupOf, type NavKey } from './nav'
import { Sidebar } from './shell/Sidebar'
import { TopBar } from './shell/TopBar'
import { LockScreen } from './LockScreen'
import { AuthContext, useAuth } from './auth-context'
import { useIdleLock } from './useIdleLock'
import type { AuthState } from '../shared/ipc'

/** Gate: nothing but the lock screen loads while the app is locked. */
export function App() {
  const [auth, setAuth] = useState<AuthState | null>(null)
  const refresh = useCallback(async () => setAuth(await window.api.authState()), [])
  useEffect(() => { refresh() }, [refresh])
  useEffect(() => {
    // Main tells us the moment it locks (e.g. window hidden to the tray); focus is a backup check.
    const off = window.api.onAuthLocked(() => { refresh() })
    window.addEventListener('focus', refresh)
    return () => {
      off()
      window.removeEventListener('focus', refresh)
    }
  }, [refresh])
  useEffect(() => {
    // The main process refuses data calls with LOCKED when the lock engaged behind the UI's back.
    const onReject = (e: Event): void => {
      const reason = (e as PromiseRejectionEvent).reason
      if (String(reason?.message ?? reason).includes('LOCKED')) {
        e.preventDefault()
        refresh()
      }
    }
    window.addEventListener('unhandledrejection', onReject)
    return () => window.removeEventListener('unhandledrejection', onReject)
  }, [refresh])

  if (!auth) return null
  if (auth.enabled && auth.locked) return <LockScreen onUnlocked={refresh} />
  return (
    <AuthContext.Provider value={{ state: auth, refresh }}>
      <SettingsProvider>
        <Shell />
      </SettingsProvider>
    </AuthContext.Provider>
  )
}

/** True below the desktop breakpoint, where the sidebar becomes a drawer (design-guide §4.3). */
function useNarrow(): boolean {
  const query = '(max-width: 991.98px)'
  const [narrow, setNarrow] = useState(() => !!window.matchMedia?.(query).matches)
  useEffect(() => {
    const mq = window.matchMedia?.(query)
    if (!mq) return
    const on = (): void => setNarrow(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return narrow
}

function Shell() {
  const { state, refresh } = useAuth()
  useIdleLock(state.enabled ? state.autoLockMin : 0, () => {
    window.api.authLock().then(refresh)
  })
  const [page, setPage] = useState<NavKey>('dashboard')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [settings] = useSettings()
  const narrow = useNarrow()
  const menuRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!settings) return
    applyTheme(settings.theme)
    if (settings.theme !== 'auto') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const on = () => applyTheme('auto')
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [settings?.theme])

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

  const select = (k: NavKey): void => {
    setPage(k)
    if (groupOf(k) === 'settings') setSettingsOpen(true)
    if (drawerOpen) closeDrawer()
  }
  const current = [...TOP_ITEMS, ...SETTINGS_ITEMS].find((p) => p.key === page)!
  const sidebar = (drawer: boolean) => (
    <Sidebar page={page} onSelect={select} settingsOpen={settingsOpen}
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
        <TopBar crumbs={crumbsOf(page)} showMenuButton={narrow} onMenu={() => setDrawerOpen(true)} menuRef={menuRef}
          onGoDashboard={() => select('dashboard')} onGoSecurity={() => select('security')} />
        <main className="app-content">{current.view}</main>
      </div>
    </div>
  )
}

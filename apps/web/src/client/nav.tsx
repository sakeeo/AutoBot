import { id } from './i18n/id'

export type NavKey = 'dashboard' | 'messages' | 'test' | 'log' | 'connector' | 'knowledge' | 'brand' | 'security'
export interface NavItem { key: NavKey; icon: string; label: string; href: string }

/** Menu items that sit outside the Pengaturan group. */
export const TOP_ITEMS: NavItem[] = [
  { key: 'dashboard', icon: 'bi-speedometer2', label: id.nav.dashboard, href: '/' },
  { key: 'messages', icon: 'bi-chat-left-text', label: id.nav.messages, href: '/pesan' },
  { key: 'test', icon: 'bi-chat-dots', label: id.nav.test, href: '/uji' },
  { key: 'log', icon: 'bi-journal-text', label: id.nav.log, href: '/log' }
]

export const SETTINGS_ITEMS: NavItem[] = [
  { key: 'connector', icon: 'bi-plug', label: id.nav.connector, href: '/pengaturan/connector' },
  { key: 'knowledge', icon: 'bi-folder2-open', label: id.nav.knowledge, href: '/pengaturan/pengetahuan' },
  { key: 'brand', icon: 'bi-bullseye', label: id.nav.brand, href: '/pengaturan/brand' },
  { key: 'security', icon: 'bi-shield-lock', label: id.nav.security, href: '/pengaturan/keamanan' }
]

const ALL = [...TOP_ITEMS, ...SETTINGS_ITEMS]

export function groupOf(key: NavKey): 'settings' | 'top' {
  return SETTINGS_ITEMS.some((i) => i.key === key) ? 'settings' : 'top'
}

/** The menu entry a URL path belongs to (the dashboard for anything unknown). */
export function keyOfPath(pathname: string): NavKey {
  const hit = ALL.filter((i) => i.href !== '/').find((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))
  return hit?.key ?? 'dashboard'
}

/** Breadcrumb trail for a page: settings pages sit under "Pengaturan". */
export function crumbsOf(key: NavKey): string[] {
  const item = ALL.find((i) => i.key === key)!
  return groupOf(key) === 'settings' ? [id.nav.settings, item.label] : [item.label]
}

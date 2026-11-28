import { id } from './i18n/id'

export type NavKey = 'dashboard' | 'messages' | 'test' | 'log' | 'knowledge' | 'brand' | 'connector' | 'ai' | 'security' | 'more'
export interface NavItem { key: NavKey; icon: string; label: string; href: string; hint?: string }

/** The pages reached from the bottom bar on a phone; everything else sits under "Lainnya". */
export const TOP_ITEMS: NavItem[] = [
  { key: 'dashboard', icon: 'bi-house', label: id.nav.dashboard, href: '/' },
  { key: 'messages', icon: 'bi-chat-left-text', label: id.nav.messages, href: '/pesan' },
  { key: 'test', icon: 'bi-chat-dots', label: id.nav.test, href: '/uji' }
]

/** Settings and reference pages: in the sidebar on a desktop, in the "Lainnya" list on a phone. */
export const SETTINGS_ITEMS: NavItem[] = [
  { key: 'log', icon: 'bi-journal-text', label: id.nav.log, href: '/log', hint: 'Balasan bot dan alasannya' },
  { key: 'knowledge', icon: 'bi-folder2-open', label: id.nav.knowledge, href: '/pengaturan/pengetahuan', hint: 'Dokumen dan Google Sheets' },
  { key: 'brand', icon: 'bi-bullseye', label: id.nav.brand, href: '/pengaturan/brand', hint: 'Identitas dan tujuan' },
  { key: 'connector', icon: 'bi-plug', label: id.nav.connector, href: '/pengaturan/connector', hint: 'WhatsApp dan status bot' },
  { key: 'ai', icon: 'bi-stars', label: id.nav.ai, href: '/pengaturan/ai', hint: 'Penyedia dan model' },
  { key: 'security', icon: 'bi-shield-lock', label: id.nav.security, href: '/pengaturan/keamanan', hint: 'Password, TOTP, sesi' }
]

/** Desktop sidebar order (Figma): one flat list. */
export const SIDEBAR_ITEMS: NavItem[] = [...TOP_ITEMS, ...SETTINGS_ITEMS]

const MORE: NavItem = { key: 'more', icon: 'bi-grid', label: id.nav.more, href: '/lainnya' }
const ALL = [...SIDEBAR_ITEMS, MORE]

/** Bottom bar on a phone: three main pages and "Lainnya". */
export const BOTTOM_ITEMS: NavItem[] = [...TOP_ITEMS, MORE]

export function groupOf(key: NavKey): 'settings' | 'top' {
  return SETTINGS_ITEMS.some((i) => i.key === key) ? 'settings' : 'top'
}

/** The menu entry a URL path belongs to (the dashboard for anything unknown). */
export function keyOfPath(pathname: string): NavKey {
  const hit = ALL.filter((i) => i.href !== '/').find((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))
  return hit?.key ?? 'dashboard'
}

export function labelOf(key: NavKey): string {
  return ALL.find((i) => i.key === key)!.label
}

/** Which bottom-bar tab is lit for a page: settings pages count as "Lainnya". */
export function bottomKeyOf(key: NavKey): NavKey {
  return groupOf(key) === 'settings' ? 'more' : key
}

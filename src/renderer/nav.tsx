import type { JSX } from 'react'
import { id } from './i18n/id'
import { DashboardPage } from './pages/DashboardPage'
import { TestPanel } from './pages/TestPanel'
import { LogPage } from './pages/LogPage'
import { ConnectorPage } from './pages/ConnectorPage'
import { KnowledgePage } from './pages/KnowledgePage'
import { BrandPage } from './pages/BrandPage'
import { SecurityPage } from './pages/SecurityPage'

export type NavKey = 'dashboard' | 'test' | 'log' | 'connector' | 'knowledge' | 'brand' | 'security'
export interface NavItem { key: NavKey; icon: string; label: string; view: JSX.Element }

/** Menu items that sit outside the Pengaturan group. */
export const TOP_ITEMS: NavItem[] = [
  { key: 'dashboard', icon: 'bi-speedometer2', label: id.nav.dashboard, view: <DashboardPage /> },
  { key: 'test', icon: 'bi-chat-dots', label: id.nav.test, view: <TestPanel /> },
  { key: 'log', icon: 'bi-journal-text', label: id.nav.log, view: <LogPage /> }
]

export const SETTINGS_ITEMS: NavItem[] = [
  { key: 'connector', icon: 'bi-plug', label: id.nav.connector, view: <ConnectorPage /> },
  { key: 'knowledge', icon: 'bi-folder2-open', label: id.nav.knowledge, view: <KnowledgePage /> },
  { key: 'brand', icon: 'bi-bullseye', label: id.nav.brand, view: <BrandPage /> },
  { key: 'security', icon: 'bi-shield-lock', label: id.nav.security, view: <SecurityPage /> }
]

export function groupOf(key: NavKey): 'settings' | 'top' {
  return SETTINGS_ITEMS.some((i) => i.key === key) ? 'settings' : 'top'
}

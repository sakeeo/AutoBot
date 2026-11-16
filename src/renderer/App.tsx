import { useEffect, useState } from 'react'
import { useSettings } from './useSettings'
import { applyTheme } from './theme'
import { id } from './i18n/id'
import { ConnectionPage } from './pages/ConnectionPage'
import { KnowledgePage } from './pages/KnowledgePage'
import { TestPanel } from './pages/TestPanel'
import { RulesPage } from './pages/RulesPage'
import { AiSettings } from './pages/AiSettings'
import { LogPage } from './pages/LogPage'

const PAGES = [
  { key: 'connection', icon: 'bi-whatsapp', label: id.nav.connection, view: <ConnectionPage /> },
  { key: 'knowledge', icon: 'bi-folder2-open', label: id.nav.knowledge, view: <KnowledgePage /> },
  { key: 'test', icon: 'bi-chat-dots', label: id.nav.test, view: <TestPanel /> },
  { key: 'rules', icon: 'bi-sliders', label: id.nav.rules, view: <RulesPage /> },
  { key: 'ai', icon: 'bi-stars', label: id.nav.ai, view: <AiSettings /> },
  { key: 'log', icon: 'bi-journal-text', label: id.nav.log, view: <LogPage /> }
] as const

export function App() {
  const [page, setPage] = useState<(typeof PAGES)[number]['key']>('connection')
  const [settings, patch] = useSettings()

  useEffect(() => {
    if (!settings) return
    applyTheme(settings.theme)
    if (settings.theme !== 'auto') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const on = () => applyTheme('auto')
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [settings?.theme])

  const current = PAGES.find((p) => p.key === page)!
  return (
    <div className="d-flex vh-100">
      <nav className="d-flex flex-column p-3 border-end bg-body-tertiary" style={{ width: 220 }}>
        <div className="fs-5 fw-semibold mb-3"><i className="bi bi-robot me-2" />{id.appName}</div>
        <ul className="nav nav-pills flex-column mb-auto">
          {PAGES.map((p) => (
            <li key={p.key} className="nav-item">
              <button className={`nav-link w-100 text-start ${p.key === page ? 'active' : ''}`}
                onClick={() => setPage(p.key)}>
                <i className={`bi ${p.icon} me-2`} />{p.label}
              </button>
            </li>
          ))}
        </ul>
        <label htmlFor="theme" className="form-label small mt-3 mb-1">Tema</label>
        <select id="theme" className="form-select form-select-sm" value={settings?.theme ?? 'auto'}
          onChange={(e) => patch({ theme: e.target.value as 'light' | 'dark' | 'auto' })}>
          <option value="auto">Otomatis</option>
          <option value="light">Terang</option>
          <option value="dark">Gelap</option>
        </select>
      </nav>
      <main className="flex-grow-1 p-4 overflow-auto">{current.view}</main>
    </div>
  )
}

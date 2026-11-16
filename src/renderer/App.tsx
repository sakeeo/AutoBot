import { useEffect, useState } from 'react'
import { useSettings } from './useSettings'
import { applyTheme } from './theme'
import { id } from './i18n/id'
import { SETTINGS_ITEMS, TOP_ITEMS, type NavKey } from './nav'

export function App() {
  const [page, setPage] = useState<NavKey>('dashboard')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settings] = useSettings()

  useEffect(() => {
    if (!settings) return
    applyTheme(settings.theme)
    if (settings.theme !== 'auto') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const on = () => applyTheme('auto')
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [settings?.theme])

  const current = [...TOP_ITEMS, ...SETTINGS_ITEMS].find((p) => p.key === page)!
  return (
    <div className="d-flex vh-100">
      <nav className="d-flex flex-column p-3 border-end bg-body-tertiary" style={{ width: 220 }}>
        <div className="fs-5 fw-semibold mb-3"><i className="bi bi-robot me-2" />{id.appName}</div>
        <ul className="nav nav-pills flex-column mb-auto">
          {TOP_ITEMS.map((p) => (
            <li key={p.key} className="nav-item">
              <button className={`nav-link w-100 text-start ${p.key === page ? 'active' : ''}`}
                onClick={() => setPage(p.key)}>
                <i className={`bi ${p.icon} me-2`} />{p.label}
              </button>
            </li>
          ))}
          <li className="nav-item">
            <button className="nav-link w-100 text-start d-flex align-items-center" aria-expanded={settingsOpen}
              onClick={() => setSettingsOpen((o) => !o)}>
              <i className="bi bi-gear me-2" />{id.nav.settings}
              <i className={`bi ms-auto ${settingsOpen ? 'bi-chevron-up' : 'bi-chevron-down'}`} />
            </button>
            {settingsOpen && (
              <ul className="nav nav-pills flex-column ms-3 mt-1">
                {SETTINGS_ITEMS.map((p) => (
                  <li key={p.key} className="nav-item">
                    <button className={`nav-link w-100 text-start ${p.key === page ? 'active' : ''}`}
                      onClick={() => setPage(p.key)}>
                      <i className={`bi ${p.icon} me-2`} />{p.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        </ul>
      </nav>
      <main className="flex-grow-1 p-4 overflow-auto">{current.view}</main>
    </div>
  )
}

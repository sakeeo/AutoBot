import { useEffect, useState } from 'react'
import { id } from '../i18n/id'

/** The window has no system frame, so this strip is its title bar: drag to move, double-click to maximise. */
export function TitleBar() {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    const api = window.api
    let live = true
    Promise.resolve()
      .then(() => api?.winIsMaximized?.())
      .then((m) => { if (live && typeof m === 'boolean') setMaximized(m) })
      .catch(() => undefined)
    const off = api?.onWinMaximized?.(setMaximized)
    return () => { live = false; off?.() }
  }, [])

  const run = (fn?: () => Promise<void>) => () => { fn?.()?.catch?.(() => undefined) }
  return (
    <div className="app-titlebar" onDoubleClick={run(window.api?.winToggleMaximize)}>
      <div className="titlebar-title"><i className="bi bi-robot" aria-hidden="true" />{id.appName}</div>
      <div className="titlebar-spacer" />
      <div className="titlebar-controls" onDoubleClick={(e) => e.stopPropagation()}>
        <button type="button" className="titlebar-btn" aria-label="Minimalkan" onClick={run(window.api?.winMinimize)}>
          <i className="bi bi-dash-lg" aria-hidden="true" />
        </button>
        <button type="button" className="titlebar-btn" aria-label={maximized ? 'Pulihkan' : 'Maksimalkan'}
          onClick={run(window.api?.winToggleMaximize)}>
          <i className={`bi ${maximized ? 'bi-fullscreen-exit' : 'bi-square'}`} aria-hidden="true" />
        </button>
        <button type="button" className="titlebar-btn is-close" aria-label="Tutup" onClick={run(window.api?.winClose)}>
          <i className="bi bi-x-lg" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

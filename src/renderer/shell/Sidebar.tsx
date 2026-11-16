import { useEffect, useRef, type KeyboardEvent } from 'react'
import { id } from '../i18n/id'
import { SETTINGS_ITEMS, TOP_ITEMS, type NavItem, type NavKey } from '../nav'

interface Props {
  page: NavKey
  onSelect(k: NavKey): void
  settingsOpen: boolean
  onToggleSettings(): void
  drawer?: boolean
}

export function Sidebar({ page, onSelect, settingsOpen, onToggleSettings, drawer }: Props) {
  const box = useRef<HTMLDivElement>(null)

  // As a modal drawer it takes focus when it opens (on the current page's entry) and keeps Tab inside.
  useEffect(() => {
    if (!drawer) return
    const el = box.current
    const target = el?.querySelector<HTMLElement>('[aria-current="page"]') ?? el?.querySelector<HTMLElement>('button')
    target?.focus()
  }, [drawer])
  const trap = (e: KeyboardEvent): void => {
    if (e.key !== 'Tab' || !box.current) return
    const items = [...box.current.querySelectorAll<HTMLElement>('button')]
    const first = items[0]
    const last = items[items.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }

  const link = (p: NavItem) => (
    <li key={p.key}>
      <button type="button" className="sidebar-link" aria-current={p.key === page ? 'page' : undefined}
        onClick={() => onSelect(p.key)}>
        <i className={`bi ${p.icon}`} aria-hidden="true" />{p.label}
      </button>
    </li>
  )
  const content = (
    <>
      <div className="sidebar-brand"><i className="bi bi-robot" aria-hidden="true" />{id.appName}</div>
      <ul className="sidebar-list">
        {TOP_ITEMS.map(link)}
        <li>
          <button type="button" className="sidebar-link" aria-expanded={settingsOpen} onClick={onToggleSettings}>
            <i className="bi bi-gear" aria-hidden="true" />{id.nav.settings}
            <i className={`bi chevron ${settingsOpen ? 'bi-chevron-up' : 'bi-chevron-down'}`} aria-hidden="true" />
          </button>
          {settingsOpen && <ul className="sidebar-list sidebar-sub">{SETTINGS_ITEMS.map(link)}</ul>}
        </li>
      </ul>
    </>
  )
  if (!drawer) return <nav className="app-sidebar" aria-label="Menu utama">{content}</nav>
  return (
    <div ref={box} className="app-sidebar is-drawer" role="dialog" aria-modal="true" aria-label="Menu utama" onKeyDown={trap}>
      <nav aria-label="Menu utama" className="sidebar-nav">{content}</nav>
    </div>
  )
}

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
  const link = (p: NavItem) => (
    <li key={p.key}>
      <button type="button" className="sidebar-link" aria-current={p.key === page ? 'page' : undefined}
        onClick={() => onSelect(p.key)}>
        <i className={`bi ${p.icon}`} aria-hidden="true" />{p.label}
      </button>
    </li>
  )
  return (
    <nav className={`app-sidebar${drawer ? ' is-drawer' : ''}`} aria-label="Menu utama">
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
    </nav>
  )
}

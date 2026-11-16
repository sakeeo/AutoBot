import { useState } from 'react'
import { ConnectionPage } from './ConnectionPage'
import { AiSettings } from './AiSettings'

const TABS = [
  { id: 'wa', label: 'WhatsApp' },
  { id: 'ai', label: 'AI' }
] as const

export function ConnectorPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('wa')
  return (
    <div>
      <ul className="nav nav-tabs mb-3" role="tablist">
        {TABS.map((t) => (
          <li className="nav-item" role="presentation" key={t.id}>
            <button type="button" role="tab" aria-selected={tab === t.id}
              className={`nav-link ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          </li>
        ))}
      </ul>
      {tab === 'wa' ? <ConnectionPage /> : <AiSettings />}
    </div>
  )
}

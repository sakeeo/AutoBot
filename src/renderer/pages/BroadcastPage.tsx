import { useState } from 'react'
import { PageHeader } from '../ui/PageHeader'
import { CampaignsTab } from '../broadcast/CampaignsTab'
import { RecipientsTab } from '../broadcast/RecipientsTab'
import { ReportTab } from '../broadcast/ReportTab'
import { SafetyTab } from '../broadcast/SafetyTab'

const TABS = [
  { id: 'campaigns', label: 'Kampanye' },
  { id: 'recipients', label: 'Penerima' },
  { id: 'safety', label: 'Keamanan' },
  { id: 'report', label: 'Laporan' }
] as const

export function BroadcastPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('campaigns')
  const [note, setNote] = useState(true)
  return (
    <div>
      <PageHeader icon="bi-megaphone" title="Broadcast"
        subtitle="Kirim pesan massal dengan pengaman: hanya penerima berizin, volume bertahap, dan berhenti otomatis saat ada tanda bahaya." />
      {note && (
        <div className="announcement-banner" role="note">
          <i className="bi bi-info-circle" aria-hidden="true" />
          <span className="text">
            Aplikasi ini memakai jalur tidak resmi WhatsApp, sehingga risiko pemblokiran tidak bisa dihilangkan. Untuk daftar besar
            atau penerima baru, pakai WhatsApp Business Platform yang resmi.
          </span>
          <button type="button" className="close-btn" aria-label="Tutup catatan" onClick={() => setNote(false)}>
            <i className="bi bi-x-lg" aria-hidden="true" />
          </button>
        </div>
      )}
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
      {tab === 'campaigns' && <CampaignsTab />}
      {tab === 'recipients' && <RecipientsTab />}
      {tab === 'safety' && <SafetyTab />}
      {tab === 'report' && <ReportTab />}
    </div>
  )
}

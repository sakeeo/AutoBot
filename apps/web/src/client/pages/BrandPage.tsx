import { useState } from 'react'
import { useBrand } from '../brand/useBrand'
import { PresetPicker } from '../brand/PresetPicker'
import { IdentityTab } from '../brand/IdentityTab'
import { RulesTab } from '../brand/RulesTab'
import { LinksAdminsTab } from '../brand/LinksAdminsTab'
import { LeadTab } from '../brand/LeadTab'
import { HoursTab } from '../brand/HoursTab'
import { PreviewPanel } from '../brand/PreviewPanel'
import { ApplyBar } from '../brand/ApplyBar'
import { ReplyBehaviorTab } from '../brand/ReplyBehaviorTab'
import { Card } from '../ui/Card'
import { PageHeader } from '../ui/PageHeader'
import { LoadingState } from '../ui/States'

const TABS = [
  { id: 'identity', label: 'Identitas & Gaya' },
  { id: 'rules', label: 'Arah Konversi' },
  { id: 'links', label: 'Tautan & Admin' },
  { id: 'lead', label: 'Lead & Pesan' },
  { id: 'hours', label: 'Jam & Batas' },
  { id: 'behavior', label: 'Perilaku balasan' }
] as const

export function BrandPage() {
  const { draft, update, flush, apply, reload, issues, dirty, botNumber } = useBrand()
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('identity')

  if (!draft) return <LoadingState />

  return (
    <div>
      <PageHeader title="Brand & Konversi"
        subtitle="Atur siapa bot ini dan ke mana pelanggan diarahkan. Perubahan baru dipakai bot setelah Anda menekan Terapkan." />
      <div className="row g-3">
        <div className="col-xl-7">
          <Card className="mb-3" aria-label="Preset">
            <PresetPicker current={draft.preset} onLoaded={reload} />
          </Card>
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
          <Card aria-label={TABS.find((t) => t.id === tab)!.label}>
          {tab === 'identity' && <IdentityTab draft={draft} update={update} />}
          {tab === 'rules' && <RulesTab draft={draft} update={update} />}
          {tab === 'links' && <LinksAdminsTab draft={draft} update={update} botNumber={botNumber} />}
          {tab === 'lead' && <LeadTab draft={draft} update={update} />}
          {tab === 'hours' && <HoursTab draft={draft} update={update} />}
          {tab === 'behavior' && <ReplyBehaviorTab />}
          </Card>
        </div>
        <div className="col-xl-5">
          <PreviewPanel beforeSend={flush} />
        </div>
      </div>
      <ApplyBar issues={issues} dirty={dirty} onApply={apply} onChanged={reload} />
    </div>
  )
}

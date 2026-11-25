import { ConfirmButton } from '../ui/ConfirmButton'
import { useState } from 'react'
import { ACTION_KINDS, INTENTS, type ActionKind, type BrandProfile, type Intent, type Rule } from '@autobot/contracts/brand'
import { ACTION_LABEL, GOAL_LABEL, INTENT_LABEL, uid } from './labels'

type Props = { draft: BrandProfile; update: (fn: (d: BrandProfile) => BrandProfile) => void }

function describeRule(r: Rule, d: BrandProfile): string {
  const w = r.when
  const conds: string[] = []
  if (w.intents?.length) conds.push(`maksud ${w.intents.map((i) => INTENT_LABEL[i]).join(' / ')}`)
  if (w.keywords?.length) conds.push(`kata kunci "${w.keywords.join('", "')}"`)
  if (w.withinHours !== undefined) conds.push(w.withinHours ? 'di dalam jam kerja' : 'di luar jam kerja')
  if (w.leadComplete !== undefined) conds.push(w.leadComplete ? 'data lead lengkap' : 'data lead belum lengkap')
  if (w.minTurns) conds.push(`sudah ≥ ${w.minTurns} giliran`)
  if (w.productId) conds.push(`produk ${w.productId}`)
  const link = r.then.linkId ? d.links.find((l) => l.id === r.then.linkId)?.name : null
  const admin = r.then.adminId ? d.admins.find((a) => a.id === r.then.adminId)?.name : null
  const target = link ? ` (${link})` : admin ? ` (${admin})` : ''
  return `Jika ${conds.length ? conds.join(' dan ') : 'apa pun'} → ${ACTION_LABEL[r.then.action]}${target}`
}

export function RulesTab({ draft, update }: Props) {
  const [intent, setIntent] = useState<'' | Intent>('')
  const [keywords, setKeywords] = useState('')
  const [hours, setHours] = useState<'' | 'in' | 'out'>('')
  const [lead, setLead] = useState<'' | 'yes' | 'no'>('')
  const [action, setAction] = useState<ActionKind>('reply_only')
  const [linkId, setLinkId] = useState('')
  const [adminId, setAdminId] = useState('')
  const [message, setMessage] = useState('')
  const [max, setMax] = useState('')

  const setRules = (fn: (r: Rule[]) => Rule[]) => update((d) => ({ ...d, rules: fn(d.rules) }))
  const move = (i: number, by: -1 | 1) =>
    setRules((rs) => {
      const j = i + by
      if (j < 0 || j >= rs.length) return rs
      const next = [...rs]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })

  function add() {
    const when: Rule['when'] = {}
    if (intent) when.intents = [intent]
    const kws = keywords.split(',').map((s) => s.trim()).filter(Boolean)
    if (kws.length) when.keywords = kws
    if (hours) when.withinHours = hours === 'in'
    if (lead) when.leadComplete = lead === 'yes'
    const then: Rule['then'] = { action }
    if (action === 'send_link' && linkId) then.linkId = linkId
    if (action === 'handoff' && adminId) then.adminId = adminId
    if (message.trim()) then.message = message.trim()
    const rule: Rule = { id: uid('r'), enabled: true, when, then }
    if (Number(max) > 0) rule.maxPerContact = Math.floor(Number(max))
    setRules((rs) => [...rs, rule])
    setIntent(''); setKeywords(''); setHours(''); setLead(''); setAction('reply_only')
    setLinkId(''); setAdminId(''); setMessage(''); setMax('')
  }

  return (
    <div>
      <div className="mb-4">
        <div className="form-label">Jenis bisnis</div>
        {(['produk', 'jasa'] as const).map((t) => (
          <div className="form-check form-check-inline" key={t}>
            <input className="form-check-input" type="radio" name="btype" id={`btype-${t}`} checked={draft.businessType === t}
              onChange={() => update((d) => ({ ...d, businessType: t }))} />
            <label className="form-check-label" htmlFor={`btype-${t}`}>{t === 'produk' ? 'Jual produk' : 'Jasa (butuh manusia)'}</label>
          </div>
        ))}
      </div>

      <div className="mb-4">
        <div className="form-label">Tujuan utama percakapan</div>
        {(Object.keys(GOAL_LABEL) as (keyof typeof GOAL_LABEL)[]).map((g) => (
          <div className="form-check" key={g}>
            <input className="form-check-input" type="radio" name="goal" id={`goal-${g}`} checked={draft.goal === g}
              onChange={() => update((d) => ({ ...d, goal: g }))} />
            <label className="form-check-label" htmlFor={`goal-${g}`}>{GOAL_LABEL[g]}</label>
          </div>
        ))}
      </div>

      <h3 className="h6">Aturan arah</h3>
      <p className="small text-body-secondary">
        Dievaluasi dari atas ke bawah; aturan pertama yang cocok yang dipakai. Komplain, permintaan bicara dengan manusia,
        dan topik sensitif selalu diserahkan ke admin.
      </p>
      <ol className="list-group list-group-numbered mb-4" data-testid="rule-list">
        {draft.rules.map((r, i) => (
          <li key={r.id} className={`list-group-item d-flex align-items-center gap-2 ${r.enabled ? '' : 'text-body-secondary'}`}>
            <input type="checkbox" className="form-check-input mt-0" aria-label={`Aktifkan aturan ${i + 1}`} checked={r.enabled}
              onChange={(e) => setRules((rs) => rs.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)))} />
            <span className="flex-grow-1">{describeRule(r, draft)}</span>
            <button type="button" className="btn btn-sm btn-outline-secondary" aria-label={`Naikkan aturan ${i + 1}`}
              disabled={i === 0} onClick={() => move(i, -1)}><i className="bi bi-arrow-up" /></button>
            <button type="button" className="btn btn-sm btn-outline-secondary" aria-label={`Turunkan aturan ${i + 1}`}
              disabled={i === draft.rules.length - 1} onClick={() => move(i, 1)}><i className="bi bi-arrow-down" /></button>
            <ConfirmButton label="Hapus" ariaLabel={`Hapus aturan ${i + 1}`} className="btn btn-sm btn-outline-danger" onConfirm={() => setRules((rs) => rs.filter((_, j) => j !== i))}><i className="bi bi-trash" aria-hidden="true" /></ConfirmButton>
          </li>
        ))}
        {draft.rules.length === 0 && <li className="list-group-item text-body-secondary">Belum ada aturan.</li>}
      </ol>

      <div className="card card-body">
        <h4 className="h6">Tambah aturan</h4>
        <div className="row g-2">
          <div className="col-md-4">
            <label htmlFor="r-intent" className="form-label">Jika maksud pelanggan</label>
            <select id="r-intent" className="form-select" value={intent} onChange={(e) => setIntent(e.target.value as '' | Intent)}>
              <option value="">(apa saja)</option>
              {INTENTS.map((i) => <option key={i} value={i}>{INTENT_LABEL[i]}</option>)}
            </select>
          </div>
          <div className="col-md-4">
            <label htmlFor="r-kw" className="form-label">Kata kunci (pisahkan koma)</label>
            <input id="r-kw" className="form-control" value={keywords} onChange={(e) => setKeywords(e.target.value)} />
          </div>
          <div className="col-md-4">
            <label htmlFor="r-hours" className="form-label">Jam kerja</label>
            <select id="r-hours" className="form-select" value={hours} onChange={(e) => setHours(e.target.value as '' | 'in' | 'out')}>
              <option value="">(kapan saja)</option>
              <option value="in">Di dalam jam kerja</option>
              <option value="out">Di luar jam kerja</option>
            </select>
          </div>
          <div className="col-md-4">
            <label htmlFor="r-lead" className="form-label">Data lead</label>
            <select id="r-lead" className="form-select" value={lead} onChange={(e) => setLead(e.target.value as '' | 'yes' | 'no')}>
              <option value="">(apa saja)</option>
              <option value="yes">Sudah lengkap</option>
              <option value="no">Belum lengkap</option>
            </select>
          </div>
          <div className="col-md-4">
            <label htmlFor="r-action" className="form-label">Maka lakukan</label>
            <select id="r-action" className="form-select" value={action} onChange={(e) => setAction(e.target.value as ActionKind)}>
              {ACTION_KINDS.map((a) => <option key={a} value={a}>{ACTION_LABEL[a]}</option>)}
            </select>
          </div>
          {action === 'send_link' && (
            <div className="col-md-4">
              <label htmlFor="r-link" className="form-label">Tautan</label>
              <select id="r-link" className="form-select" value={linkId} onChange={(e) => setLinkId(e.target.value)}>
                <option value="">(pilih tautan)</option>
                {draft.links.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
          )}
          {action === 'handoff' && (
            <div className="col-md-4">
              <label htmlFor="r-admin" className="form-label">Admin</label>
              <select id="r-admin" className="form-select" value={adminId} onChange={(e) => setAdminId(e.target.value)}>
                <option value="">(semua admin)</option>
                {draft.admins.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          )}
          <div className="col-md-8">
            <label htmlFor="r-msg" className="form-label">Pesan tambahan (opsional)</label>
            <input id="r-msg" className="form-control" value={message} onChange={(e) => setMessage(e.target.value)} />
          </div>
          <div className="col-md-4">
            <label htmlFor="r-max" className="form-label">Maks per kontak</label>
            <input id="r-max" type="number" min={1} className="form-control" value={max} onChange={(e) => setMax(e.target.value)} />
          </div>
        </div>
        <div className="mt-3">
          <button type="button" className="btn btn-primary" onClick={add}>Tambah aturan</button>
        </div>
      </div>
    </div>
  )
}

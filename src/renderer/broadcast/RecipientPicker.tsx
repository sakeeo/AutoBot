import { useMemo, useState } from 'react'
import type { BContact } from '../../shared/broadcast'

const SOURCE_LABEL: Record<BContact['source'], string> = { chat: 'Chat', impor: 'Impor' }

/**
 * Everyone in the chosen audience, all ticked by default. Unticking someone only leaves them out of this campaign;
 * the contact itself stays in the recipient list.
 */
export function RecipientPicker({ contacts, excluded, onChange, loading, error }: {
  contacts: BContact[]
  excluded: Set<number>
  onChange(next: Set<number>): void
  loading: boolean
  error: string | null
}) {
  const [query, setQuery] = useState('')
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return contacts
    return contacts.filter((c) => c.name.toLowerCase().includes(q) || (c.number ?? '').includes(q.replace(/\D/g, '') || q))
  }, [contacts, query])

  if (loading) return <p className="text-body-secondary">Memuat penerima…</p>
  if (error) return <div className="alert alert-danger" role="alert">{error}</div>
  if (contacts.length === 0) return <p className="text-body-secondary">Belum ada penerima aktif di audiens ini.</p>

  const selected = contacts.length - excluded.size
  const allVisibleOn = visible.length > 0 && visible.every((c) => !excluded.has(c.id))
  const someVisibleOn = visible.some((c) => !excluded.has(c.id))

  const toggleAll = (on: boolean): void => {
    const next = new Set(excluded)
    for (const c of visible) on ? next.delete(c.id) : next.add(c.id)
    onChange(next)
  }
  const toggle = (id: number, on: boolean): void => {
    const next = new Set(excluded)
    on ? next.delete(id) : next.add(id)
    onChange(next)
  }

  return (
    <div className="recipient-picker">
      <div className="d-flex gap-2 align-items-center mb-2 flex-wrap">
        <input type="search" className="form-control" style={{ maxWidth: 280 }} placeholder="Cari nama atau nomor"
          aria-label="Cari penerima" value={query} onChange={(e) => setQuery(e.target.value)} />
        <span className="text-body-secondary" aria-live="polite">{`${selected} dari ${contacts.length} dipilih`}</span>
      </div>
      <div className="border rounded" style={{ maxHeight: 280, overflowY: 'auto' }}>
        <div className="form-check px-3 py-2 border-bottom" style={{ paddingLeft: '2.25rem' }}>
          <input id="rp-all" type="checkbox" className="form-check-input" checked={allVisibleOn}
            ref={(el) => { if (el) el.indeterminate = someVisibleOn && !allVisibleOn }}
            onChange={(e) => toggleAll(e.target.checked)} />
          <label htmlFor="rp-all" className="form-check-label fw-semibold">
            {query.trim() ? `Pilih semua hasil (${visible.length})` : `Pilih semua (${contacts.length})`}
          </label>
        </div>
        {visible.map((c) => (
          <div className="form-check px-3 py-1" style={{ paddingLeft: '2.25rem' }} key={c.id}>
            <input id={`rp-${c.id}`} type="checkbox" className="form-check-input" checked={!excluded.has(c.id)}
              onChange={(e) => toggle(c.id, e.target.checked)} />
            <label htmlFor={`rp-${c.id}`} className="form-check-label d-flex gap-2">
              <span>{c.number ?? '(id chat)'}</span>
              {c.name && <span>{c.name}</span>}
              <span className="text-body-secondary">{SOURCE_LABEL[c.source]}</span>
            </label>
          </div>
        ))}
        {visible.length === 0 && <p className="text-body-secondary px-3 py-2 mb-0">Tidak ada yang cocok.</p>}
      </div>
      <div className="form-text">Yang tidak dicentang hanya dikecualikan dari kampanye ini. Kontaknya tetap ada di daftar penerima.</div>
    </div>
  )
}

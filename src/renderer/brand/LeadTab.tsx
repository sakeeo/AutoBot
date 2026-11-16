import { ConfirmButton } from '../ui/ConfirmButton'
import type { BrandProfile } from '../../shared/brand'
import { TagInput } from './TagInput'
import { uid } from './labels'

type Props = { draft: BrandProfile; update: (fn: (d: BrandProfile) => BrandProfile) => void }

const TEMPLATES: { key: keyof BrandProfile['templates']; label: string; hint: string }[] = [
  { key: 'handoffFarewell', label: 'Pesan pamit saat serah ke admin', hint: 'Variabel: {sapaan} {nama} {produk} {jam_kerja}' },
  { key: 'checkout', label: 'Pesan saat mengirim tautan checkout', hint: 'Variabel: {sapaan} {nama} {produk} {harga} {tautan}' },
  { key: 'outsideHours', label: 'Pesan di luar jam kerja', hint: 'Variabel: {sapaan} {jam_kerja}' },
  { key: 'unknown', label: 'Pesan saat bot tidak tahu jawabannya', hint: 'Variabel: {sapaan}' }
]

export function LeadTab({ draft, update }: Props) {
  const sorted = [...draft.leadQuestions].sort((a, b) => a.order - b.order)
  const setQs = (qs: BrandProfile['leadQuestions']) => update((d) => ({ ...d, leadQuestions: qs.map((q, i) => ({ ...q, order: i })) }))

  return (
    <div>
      <h3 className="h6">Pertanyaan kualifikasi lead</h3>
      <p className="small text-body-secondary">Ditanyakan satu per satu, tidak memaksa. Centang yang wajib ada sebelum diserahkan ke admin.</p>
      {sorted.map((q, i) => (
        <div key={q.key} className="card card-body mb-2">
          <div className="row g-2 align-items-center">
            <div className="col-md-2">
              <input aria-label={`Kunci pertanyaan ${i + 1}`} className="form-control" value={q.key}
                onChange={(e) => setQs(sorted.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} />
            </div>
            <div className="col-md-6">
              <input aria-label={`Teks pertanyaan ${i + 1}`} className="form-control" value={q.text}
                onChange={(e) => setQs(sorted.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
            </div>
            <div className="col-md-3 form-check form-switch ps-5">
              <input id={`lm-${i}`} type="checkbox" role="switch" className="form-check-input"
                checked={draft.leadMinimum.includes(q.key)}
                onChange={(e) => update((d) => ({
                  ...d,
                  leadMinimum: e.target.checked ? [...new Set([...d.leadMinimum, q.key])] : d.leadMinimum.filter((k) => k !== q.key)
                }))} />
              <label htmlFor={`lm-${i}`} className="form-check-label">Wajib sebelum serah</label>
            </div>
            <div className="col-md-1">
              <ConfirmButton label="Hapus" ariaLabel={`Hapus pertanyaan ${i + 1}`} className="btn btn-outline-danger w-100" onConfirm={() => setQs(sorted.filter((_, j) => j !== i))}><i className="bi bi-trash" aria-hidden="true" /></ConfirmButton>
            </div>
          </div>
        </div>
      ))}
      <button type="button" className="btn btn-outline-secondary btn-sm mb-4" disabled={sorted.length >= 10}
        onClick={() => setQs([...sorted, { key: uid('q'), text: '', required: false, order: sorted.length, skipWords: [] }])}>
        Tambah pertanyaan
      </button>

      <h3 className="h6">Jawaban untuk keberatan umum</h3>
      {draft.objections.map((o, i) => (
        <div key={i} className="card card-body mb-2">
          <div className="row g-2">
            <div className="col-md-3">
              <input aria-label={`Keberatan ${i + 1}`} className="form-control" placeholder='mis. "mahal"' value={o.trigger}
                onChange={(e) => update((d) => ({ ...d, objections: d.objections.map((x, j) => (j === i ? { ...x, trigger: e.target.value } : x)) }))} />
            </div>
            <div className="col-md-8">
              <input aria-label={`Jawaban keberatan ${i + 1}`} className="form-control" placeholder="Acuan jawaban" value={o.answer}
                onChange={(e) => update((d) => ({ ...d, objections: d.objections.map((x, j) => (j === i ? { ...x, answer: e.target.value } : x)) }))} />
            </div>
            <div className="col-md-1">
              <ConfirmButton label="Hapus" ariaLabel={`Hapus keberatan ${i + 1}`} className="btn btn-outline-danger w-100" onConfirm={() => update((d) => ({ ...d, objections: d.objections.filter((_, j) => j !== i) }))}><i className="bi bi-trash" aria-hidden="true" /></ConfirmButton>
            </div>
          </div>
        </div>
      ))}
      <button type="button" className="btn btn-outline-secondary btn-sm mb-4" disabled={draft.objections.length >= 20}
        onClick={() => update((d) => ({ ...d, objections: [...d.objections, { trigger: '', answer: '' }] }))}>
        Tambah keberatan
      </button>

      <h3 className="h6">Template pesan</h3>
      {TEMPLATES.map((t) => (
        <div className="mb-3" key={t.key}>
          <label htmlFor={`tpl-${t.key}`} className="form-label">{t.label}</label>
          <textarea id={`tpl-${t.key}`} className="form-control" rows={2} value={draft.templates[t.key]}
            onChange={(e) => update((d) => ({ ...d, templates: { ...d.templates, [t.key]: e.target.value } }))} />
          <div className="form-text">{t.hint}</div>
        </div>
      ))}

      <TagInput id="topics" label="Topik terlarang" tags={draft.bannedTopics}
        onChange={(t) => update((d) => ({ ...d, bannedTopics: t }))} />
    </div>
  )
}

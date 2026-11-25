import { useState } from 'react'

export function TagInput({ id, label, tags, onChange, placeholder }: {
  id: string; label: string; tags: string[]; onChange: (t: string[]) => void; placeholder?: string
}) {
  const [text, setText] = useState('')
  const add = () => {
    const t = text.trim()
    if (t && !tags.includes(t)) onChange([...tags, t])
    setText('')
  }
  return (
    <div className="mb-3">
      <label htmlFor={id} className="form-label">{label}</label>
      <div className="d-flex flex-wrap gap-1 mb-1">
        {tags.map((t) => (
          <span key={t} className="badge text-bg-secondary">
            {t}{' '}
            <button type="button" className="tag-remove" aria-label={`Hapus ${t}`}
              onClick={() => onChange(tags.filter((x) => x !== t))}>
              <i className="bi bi-x-lg" aria-hidden="true" />
            </button>
          </span>
        ))}
      </div>
      <input id={id} className="form-control" value={text} placeholder={placeholder ?? 'Ketik lalu Enter'}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add() } }}
        onBlur={add} />
    </div>
  )
}

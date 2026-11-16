import type { BrandProfile } from '../../shared/brand'
import { TagInput } from './TagInput'

type Props = { draft: BrandProfile; update: (fn: (d: BrandProfile) => BrandProfile) => void }

export function IdentityTab({ draft, update }: Props) {
  const { identity, style } = draft
  const setId = (p: Partial<BrandProfile['identity']>) => update((d) => ({ ...d, identity: { ...d.identity, ...p } }))
  const setStyle = (p: Partial<BrandProfile['style']>) => update((d) => ({ ...d, style: { ...d.style, ...p } }))

  return (
    <div>
      <div className="row g-3 mb-3">
        <div className="col-md-6">
          <label htmlFor="biz-name" className="form-label">Nama bisnis</label>
          <input id="biz-name" className="form-control" value={identity.businessName} maxLength={80}
            onChange={(e) => setId({ businessName: e.target.value })} />
        </div>
        <div className="col-md-6">
          <label htmlFor="bot-name" className="form-label">Nama bot</label>
          <input id="bot-name" className="form-control" value={identity.botName} maxLength={40}
            onChange={(e) => setId({ botName: e.target.value })} />
        </div>
      </div>

      <div className="mb-3">
        <label htmlFor="about" className="form-label">Tentang bisnis</label>
        <textarea id="about" className="form-control" rows={3} maxLength={500} value={identity.about}
          onChange={(e) => setId({ about: e.target.value })} />
        <div className="form-text text-end">{identity.about.length}/500</div>
      </div>

      <div className="row g-3 mb-3">
        <div className="col-md-4">
          <label htmlFor="tone" className="form-label">Nada</label>
          <select id="tone" className="form-select" value={style.tone}
            onChange={(e) => setStyle({ tone: e.target.value as BrandProfile['style']['tone'] })}>
            <option value="formal">Formal</option>
            <option value="ramah">Ramah</option>
            <option value="santai">Santai-sopan</option>
            <option value="antusias">Antusias</option>
          </select>
        </div>
        <div className="col-md-4">
          <label htmlFor="greeting" className="form-label">Sapaan pelanggan</label>
          <select id="greeting" className="form-select" value={style.greeting}
            onChange={(e) => setStyle({ greeting: e.target.value as BrandProfile['style']['greeting'] })}>
            <option value="kak">Kak</option>
            <option value="bapak_ibu">Bapak/Ibu</option>
            <option value="anda">Anda</option>
            <option value="ikuti">Ikuti pelanggan</option>
          </select>
        </div>
        <div className="col-md-4">
          <label htmlFor="lang" className="form-label">Bahasa</label>
          <select id="lang" className="form-select" value={identity.language}
            onChange={(e) => setId({ language: e.target.value as BrandProfile['identity']['language'] })}>
            <option value="id">Indonesia</option>
            <option value="en">Inggris</option>
            <option value="auto">Ikuti pelanggan</option>
          </select>
        </div>
        <div className="col-md-4">
          <label htmlFor="emoji" className="form-label">Emoji</label>
          <select id="emoji" className="form-select" value={style.emoji}
            onChange={(e) => setStyle({ emoji: Number(e.target.value) as 0 | 1 | 2 })}>
            <option value={0}>Tanpa emoji</option>
            <option value={1}>Sesekali</option>
            <option value={2}>Cukup sering</option>
          </select>
        </div>
        <div className="col-md-4">
          <label htmlFor="length" className="form-label">Panjang jawaban</label>
          <select id="length" className="form-select" value={style.length}
            onChange={(e) => setStyle({ length: e.target.value as BrandProfile['style']['length'] })}>
            <option value="ringkas">Ringkas</option>
            <option value="sedang">Sedang</option>
            <option value="rinci">Rinci</option>
          </select>
        </div>
      </div>

      <TagInput id="must" label="Kata wajib" tags={style.mustWords} onChange={(t) => setStyle({ mustWords: t })} />
      <TagInput id="banned" label="Kata terlarang" tags={style.bannedWords} onChange={(t) => setStyle({ bannedWords: t })} />

      <div className="form-check form-switch mb-2">
        <input id="intro-on" type="checkbox" role="switch" className="form-check-input" checked={style.introduceAsBot}
          onChange={(e) => setStyle({ introduceAsBot: e.target.checked })} />
        <label htmlFor="intro-on" className="form-check-label">Perkenalkan diri sebagai asisten otomatis</label>
      </div>
      <textarea aria-label="Teks perkenalan" className="form-control mb-4" rows={2} value={style.introText}
        disabled={!style.introduceAsBot} onChange={(e) => setStyle({ introText: e.target.value })} />

      <h3 className="h6">Contoh gaya jawaban</h3>
      <p className="small text-body-secondary">Dipakai sebagai contoh bagi AI agar nada dan panjang jawabannya konsisten.</p>
      {style.examples.map((ex, i) => (
        <div key={i} className="card card-body mb-2">
          <div className="row g-2">
            <div className="col-md-5">
              <input aria-label={`Pertanyaan contoh ${i + 1}`} className="form-control" placeholder="Pertanyaan pelanggan"
                value={ex.q} onChange={(e) => setStyle({ examples: style.examples.map((x, j) => (j === i ? { ...x, q: e.target.value } : x)) })} />
            </div>
            <div className="col-md-6">
              <input aria-label={`Jawaban contoh ${i + 1}`} className="form-control" placeholder="Jawaban ideal"
                value={ex.a} onChange={(e) => setStyle({ examples: style.examples.map((x, j) => (j === i ? { ...x, a: e.target.value } : x)) })} />
            </div>
            <div className="col-md-1">
              <button type="button" className="btn btn-outline-danger w-100" aria-label={`Hapus contoh ${i + 1}`}
                onClick={() => setStyle({ examples: style.examples.filter((_, j) => j !== i) })}>
                <i className="bi bi-trash" />
              </button>
            </div>
          </div>
        </div>
      ))}
      <button type="button" className="btn btn-outline-secondary btn-sm" disabled={style.examples.length >= 10}
        onClick={() => setStyle({ examples: [...style.examples, { q: '', a: '' }] })}>
        Tambah contoh
      </button>
    </div>
  )
}

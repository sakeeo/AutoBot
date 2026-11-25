import { ConfirmButton } from '../ui/ConfirmButton'
import { normalizeNumber, type BrandProfile, type LinkEntry } from '@autobot/contracts/brand'
import { uid } from './labels'

type Props = {
  draft: BrandProfile
  update: (fn: (d: BrandProfile) => BrandProfile) => void
  botNumber: string | null
}

const KINDS: { id: LinkEntry['kind']; label: string }[] = [
  { id: 'checkout', label: 'Checkout' },
  { id: 'booking', label: 'Booking' },
  { id: 'catalog', label: 'Katalog' },
  { id: 'form', label: 'Formulir' },
  { id: 'site', label: 'Situs' }
]

const isHttps = (u: string) => /^https:\/\/[^\s/]+/i.test(u)

export function LinksAdminsTab({ draft, update, botNumber }: Props) {
  const setLink = (i: number, p: Partial<LinkEntry>) =>
    update((d) => ({ ...d, links: d.links.map((l, j) => (j === i ? { ...l, ...p } : l)) }))
  const setAdmin = (i: number, p: Partial<BrandProfile['admins'][number]>) =>
    update((d) => ({ ...d, admins: d.admins.map((a, j) => (j === i ? { ...a, ...p } : a)) }))

  return (
    <div>
      <h3 className="h6">Tautan yang boleh dikirim bot</h3>
      <p className="small text-body-secondary">
        Hanya tautan di sini (dan tautan checkout produk di katalog) yang akan pernah dikirim ke pelanggan. Wajib https://
      </p>
      {draft.links.map((l, i) => (
        <div key={l.id} className="card card-body mb-2">
          <div className="row g-2 align-items-start">
            <div className="col-md-3">
              <input aria-label={`Nama tautan ${i + 1}`} className="form-control" value={l.name}
                onChange={(e) => setLink(i, { name: e.target.value })} />
            </div>
            <div className="col-md-2">
              <select aria-label={`Jenis tautan ${i + 1}`} className="form-select" value={l.kind}
                onChange={(e) => setLink(i, { kind: e.target.value as LinkEntry['kind'] })}>
                {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
              </select>
            </div>
            <div className="col-md-5">
              <input aria-label={`URL tautan ${i + 1}`} className={`form-control ${isHttps(l.url) ? '' : 'is-invalid'}`}
                value={l.url} onChange={(e) => setLink(i, { url: e.target.value })} />
              {!isHttps(l.url) && <div className="invalid-feedback d-block">URL harus diawali https://</div>}
            </div>
            <div className="col-md-1 form-check form-switch pt-2 ps-5">
              <input type="checkbox" role="switch" className="form-check-input" aria-label={`Pelacakan tautan ${i + 1}`}
                checked={l.tracking} onChange={(e) => setLink(i, { tracking: e.target.checked })} />
            </div>
            <div className="col-md-1">
              <ConfirmButton label="Hapus" ariaLabel={`Hapus tautan ${i + 1}`} className="btn btn-outline-danger w-100" onConfirm={() => update((d) => ({ ...d, links: d.links.filter((_, j) => j !== i) }))}><i className="bi bi-trash" aria-hidden="true" /></ConfirmButton>
            </div>
          </div>
        </div>
      ))}
      <button type="button" className="btn btn-outline-secondary btn-sm mb-4"
        onClick={() => update((d) => ({ ...d, links: [...d.links, { id: uid('l'), name: 'Tautan baru', kind: 'checkout', url: 'https://', tracking: true }] }))}>
        Tambah tautan
      </button>

      <h3 className="h6">Admin manusia</h3>
      <p className="small text-body-secondary">
        Penerima ringkasan lead saat percakapan diserahkan. Nomor harus berbeda dari nomor bot
        {botNumber ? ` (${botNumber})` : ''}.
      </p>
      {draft.admins.map((a, i) => {
        const same = !!botNumber && normalizeNumber(a.number) === normalizeNumber(botNumber)
        return (
          <div key={a.id} className="card card-body mb-2">
            <div className="row g-2 align-items-start">
              <div className="col-md-4">
                <input aria-label={`Nama admin ${i + 1}`} className="form-control" value={a.name}
                  onChange={(e) => setAdmin(i, { name: e.target.value })} />
              </div>
              <div className="col-md-4">
                <input aria-label={`Nomor admin ${i + 1}`} className={`form-control ${same ? 'is-invalid' : ''}`} placeholder="0812…"
                  value={a.number} onChange={(e) => setAdmin(i, { number: e.target.value })} />
                {same && <div className="invalid-feedback d-block">Nomor ini sama dengan nomor bot.</div>}
              </div>
              <div className="col-md-3 form-check form-switch pt-2 ps-5">
                <input id={`adm-wa-${i}`} type="checkbox" role="switch" className="form-check-input" checked={a.notifyWhatsapp}
                  onChange={(e) => setAdmin(i, { notifyWhatsapp: e.target.checked })} />
                <label htmlFor={`adm-wa-${i}`} className="form-check-label">Kabari lewat WhatsApp</label>
              </div>
              <div className="col-md-1">
                <ConfirmButton label="Hapus" ariaLabel={`Hapus admin ${i + 1}`} className="btn btn-outline-danger w-100" onConfirm={() => update((d) => ({ ...d, admins: d.admins.filter((_, j) => j !== i) }))}><i className="bi bi-trash" aria-hidden="true" /></ConfirmButton>
              </div>
            </div>
          </div>
        )
      })}
      <button type="button" className="btn btn-outline-secondary btn-sm"
        onClick={() => update((d) => ({ ...d, admins: [...d.admins, { id: uid('a'), name: 'Admin baru', number: '', notifyWhatsapp: true }] }))}>
        Tambah admin
      </button>
    </div>
  )
}

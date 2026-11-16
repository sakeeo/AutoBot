import { useState } from 'react'
import type { Audience, Campaign } from '../../shared/broadcast'
import { Card } from '../ui/Card'
import { SKIP_LABEL } from './labels'

const BIG = 50
const FOOTER = 'Balas BERHENTI untuk tidak menerima pesan ini lagi.'
const AUDIENCES: { id: Audience; label: string }[] = [
  { id: 'chat', label: 'Kontak chat aktif' },
  { id: 'impor', label: 'Hasil impor aktif' },
  { id: 'semua', label: 'Gabungan keduanya' }
]
const CHECKS = [
  'Saya sudah memeriksa pratinjau pesan',
  'Saya paham broadcast hanya untuk penerima yang sudah setuju',
  'Saya paham kampanye berhenti sendiri bila ada tanda bahaya'
]

type Preview = { eligible: number; skipped: Record<string, number>; estimatedDays: number }

export function CampaignWizard({ onDone, onClose }: { onDone(): void; onClose(): void }) {
  const [step, setStep] = useState(1)
  const [audience, setAudience] = useState<Audience>('chat')
  const [name, setName] = useState('')
  const [template, setTemplate] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [samples, setSamples] = useState<string[]>([])
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [checked, setChecked] = useState<boolean[]>(CHECKS.map(() => false))
  const [typed, setTyped] = useState('')
  const [startError, setStartError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function toReview(): Promise<void> {
    setBusy(true)
    setErrors([])
    try {
      const r = await window.api.bcCreateCampaign({ name: name.trim(), template, audience })
      if (!r.ok) { setErrors(r.errors); setWarnings(r.warnings); return }
      setCampaign(r.campaign)
      setWarnings(r.warnings)
      setSamples(r.samples)
      setPreview(await window.api.bcPreviewCampaign(r.campaign.id))
      setStep(3)
    } catch (e) {
      setErrors([String((e as Error).message).includes('LOCKED') ? 'Aplikasi terkunci. Buka kunci dulu.' : 'Kampanye tidak bisa dibuat.'])
    } finally {
      setBusy(false)
    }
  }

  async function start(): Promise<void> {
    if (!campaign || !preview) return
    setBusy(true)
    setStartError(null)
    try {
      const r = await window.api.bcStartCampaign(campaign.id, preview.eligible > BIG ? typed : undefined)
      if (r.ok) onDone()
      else setStartError(r.error)
    } catch {
      setStartError('Kampanye tidak bisa dimulai.')
    } finally {
      setBusy(false)
    }
  }

  const big = (preview?.eligible ?? 0) > BIG
  return (
    <Card title={`Kampanye baru · langkah ${step} dari 4`} className="mb-3"
      actions={<button type="button" className="btn btn-sm btn-outline-secondary" onClick={onClose}>Batal</button>}>
      {step === 1 && (
        <>
          <fieldset className="mb-3">
            <legend className="h6">Siapa penerimanya?</legend>
            {AUDIENCES.map((a) => (
              <div className="form-check" key={a.id}>
                <input id={`aud-${a.id}`} type="radio" name="audience" className="form-check-input" checked={audience === a.id} onChange={() => setAudience(a.id)} />
                <label htmlFor={`aud-${a.id}`} className="form-check-label">{a.label}</label>
              </div>
            ))}
            <div className="form-text">
              Audiens chat dihitung dari pesan yang tercatat aplikasi. Hanya penerima yang aktif dan tidak di daftar tolak yang akan dikirimi.
            </div>
          </fieldset>
          <button type="button" className="btn btn-primary" onClick={() => setStep(2)}>Lanjut</button>
        </>
      )}

      {step === 2 && (
        <>
          <div className="mb-3">
            <label htmlFor="c-name" className="form-label">Nama kampanye</label>
            <input id="c-name" className="form-control" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="mb-3">
            <label htmlFor="c-text" className="form-label">Isi pesan</label>
            <textarea id="c-text" className="form-control" rows={5} maxLength={1000} value={template} onChange={(e) => setTemplate(e.target.value)} />
            <div className="form-text">Variabel: {'{nama}'} dan {'{bisnis}'}. Wajib menyebut nama bisnis. Maksimal 600 karakter dan satu tautan.</div>
          </div>
          <div className="mb-3">
            <div className="form-label">Kaki berhenti</div>
            <div aria-label="Kaki berhenti (otomatis)" className="form-control-plaintext border rounded px-3 text-body-secondary">{FOOTER}</div>
            <div className="form-text">Ditambahkan otomatis ke setiap pesan dan tidak bisa diubah.</div>
          </div>
          {errors.length > 0 && (
            <div className="alert alert-danger" role="alert"><ul className="mb-0">{errors.map((e) => <li key={e}>{e}</li>)}</ul></div>
          )}
          <div className="d-flex gap-2">
            <button type="button" className="btn btn-outline-secondary" onClick={() => setStep(1)}>Kembali</button>
            <button type="button" className="btn btn-primary" disabled={busy || !name.trim() || !template.trim()} onClick={toReview}>Lanjut</button>
          </div>
        </>
      )}

      {step === 3 && preview && (
        <>
          <p className="h5">{`${preview.eligible} penerima layak`}</p>
          <ul>
            {Object.entries(preview.skipped).map(([k, n]) => <li key={k}>{`${SKIP_LABEL[k] ?? k}: ${n}`}</li>)}
          </ul>
          <p>{`Perkiraan selesai: ${preview.estimatedDays} hari (mengikuti batas harian dan jam kirim).`}</p>
          {warnings.length > 0 && (
            <div className="alert alert-warning"><ul className="mb-0">{warnings.map((w) => <li key={w}>{w}</li>)}</ul></div>
          )}
          <h3 className="h6">Contoh pesan yang akan diterima</h3>
          {samples.length === 0 && <p className="text-body-secondary">Belum ada penerima untuk dicontohkan.</p>}
          {samples.map((s, i) => <pre key={i} className="border rounded p-2" style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{s}</pre>)}
          {CHECKS.map((c, i) => (
            <div className="form-check" key={c}>
              <input id={`chk-${i}`} type="checkbox" className="form-check-input" checked={checked[i]}
                onChange={(e) => setChecked((cs) => cs.map((v, j) => (j === i ? e.target.checked : v)))} />
              <label htmlFor={`chk-${i}`} className="form-check-label">{c}</label>
            </div>
          ))}
          <div className="d-flex gap-2 mt-3">
            <button type="button" className="btn btn-outline-secondary" onClick={() => setStep(2)}>Kembali</button>
            <button type="button" className="btn btn-primary" disabled={!checked.every(Boolean)} onClick={() => setStep(4)}>Lanjut</button>
          </div>
        </>
      )}

      {step === 4 && preview && (
        <>
          <p>{`Kampanye "${campaign?.name}" akan dikirim ke ${preview.eligible} penerima, bertahap sesuai batas harian dan jam kirim.`}</p>
          {big && (
            <div className="mb-3" style={{ maxWidth: 280 }}>
              <label htmlFor="c-confirm" className="form-label">Ketik KIRIM untuk memulai</label>
              <input id="c-confirm" className="form-control" value={typed} onChange={(e) => setTyped(e.target.value)} />
            </div>
          )}
          {startError && <div className="alert alert-danger" role="alert">{startError}</div>}
          <div className="d-flex gap-2">
            <button type="button" className="btn btn-outline-secondary" onClick={() => setStep(3)}>Kembali</button>
            <button type="button" className="btn btn-primary" disabled={busy || (big && typed !== 'KIRIM')} onClick={start}>Mulai kampanye</button>
          </div>
        </>
      )}
    </Card>
  )
}

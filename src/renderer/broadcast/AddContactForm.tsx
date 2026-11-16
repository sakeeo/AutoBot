import { useState } from 'react'
import { Card } from '../ui/Card'

const DEFAULT_NOTE = 'Ditambahkan manual lewat aplikasi'

export function AddContactForm({ onDone, onClose }: { onDone(): void; onClose(): void }) {
  const [name, setName] = useState('')
  const [number, setNumber] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [note, setNote] = useState(DEFAULT_NOTE)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  async function submit(): Promise<void> {
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      const r = await window.api.bcAddContact({ name: name.trim(), number: number.trim(), accepted: true, sourceNote: note.trim() })
      if (r.ok) {
        setDone(`${name.trim() || number.trim()} ditambahkan. Kirim konfirmasi agar kontak ini bisa menerima broadcast.`)
        setName('')
        setNumber('')
        onDone()
      } else {
        setError(r.error)
      }
    } catch (e) {
      const m = String((e as Error).message)
      setError(m.includes('LOCKED') ? 'Aplikasi terkunci. Buka kunci dulu.' : 'Kontak tidak bisa ditambahkan. Pastikan WhatsApp terhubung.')
    } finally {
      setBusy(false)
    }
  }

  const ready = agreed && number.trim() !== '' && note.trim().length >= 10 && !busy
  return (
    <Card title="Tambah kontak" className="mb-3"
      actions={<button type="button" className="btn btn-sm btn-outline-secondary" onClick={onClose}>Tutup</button>}>
      <p className="text-body-secondary">
        Nomor dicek ke WhatsApp dulu. Seperti kontak impor, kontak baru menerima satu pesan konfirmasi dan baru bisa dikirimi
        broadcast setelah membalas.
      </p>
      <div className="row g-3 mb-3">
        <div className="col-md-5">
          <label htmlFor="ac-name" className="form-label">Nama</label>
          <input id="ac-name" className="form-control" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="col-md-5">
          <label htmlFor="ac-number" className="form-label">Nomor</label>
          <input id="ac-number" className="form-control" inputMode="tel" maxLength={30} placeholder="0812-3456-7890"
            value={number} onChange={(e) => setNumber(e.target.value)} />
        </div>
      </div>
      <div className="form-check mb-3">
        <input id="ac-attest" className="form-check-input" type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        <label htmlFor="ac-attest" className="form-check-label">
          Saya memiliki persetujuan dari nomor ini untuk menerima pesan dari bisnis saya
        </label>
      </div>
      <div className="mb-3">
        <label htmlFor="ac-note" className="form-label">Keterangan sumber data</label>
        <input id="ac-note" className="form-control" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="form-text">Minimal 10 karakter.</div>
      </div>
      {error && <div className="alert alert-danger" role="alert">{error}</div>}
      {done && <div className="alert alert-success" role="status">{done}</div>}
      <button type="button" className="btn btn-primary" disabled={!ready} onClick={submit}>Tambah kontak</button>
    </Card>
  )
}

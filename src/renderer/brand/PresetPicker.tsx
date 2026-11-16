import { useEffect, useState } from 'react'

export function PresetPicker({ current, onLoaded }: { current: string; onLoaded: () => void }) {
  const [presets, setPresets] = useState<{ id: string; label: string }[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  useEffect(() => {
    window.api.listPresets().then(setPresets)
  }, [])

  async function load(id: string) {
    setPending(null)
    const r = await window.api.loadPreset(id)
    if (!r.ok) { setError(r.error ?? 'Preset gagal dimuat.'); return }
    setError(null)
    onLoaded()
  }

  const label = presets.find((p) => p.id === pending)?.label ?? ''
  return (
    <div className="mb-3">
      <label htmlFor="preset" className="form-label">Jenis bisnis (preset)</label>
      <select id="preset" className="form-select" value={current}
        onChange={(e) => setPending(e.target.value && e.target.value !== current ? e.target.value : null)}>
        {presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>
      <div className="form-text">Preset mengisi aturan awal yang cocok. Semua bisa diubah setelahnya.</div>
      {pending && (
        <div className="alert alert-warning mt-2 mb-0" role="alertdialog" aria-label="Konfirmasi preset">
          <p className="mb-2">
            Memuat preset <strong>{label}</strong> mengganti aturan, tujuan, dan template. Identitas, admin, dan tautan Anda tetap.
          </p>
          <div className="d-flex gap-2">
            <button type="button" className="btn btn-sm btn-primary" onClick={() => load(pending)}>Muat preset</button>
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setPending(null)}>Batal</button>
          </div>
        </div>
      )}
      {error && <div className="text-danger small mt-1" role="alert">{error}</div>}
    </div>
  )
}

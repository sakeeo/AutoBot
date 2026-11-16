import { useEffect, useState } from 'react'

export function PresetPicker({ current, onLoaded }: { current: string; onLoaded: () => void }) {
  const [presets, setPresets] = useState<{ id: string; label: string }[]>([])
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    window.api.listPresets().then(setPresets)
  }, [])

  async function choose(id: string) {
    if (!id) return
    if (!window.confirm('Memuat preset mengganti aturan, tujuan, dan template. Identitas, admin, dan tautan Anda tetap. Lanjutkan?'))
      return
    const r = await window.api.loadPreset(id)
    if (!r.ok) { setError(r.error ?? 'Preset gagal dimuat.'); return }
    setError(null)
    onLoaded()
  }

  return (
    <div className="mb-3">
      <label htmlFor="preset" className="form-label">Jenis bisnis (preset)</label>
      <select id="preset" className="form-select" value={current} onChange={(e) => choose(e.target.value)}>
        {presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>
      <div className="form-text">Preset mengisi aturan awal yang cocok. Semua bisa diubah setelahnya.</div>
      {error && <div className="text-danger small mt-1">{error}</div>}
    </div>
  )
}

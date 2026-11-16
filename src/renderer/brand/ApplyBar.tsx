import { useCallback, useEffect, useRef, useState } from 'react'
import type { Issue } from '../../shared/brand'

type ApplyResult = { ok: boolean; version?: number } | void

export function ApplyBar({ issues, dirty, onApply, onChanged }: {
  issues: Issue[]
  dirty: boolean
  onApply: () => Promise<ApplyResult>
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [versions, setVersions] = useState<{ version: number; createdAt: number }[]>([])
  const [chosen, setChosen] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const hasErrors = issues.some((i) => i.level === 'error')

  const loadVersions = useCallback(() => {
    window.api.listBrandVersions().then(setVersions)
  }, [])
  useEffect(loadVersions, [loadVersions])

  async function apply() {
    setBusy(true)
    setMessage(null)
    try {
      const r = await onApply()
      if (r && r.ok) { setMessage(`Versi ${r.version} diterapkan.`); loadVersions() }
    } finally {
      setBusy(false)
    }
  }

  async function restore() {
    const r = await window.api.restoreBrandVersion(Number(chosen))
    setMessage(r.ok ? `Versi ${chosen} dipulihkan dan diterapkan.` : r.error ?? 'Gagal memulihkan.')
    if (r.ok) { loadVersions(); onChanged() }
  }

  async function doExport() {
    const json = await window.api.exportBrand()
    const a = document.createElement('a')
    a.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(json)
    a.download = 'profil-brand.json'
    try { a.click() } catch { /* download is best-effort */ }
  }

  async function doImport(file: File | undefined) {
    if (!file) return
    const r = await window.api.importBrand(await file.text())
    setMessage(r.ok ? 'Profil diimpor sebagai draf. Periksa lalu tekan Terapkan.' : r.issues[0]?.message ?? 'Impor gagal.')
    if (r.ok) onChanged()
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div className="card mt-3">
      <div className="card-body">
        {issues.map((i, n) => (
          <div key={n} className={`alert py-2 mb-2 ${i.level === 'error' ? 'alert-danger' : 'alert-warning'}`}>
            <i className={`bi ${i.level === 'error' ? 'bi-x-octagon' : 'bi-exclamation-triangle'} me-2`} />{i.message}
          </div>
        ))}
        {message && <div className="alert alert-success py-2 mb-2">{message}</div>}

        <div className="d-flex flex-wrap gap-2 align-items-center">
          <button type="button" className="btn btn-success" disabled={hasErrors || busy} onClick={apply}>Terapkan</button>
          {dirty && <span className="small text-body-secondary">Perubahan belum diterapkan ke bot.</span>}
          <div className="ms-auto d-flex flex-wrap gap-2 align-items-center">
            <label htmlFor="versions" className="visually-hidden">Versi tersimpan</label>
            <select id="versions" className="form-select w-auto" value={chosen} onChange={(e) => setChosen(e.target.value)}>
              <option value="">Versi tersimpan…</option>
              {versions.map((v) => (
                <option key={v.version} value={v.version}>
                  v{v.version} — {new Date(v.createdAt).toLocaleString('id-ID')}
                </option>
              ))}
            </select>
            <button type="button" className="btn btn-outline-secondary" disabled={!chosen} onClick={restore}>Pulihkan</button>
            <button type="button" className="btn btn-outline-secondary" onClick={doExport}>Ekspor</button>
            <button type="button" className="btn btn-outline-secondary" onClick={() => fileRef.current?.click()}>Impor</button>
            <input ref={fileRef} type="file" accept="application/json,.json" className="d-none" aria-label="Berkas profil"
              onChange={(e) => doImport(e.target.files?.[0])} />
          </div>
        </div>
      </div>
    </div>
  )
}

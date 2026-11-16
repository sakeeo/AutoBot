import { useEffect, useState } from 'react'
import { useSettings } from '../useSettings'
import { PROVIDER_IDS, PROVIDERS, type ProviderId } from '../../shared/providers'

export function AiSettings() {
  const [settings, patch] = useSettings()
  const [hasKey, setHasKey] = useState(false)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [model, setModel] = useState<string | null>(null)
  const [baseUrl, setBaseUrl] = useState<string | null>(null)
  const providerId: ProviderId = settings?.ai.provider ?? 'claude'
  const provider = PROVIDERS[providerId]

  useEffect(() => {
    window.api.hasApiKey().then(setHasKey)
  }, [providerId])

  async function switchProvider(id: ProviderId) {
    if (!settings) return
    setError(null)
    setKey('')
    setModel(null)
    setBaseUrl(null)
    await patch({
      ai: { ...settings.ai, provider: id, model: PROVIDERS[id].defaultModel, baseUrl: id === 'custom' ? settings.ai.baseUrl ?? '' : undefined }
    })
    setHasKey(await window.api.hasApiKey())
  }

  async function save() {
    setBusy(true)
    setError(null)
    const r = await window.api.saveApiKey(key)
    setBusy(false)
    if (!r.ok) { setError(r.error ?? 'Gagal menyimpan key.'); return }
    setKey('') // the typed key never stays in the UI
    setHasKey(await window.api.hasApiKey())
  }

  async function remove() {
    await window.api.deleteApiKey()
    setHasKey(false)
    setError(null)
    window.api.getSettings().then((s) => patch({ mode: s.mode }))
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <h2 className="h4 mb-3"><i className="bi bi-stars me-2" />Connector AI (BYOK)</h2>
      <p className="text-body-secondary">
        Opsional. Tanpa AI, bot membalas dengan kutipan dokumen. Dengan AI, jawaban disusun hanya dari
        potongan dokumen yang relevan. Anda memakai API key sendiri; biaya token ditanggung Anda.
      </p>

      {settings && (
        <div className="mb-3">
          <label htmlFor="provider" className="form-label">Penyedia AI</label>
          <select id="provider" className="form-select" value={providerId}
            onChange={(e) => switchProvider(e.target.value as ProviderId)}>
            {PROVIDER_IDS.map((id) => <option key={id} value={id}>{PROVIDERS[id].label}</option>)}
          </select>
          <div className="form-text">Setiap penyedia punya API key sendiri yang disimpan terpisah.</div>
        </div>
      )}

      {providerId === 'claude' && (
        <div className="alert alert-info small">
          <i className="bi bi-info-circle me-1" />
          Langganan Claude Pro/Max <strong>tidak</strong> dapat dipakai untuk aplikasi ini. Buat API key di
          Anthropic Console (ditagih terpisah dari Pro).
        </div>
      )}

      <div className="form-check form-switch mb-4">
        <input className="form-check-input" type="checkbox" role="switch" id="ai-mode"
          disabled={!hasKey} checked={settings?.mode === 'ai'}
          onChange={(e) => patch({ mode: e.target.checked ? 'ai' : 'extractive' })} />
        <label className="form-check-label" htmlFor="ai-mode">Gunakan AI untuk menyusun jawaban</label>
        {!hasKey && <div className="form-text">Simpan API key terlebih dahulu.</div>}
      </div>

      <div className="card mb-4">
        <div className="card-body">
          <div className="d-flex align-items-center mb-3">
            {provider.consoleUrl && (
              <button className="btn btn-outline-primary me-3" onClick={() => window.api.openConsole()}>
                <i className="bi bi-box-arrow-up-right me-1" />Hubungkan ke {providerId === 'claude' ? 'Claude' : provider.label}
              </button>
            )}
            {hasKey && <span className="badge text-bg-success">Key tersimpan</span>}
          </div>
          <label htmlFor="api-key" className="form-label">API key</label>
          <div className="input-group">
            <input id="api-key" type="password" className="form-control" autoComplete="off"
              placeholder={hasKey ? 'Tempel key baru untuk mengganti' : provider.keyPlaceholder}
              value={key} onChange={(e) => setKey(e.target.value)} />
            <button className="btn btn-primary" disabled={busy || !key.trim()} onClick={save}>Uji & simpan</button>
            {hasKey && (
              <button className="btn btn-outline-danger" onClick={remove} aria-label="Hapus key">
                <i className="bi bi-trash" />
              </button>
            )}
          </div>
          {error && <div className="text-danger small mt-2">{error}</div>}
          <div className="form-text">
            Key disimpan terenkripsi di penyimpanan aman sistem operasi dan tidak pernah ditampilkan kembali.
          </div>
        </div>
      </div>

      {settings && providerId === 'custom' && (
        <div className="mb-3">
          <label htmlFor="base-url" className="form-label">URL endpoint</label>
          <input id="base-url" className="form-control" placeholder="https://host/v1 atau http://localhost:11434/v1"
            value={baseUrl ?? settings.ai.baseUrl ?? ''} onChange={(e) => setBaseUrl(e.target.value)}
            onBlur={() => baseUrl !== null && patch({ ai: { ...settings.ai, baseUrl } })} />
          <div className="form-text">Endpoint yang kompatibel dengan OpenAI (…/chat/completions), mis. Ollama atau LM Studio. Isi sebelum menyimpan key.</div>
        </div>
      )}

      {settings && (
        <div className="row g-3 mb-4">
          <div className="col-sm-8">
            <label htmlFor="model" className="form-label">Model</label>
            <input id="model" className="form-control" value={model ?? settings.ai.model}
              onChange={(e) => setModel(e.target.value)}
              onBlur={() => model && patch({ ai: { ...settings.ai, model } })} />
          </div>
          <div className="col-sm-4">
            <label htmlFor="max-tokens" className="form-label">Maks token jawaban</label>
            <input id="max-tokens" type="number" className="form-control" min={16} max={4096}
              defaultValue={settings.ai.maxTokens}
              onBlur={(e) => patch({ ai: { ...settings.ai, maxTokens: Number(e.target.value) } })} />
          </div>
        </div>
      )}

      <p className="small text-body-secondary">
        <i className="bi bi-shield-exclamation me-1" />
        Mode AI mengirim potongan dokumen yang relevan beserta pesan pelanggan ke penyedia yang Anda pilih
        ({provider.label}).
      </p>
    </div>
  )
}

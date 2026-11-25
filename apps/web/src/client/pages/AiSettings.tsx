import { ConfirmButton } from '../ui/ConfirmButton'
import { PageHeader } from '../ui/PageHeader'
import { StatusBadge } from '../ui/StatusBadge'
import { useEffect, useState } from 'react'
import { useSettings } from '../useSettings'
import { PROVIDER_IDS, PROVIDERS, type ProviderId } from '@autobot/contracts/providers'

export function AiSettings() {
  const [settings, patch] = useSettings()
  const [hasKey, setHasKey] = useState(false)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [model, setModel] = useState<string | null>(null)
  const [baseUrl, setBaseUrl] = useState<string | null>(null)
  // null = not asked yet or loading; [] = the provider gave no list, so the model name is typed by hand.
  const [models, setModels] = useState<string[] | null>(null)
  const [loadingModels, setLoadingModels] = useState(false)
  const [modelError, setModelError] = useState<string | null>(null)
  const providerId: ProviderId = settings?.ai.provider ?? 'claude'
  const provider = PROVIDERS[providerId]

  useEffect(() => {
    window.api.hasApiKey().then(setHasKey)
  }, [providerId])

  async function loadModels(): Promise<void> {
    setLoadingModels(true)
    setModelError(null)
    try {
      const r = await window.api.listModels()
      if (r.ok) setModels(r.models)
      else { setModels([]); setModelError(r.error) }
    } catch {
      setModels([])
      setModelError('Daftar model tidak bisa dimuat.')
    } finally {
      setLoadingModels(false)
    }
  }

  // Step 2 only exists once connected: fetch the list for this provider and key.
  useEffect(() => {
    setModels(null)
    setModelError(null)
    if (hasKey) void loadModels()
  }, [hasKey, providerId]) // eslint-disable-line react-hooks/exhaustive-deps

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
    // Connected: if the saved model is not one this key can use, move to a sensible one from the list.
    if (settings && r.models && r.models.length > 0) {
      setModels(r.models)
      if (!r.models.includes(settings.ai.model)) {
        const next = r.models.includes(provider.defaultModel) ? provider.defaultModel : r.models[0]
        setModel(null)
        await patch({ ai: { ...settings.ai, model: next } })
      }
    }
  }

  async function pickModel(id: string) {
    if (!settings || id === settings.ai.model) return
    await patch({ ai: { ...settings.ai, model: id } })
  }

  async function remove() {
    await window.api.deleteApiKey()
    setHasKey(false)
    setError(null)
    window.api.getSettings().then((s) => patch({ mode: s.mode }))
  }

  return (
    <div style={{ maxWidth: 840 }}>
      <PageHeader icon="bi-stars" title="Connector AI (BYOK)"
        subtitle="Opsional. Tanpa AI, bot membalas dengan kutipan dokumen. Dengan AI, jawaban disusun hanya dari potongan dokumen yang relevan. Anda memakai API key sendiri; biaya token ditanggung Anda." />

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

      <div className="card mb-4">
        <div className="card-body">
          <h3 className="h6 mb-3">1. Hubungkan</h3>
          <div className="d-flex align-items-center mb-3">
            {provider.consoleUrl && (
              <button className="btn btn-outline-primary me-3" onClick={() => window.open(provider.consoleUrl as string, '_blank', 'noopener,noreferrer')}>
                <i className="bi bi-box-arrow-up-right me-1" />Hubungkan ke {providerId === 'claude' ? 'Claude' : provider.label}
              </button>
            )}
            {hasKey && <StatusBadge tone="success">Key tersimpan</StatusBadge>}
            {hasKey && <StatusBadge tone="success">Terhubung</StatusBadge>}
          </div>
          <label htmlFor="api-key" className="form-label">API key</label>
          <div className="input-group">
            <input id="api-key" type="password" className="form-control" autoComplete="off"
              placeholder={hasKey ? 'Tempel key baru untuk mengganti' : provider.keyPlaceholder}
              value={key} onChange={(e) => setKey(e.target.value)} />
            <button className="btn btn-primary" disabled={busy || !key.trim()} onClick={save}>Hubungkan</button>
            {hasKey && (
              <ConfirmButton label="Hapus" ariaLabel="Hapus key" className="btn btn-outline-danger" onConfirm={remove}>
                <i className="bi bi-trash" aria-hidden="true" />
              </ConfirmButton>
            )}
          </div>
          {error && <div className="text-danger small mt-2" role="alert">{error}</div>}
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
        <div className="card mb-4" aria-label="Pilih model">
          <div className="card-body">
            <h3 className="h6 mb-3">2. Pilih model</h3>
            {!hasKey ? (
              <p className="text-body-secondary mb-0">Hubungkan API key dulu; daftar model yang bisa dipakai akan muncul di sini.</p>
            ) : (
              <div className="row g-3">
                <div className="col-sm-8">
                  <label htmlFor="model" className="form-label">Model</label>
                  {models !== null && models.length > 0 ? (
                    <div className="input-group">
                      <select id="model" className="form-select" value={settings.ai.model}
                        onChange={(e) => void pickModel(e.target.value)}>
                        {!models.includes(settings.ai.model) && (
                          <option value={settings.ai.model}>{settings.ai.model ? `${settings.ai.model} (tidak ada di daftar)` : 'Pilih model…'}</option>
                        )}
                        {models.map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                      <button type="button" className="btn btn-outline-secondary" aria-label="Muat ulang daftar model"
                        disabled={loadingModels} onClick={() => void loadModels()}>
                        <i className="bi bi-arrow-clockwise" aria-hidden="true" />
                      </button>
                    </div>
                  ) : models === null ? (
                    <div className="form-control-plaintext text-body-secondary" role="status">Memuat daftar model…</div>
                  ) : (
                    <>
                      <input id="model" className="form-control" value={model ?? settings.ai.model}
                        onChange={(e) => setModel(e.target.value)}
                        onBlur={() => model && patch({ ai: { ...settings.ai, model } })} />
                      <div className="form-text">
                        {modelError ? `${modelError} ` : ''}Ketik nama model secara manual.{' '}
                        <button type="button" className="btn btn-link btn-sm p-0 align-baseline" onClick={() => void loadModels()}>Coba muat daftar lagi</button>
                      </div>
                    </>
                  )}
                </div>
                <div className="col-sm-4">
                  <label htmlFor="max-tokens" className="form-label">Maks token jawaban</label>
                  <input id="max-tokens" type="number" className="form-control" min={16} max={4096}
                    defaultValue={settings.ai.maxTokens}
                    onBlur={(e) => patch({ ai: { ...settings.ai, maxTokens: Number(e.target.value) } })} />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="form-check form-switch mb-4">
        <input className="form-check-input" type="checkbox" role="switch" id="ai-mode"
          disabled={!hasKey} checked={settings?.mode === 'ai'}
          onChange={(e) => patch({ mode: e.target.checked ? 'ai' : 'extractive' })} />
        <label className="form-check-label" htmlFor="ai-mode">Gunakan AI untuk menyusun jawaban</label>
        {!hasKey && <div className="form-text">Simpan API key terlebih dahulu.</div>}
      </div>

      <div className="form-check form-switch mb-4">
        <input className="form-check-input" type="checkbox" role="switch" id="ai-memory"
          checked={settings?.memoryEnabled ?? true}
          onChange={(e) => patch({ memoryEnabled: e.target.checked })} />
        <label className="form-check-label" htmlFor="ai-memory">Ingat pelanggan lama</label>
        <div className="form-text">
          Bot menyimpan ringkasan dan fakta singkat tiap pelanggan (di komputer ini) supaya percakapan nyambung, tanpa mengirim seluruh riwayat setiap kali.
          Bisa dilihat, diubah, atau dihapus di menu Pesan.
        </div>
      </div>

      <p className="small text-body-secondary">
        <i className="bi bi-shield-exclamation me-1" />
        Mode AI mengirim potongan dokumen yang relevan beserta pesan pelanggan ke penyedia yang Anda pilih
        ({provider.label}).
      </p>
    </div>
  )
}

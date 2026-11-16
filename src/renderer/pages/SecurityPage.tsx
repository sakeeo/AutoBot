import { useSettings } from '../useSettings'

function GeneralSection() {
  const [settings, patch] = useSettings()
  if (!settings) return null
  return (
    <section className="mb-4" style={{ maxWidth: 480 }}>
      <h3 className="h5 mb-3">Umum</h3>
      <div className="mb-3">
        <label htmlFor="theme" className="form-label">Tema</label>
        <select id="theme" className="form-select" value={settings.theme}
          onChange={(e) => patch({ theme: e.target.value as 'light' | 'dark' | 'auto' })}>
          <option value="auto">Otomatis</option>
          <option value="light">Terang</option>
          <option value="dark">Gelap</option>
        </select>
      </div>
      <div className="form-check form-switch">
        <input id="autostart" type="checkbox" role="switch" className="form-check-input"
          checked={settings.autoStart} onChange={(e) => patch({ autoStart: e.target.checked })} />
        <label htmlFor="autostart" className="form-check-label">Jalankan saat login</label>
      </div>
    </section>
  )
}

export function SecurityPage() {
  return (
    <div>
      <h2 className="h4 mb-3"><i className="bi bi-shield-lock me-2" />Keamanan & Umum</h2>
      <GeneralSection />
    </div>
  )
}

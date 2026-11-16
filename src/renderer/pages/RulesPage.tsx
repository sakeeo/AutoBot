import { useState } from 'react'
import { useSettings } from '../useSettings'

export function RulesPage() {
  const [settings, patch] = useSettings()
  const [reply, setReply] = useState<string | null>(null)
  if (!settings) return null
  const ooc = settings.outOfContext

  return (
    <div style={{ maxWidth: 640 }}>
      <h2 className="h4 mb-3"><i className="bi bi-sliders me-2" />Aturan Jawaban</h2>

      <div className="mb-4">
        <label htmlFor="threshold" className="form-label">
          Ambang kecocokan: <strong>{settings.threshold.toFixed(2)}</strong>
        </label>
        <input id="threshold" type="range" className="form-range" min={0} max={1} step={0.05}
          value={settings.threshold} onChange={(e) => patch({ threshold: Number(e.target.value) })} />
        <div className="form-text">
          Makin tinggi, bot makin sering menolak (lebih aman). Makin rendah, makin sering menjawab (risiko salah).
        </div>
      </div>

      <div className="mb-3">
        <label htmlFor="ooc-action" className="form-label">Aksi di luar konteks</label>
        <select id="ooc-action" className="form-select" value={ooc.action}
          onChange={(e) =>
            patch({ outOfContext: { action: e.target.value as typeof ooc.action, replyText: ooc.replyText } })
          }>
          <option value="reply">Balas dengan teks penolakan</option>
          <option value="silent">Diam (tidak membalas)</option>
          <option value="escalate">Eskalasi ke manusia (notifikasi)</option>
        </select>
      </div>

      <div className="mb-4">
        <label htmlFor="ooc-text" className="form-label">Teks penolakan</label>
        <textarea id="ooc-text" className="form-control" rows={3} value={reply ?? ooc.replyText}
          onChange={(e) => setReply(e.target.value)}
          onBlur={() => reply !== null && patch({ outOfContext: { action: ooc.action, replyText: reply } })} />
      </div>

      <div className="form-check form-switch mb-3">
        <input id="groups" type="checkbox" role="switch" className="form-check-input"
          checked={settings.allowGroups} onChange={(e) => patch({ allowGroups: e.target.checked })} />
        <label htmlFor="groups" className="form-check-label">Izinkan menjawab di grup</label>
      </div>

      <div className="form-check form-switch mb-3">
        <input id="autostart" type="checkbox" role="switch" className="form-check-input"
          checked={settings.autoStart} onChange={(e) => patch({ autoStart: e.target.checked })} />
        <label htmlFor="autostart" className="form-check-label">Jalankan saat login</label>
      </div>

      <div className="mb-3" style={{ maxWidth: 240 }}>
        <label htmlFor="cooldown" className="form-label">Cooldown per kontak (detik)</label>
        <input id="cooldown" type="number" className="form-control" min={0} max={3600}
          defaultValue={settings.cooldownSec}
          onBlur={(e) => patch({ cooldownSec: Math.max(0, Math.round(Number(e.target.value))) })} />
      </div>
    </div>
  )
}

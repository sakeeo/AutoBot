import type { BrandProfile } from '../../shared/brand'

type Props = { draft: BrandProfile; update: (fn: (d: BrandProfile) => BrandProfile) => void }

const DAYS: { key: keyof BrandProfile['hours']['days']; label: string }[] = [
  { key: '1', label: 'Senin' }, { key: '2', label: 'Selasa' }, { key: '3', label: 'Rabu' }, { key: '4', label: 'Kamis' },
  { key: '5', label: 'Jumat' }, { key: '6', label: 'Sabtu' }, { key: '0', label: 'Minggu' }
]

export function HoursTab({ draft, update }: Props) {
  const setDay = (k: keyof BrandProfile['hours']['days'], v: { open: string; close: string } | null) =>
    update((d) => ({ ...d, hours: { ...d.hours, days: { ...d.hours.days, [k]: v } } }))
  const setLimit = (p: Partial<BrandProfile['limits']>) => update((d) => ({ ...d, limits: { ...d.limits, ...p } }))

  return (
    <div>
      <div className="mb-3" style={{ maxWidth: 320 }}>
        <label htmlFor="tz" className="form-label">Zona waktu</label>
        <select id="tz" className="form-select" value={draft.hours.timezone}
          onChange={(e) => update((d) => ({ ...d, hours: { ...d.hours, timezone: e.target.value } }))}>
          <option value="Asia/Jakarta">WIB (Asia/Jakarta)</option>
          <option value="Asia/Makassar">WITA (Asia/Makassar)</option>
          <option value="Asia/Jayapura">WIT (Asia/Jayapura)</option>
        </select>
      </div>

      <h3 className="h6">Jam kerja tim</h3>
      {DAYS.map(({ key, label }) => {
        const day = draft.hours.days[key]
        return (
          <div key={key} className="row g-2 align-items-center mb-2">
            <div className="col-2">{label}</div>
            <div className="col-auto form-check form-switch ps-5">
              <input id={`day-${key}`} type="checkbox" role="switch" className="form-check-input" checked={day !== null}
                onChange={(e) => setDay(key, e.target.checked ? { open: '09:00', close: '17:00' } : null)} />
              <label htmlFor={`day-${key}`} className="form-check-label">Buka</label>
            </div>
            {day && (
              <>
                <div className="col-auto">
                  <input type="time" aria-label={`Buka ${label}`} className="form-control" value={day.open}
                    onChange={(e) => setDay(key, { ...day, open: e.target.value })} />
                </div>
                <div className="col-auto">–</div>
                <div className="col-auto">
                  <input type="time" aria-label={`Tutup ${label}`} className="form-control" value={day.close}
                    onChange={(e) => setDay(key, { ...day, close: e.target.value })} />
                </div>
              </>
            )}
          </div>
        )
      })}

      <h3 className="h6 mt-4">Batas bot</h3>
      <div className="row g-3">
        <div className="col-md-4">
          <label htmlFor="pause" className="form-label">Jeda setelah manusia mengambil alih (jam)</label>
          <input id="pause" type="number" min={0} max={168} step={0.5} className="form-control" value={draft.limits.pauseHours}
            onChange={(e) => setLimit({ pauseHours: Math.max(0, Math.min(168, Number(e.target.value) || 0)) })} />
        </div>
        <div className="col-md-4">
          <label htmlFor="per-hour" className="form-label">Maks balasan per kontak per jam</label>
          <input id="per-hour" type="number" min={1} max={1000} className="form-control" value={draft.limits.maxRepliesPerHour}
            onChange={(e) => setLimit({ maxRepliesPerHour: Math.max(1, Math.min(1000, Math.round(Number(e.target.value) || 1))) })} />
        </div>
      </div>
    </div>
  )
}

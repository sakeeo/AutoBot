import type { DashboardDay } from '../../shared/ipc'

const W = 640
const H = 220
const PAD = { l: 32, r: 12, t: 14, b: 26 }
const SERIES = [
  { key: 'replied', label: 'Dibalas', color: 'var(--dash-main)', area: true },
  { key: 'refused', label: 'Ditolak', color: 'var(--dash-amber)', area: false },
  { key: 'handoff', label: 'Diserahkan', color: 'var(--dash-neutral)', area: false },
  { key: 'errors', label: 'Galat', color: 'var(--dash-accent)', area: false }
] as const

const niceMax = (n: number): number => {
  if (n <= 4) return 4
  const pow = Math.pow(10, Math.floor(Math.log10(n)))
  return Math.ceil(n / pow) * pow
}

/** Smooth line through the points (Catmull-Rom converted to cubic Béziers). */
function smooth(pts: [number, number][]): string {
  if (pts.length === 0) return ''
  let d = `M${pts[0][0]},${pts[0][1]}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2
    const c1: [number, number] = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2: [number, number] = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    d += ` C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`
  }
  return d
}

const weekday = (day: string): string =>
  new Date(`${day}T00:00:00`).toLocaleDateString('id-ID', { weekday: 'short' })

export function TrendChart({ data }: { data: DashboardDay[] }) {
  const max = niceMax(Math.max(0, ...data.flatMap((d) => SERIES.map((s) => d[s.key]))))
  const x = (i: number): number => PAD.l + (data.length <= 1 ? 0 : (i / (data.length - 1)) * (W - PAD.l - PAD.r))
  const y = (v: number): number => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b)
  const line = (key: (typeof SERIES)[number]['key']): [number, number][] => data.map((d, i) => [x(i), y(d[key])])
  const totals = SERIES.map((s) => ({ ...s, total: data.reduce((n, d) => n + d[s.key], 0) }))
  const summary = `Tren 7 hari: ${totals.map((t) => `${t.label} ${t.total}`).join(', ')}.`
  const base = H - PAD.b
  const replied = line('replied')
  const ticks = [0, 0.5, 1].map((f) => Math.round(max * f))

  return (
    <div className="trend">
      <ul className="trend-legend">
        {totals.map((t) => (
          <li key={t.key}><span className="dot" style={{ background: t.color }} aria-hidden="true" />{`${t.label} `}<strong>{t.total}</strong></li>
        ))}
      </ul>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} className="trend-svg" preserveAspectRatio="none">
        <defs>
          <linearGradient id="trend-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--dash-main)" stopOpacity="0.45" />
            <stop offset="100%" stopColor="var(--dash-main)" stopOpacity="0" />
          </linearGradient>
          <filter id="trend-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} />
            <text className="axis" x={PAD.l - 6} y={y(t) + 3} textAnchor="end">{t}</text>
          </g>
        ))}
        {data.map((d, i) => (
          <text key={d.day} className="axis" x={x(i)} y={H - 8} textAnchor="middle">{weekday(d.day)}</text>
        ))}
        {data.length > 1 && (
          <path d={`${smooth(replied)} L${x(data.length - 1)},${base} L${x(0)},${base} Z`} fill="url(#trend-area)" />
        )}
        {SERIES.map((s) => (
          <path key={s.key} className="trend-line" d={smooth(line(s.key))} stroke={s.color} pathLength={1}
            filter={s.area ? 'url(#trend-glow)' : undefined} strokeWidth={s.area ? 2.5 : 1.75} fill="none" />
        ))}
        {data.map((d, i) => (
          <circle key={d.day} className="trend-dot" cx={x(i)} cy={y(d.replied)} r="3.5" fill="var(--dash-main)">
            <title>{`${weekday(d.day)} ${d.day}: ${d.replied} dibalas, ${d.refused} ditolak, ${d.handoff} diserahkan, ${d.errors} galat`}</title>
          </circle>
        ))}
      </svg>
    </div>
  )
}

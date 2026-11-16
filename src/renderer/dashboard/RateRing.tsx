import { Counter } from './useCountUp'

const R = 54
const C = 2 * Math.PI * R

/** Share of handled messages the bot answered itself, as a glowing ring. */
export function RateRing({ replied, total, label }: { replied: number; total: number; label: string }) {
  const pct = total > 0 ? Math.round((replied / total) * 100) : 0
  const text = total > 0 ? `${pct}% dari ${total} pesan dibalas bot` : 'Belum ada pesan'
  return (
    <figure className="rate-ring" role="img" aria-label={`${label}: ${text}`}>
      <svg viewBox="0 0 140 140" aria-hidden="true">
        <defs>
          <linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--dash-main)" />
            <stop offset="100%" stopColor="var(--dash-accent)" />
          </linearGradient>
        </defs>
        <circle className="ring-track" cx="70" cy="70" r={R} />
        <circle className="ring-value" cx="70" cy="70" r={R} stroke="url(#ring-grad)"
          strokeDasharray={C} strokeDashoffset={C * (1 - pct / 100)} transform="rotate(-90 70 70)" />
      </svg>
      <figcaption className="ring-center">
        <span className="ring-pct">{total > 0 ? <><Counter value={pct} />%</> : '–'}</span>
        <span className="ring-label">{label}</span>
      </figcaption>
    </figure>
  )
}

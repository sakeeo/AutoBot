/**
 * Login backdrop: an abstract neural network drawn in code, so it ships with the app (no photo to license or download).
 * Layers of nodes, faint links, a few links that pulse, and the brand's vermilion on the "hot" nodes.
 */
const W = 1200
const H = 800
const LAYERS = [4, 7, 9, 7, 4]

// Small deterministic jitter so the net looks organic but renders the same every time.
const jitter = (i: number, j: number): number => {
  const v = Math.sin(i * 127.1 + j * 311.7) * 43758.5453
  return (v - Math.floor(v)) - 0.5
}

const nodes = LAYERS.flatMap((count, li) =>
  Array.from({ length: count }, (_, ni) => {
    const x = 120 + (li / (LAYERS.length - 1)) * (W - 240) + jitter(li, ni) * 40
    const y = 90 + ((ni + 0.5) / count) * (H - 180) + jitter(ni, li) * 36
    return { id: `${li}-${ni}`, li, x, y, hot: (li * 7 + ni * 3) % 11 === 0 }
  })
)
const links = nodes.flatMap((a) =>
  nodes.filter((b) => b.li === a.li + 1 && Math.abs(jitter(a.li * 31 + a.x, b.y)) < 0.2 && Math.abs(a.y - b.y) < 260).map((b) => ({ a, b }))
)

export function AiBackdrop() {
  return (
    <svg className="ai-backdrop" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="ai-glow" cx="30%" cy="35%" r="70%">
          <stop offset="0%" className="ai-glow-a" />
          <stop offset="100%" className="ai-glow-b" />
        </radialGradient>
        <filter id="ai-blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5" /></filter>
      </defs>
      <rect width={W} height={H} fill="url(#ai-glow)" />
      <g className="ai-links">
        {links.map(({ a, b }, i) => (
          <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={i % 6 === 0 ? 'ai-link ai-pulse' : 'ai-link'}
            style={i % 6 === 0 ? { animationDelay: `${(i % 5) * 0.7}s` } : undefined} />
        ))}
      </g>
      <g>
        {nodes.filter((n) => n.hot).map((n) => <circle key={`g${n.id}`} cx={n.x} cy={n.y} r="16" className="ai-halo" filter="url(#ai-blur)" />)}
        {nodes.map((n) => <circle key={n.id} cx={n.x} cy={n.y} r={n.hot ? 6 : 3.5} className={n.hot ? 'ai-node ai-hot' : 'ai-node'} />)}
      </g>
    </svg>
  )
}

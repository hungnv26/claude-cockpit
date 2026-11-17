interface Props {
  used: number
  limit: number
  /** Grow into the space when this is the only session on screen. */
  solo?: boolean
}

const R = 34
const CIRC = 2 * Math.PI * R

export function ContextRing({ used, limit, solo }: Props) {
  const pct = limit > 0 ? Math.min(1, used / limit) : 0
  const shown = Math.round(pct * 100)
  const hot = pct >= 0.8
  const stroke = hot ? '#e06c6c' : '#d97757'
  const box = solo ? '11rem' : '5rem'

  return (
    <div className="relative shrink-0" style={{ width: box, height: box }}>
      <svg viewBox="0 0 80 80" className="w-full h-full">
        <circle cx="40" cy="40" r={R} fill="none" stroke="#2a3242" strokeWidth="7" />
        <circle
          cx="40"
          cy="40"
          r={R}
          fill="none"
          stroke={stroke}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={CIRC}
          strokeDashoffset={CIRC * (1 - pct)}
          transform="rotate(-90 40 40)"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span
          className={`${solo ? 'text-5xl' : 'text-xl'} tabular-nums ${
            hot ? 'text-warn' : 'text-ink-text'
          }`}
        >
          {shown}
          <span className={`text-ink-faint ${solo ? 'text-xl' : 'text-xs'}`}>%</span>
        </span>
      </div>
    </div>
  )
}

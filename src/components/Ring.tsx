import type { ReactNode } from 'react'
import { C } from '../theme.ts'

const R = 40
const CIRC = 2 * Math.PI * R

/** A circular gauge: `pct` of the ring filled in `color`, with content centred. */
export function Ring({
  pct,
  color,
  size,
  children,
}: {
  pct: number
  color: string
  /** CSS length for width and height. */
  size: string
  children: ReactNode
}) {
  const p = Math.max(0, Math.min(100, pct)) / 100
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg viewBox="0 0 96 96" className="w-full h-full">
        <circle cx="48" cy="48" r={R} fill="none" stroke={C.track} strokeWidth="8" />
        {p > 0 && (
          <circle
            cx="48"
            cy="48"
            r={R}
            fill="none"
            stroke={color}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={CIRC}
            strokeDashoffset={CIRC * (1 - p)}
            transform="rotate(-90 48 48)"
          />
        )}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  )
}

import { until } from '../format.ts'
import { C } from '../theme.ts'
import type { LimitsView } from '../ws.ts'
import { Ring } from './Ring.tsx'

interface Props {
  limits: LimitsView
  now: number
  /** Smaller rings so three fit across a portrait phone. */
  compact?: boolean
}

function Gauge({
  label,
  pct,
  resets,
  accent,
  hot,
  compact,
}: {
  label: string
  pct: number
  resets: string | null
  accent: boolean
  hot: boolean
  compact?: boolean
}) {
  // Model-scoped limits get their own hue, on the ring as well as the label.
  const color = accent ? C.amber : C.clay
  return (
    <div className="flex flex-col items-center gap-1">
      <Ring pct={pct} color={hot ? C.warn : color} size={compact ? '6rem' : '6.5rem'}>
        <span className={`${compact ? 'text-2xl' : 'text-3xl'} tabular-nums ${hot ? 'text-warn' : 'text-ink-text'}`}>
          {Math.round(pct)}
          <span className={`text-ink-faint ${compact ? 'text-xs' : 'text-base'}`}>%</span>
        </span>
      </Ring>
      <div className={`${compact ? 'text-xs' : 'text-sm'} ${accent ? 'text-amber' : 'text-ink-muted'}`}>
        {label}
      </div>
      <div className="text-xs text-ink-faint tabular-nums h-4">
        {resets ? `resets ${resets}` : ''}
      </div>
    </div>
  )
}

/**
 * The hero: usage-against-limit is the first thing you want from across the desk,
 * so the gauges lead. Model-scoped limits (Fable) render in amber to stand out
 * from the two headline windows.
 */
export function LimitsHero({ limits, now, compact }: Props) {
  if (limits.state !== 'ok') {
    return (
      <div className="flex items-center justify-center py-6 text-sm text-ink-muted">
        plan usage — {limits.detail ?? limits.state}
      </div>
    )
  }
  const headline = new Set(['5-hour', '7-day'])
  return (
    <div className={`flex items-start justify-around gap-2 flex-wrap py-2`}>
      {limits.limits.map((l) => (
        <Gauge
          key={l.key}
          label={l.label}
          pct={l.utilization}
          resets={until(l.resetsAt, now)}
          accent={!headline.has(l.label)}
          hot={l.severity !== 'normal' || l.utilization >= 80}
          compact={compact}
        />
      ))}
    </div>
  )
}

import { clock } from '../format.ts'
import type { LimitsView, UsageLimit } from '../ws.ts'

interface Props {
  limits: LimitsView
  now: number
  block?: boolean
}

const W = 100
const H = 20

/**
 * One limit: usage so far across its window as a line, the forecast to reset
 * as a dashed line, and the 100% ceiling. x spans the whole window, so where
 * "now" sits on the axis shows how much of the window is left.
 */
function Spark({ l, now, hot }: { l: UsageLimit; now: number; hot: boolean }) {
  const end = l.resetsAt ? Date.parse(l.resetsAt) : NaN
  const start = l.windowStart
  if (start === null || Number.isNaN(end) || end <= start) return null
  const x = (t: number) => ((Math.min(Math.max(t, start), end) - start) / (end - start)) * W
  const y = (u: number) => H - (Math.min(u, 100) / 100) * H

  // The window opened at 0%; anchor the line there, then the samples, then now.
  const pts: [number, number][] = [[start, 0], ...l.history, [now, l.utilization]]
  const line = pts.map(([t, u]) => `${x(t).toFixed(2)},${y(u).toFixed(2)}`).join(' ')

  const p = l.pace
  let proj: string | null = null
  if (p) {
    const [tEnd, uEnd] = p.hitsAt !== null ? [p.hitsAt, 100] : [end, p.atReset ?? l.utilization]
    proj = `${x(now).toFixed(2)},${y(l.utilization).toFixed(2)} ${x(tEnd).toFixed(2)},${y(uEnd).toFixed(2)}`
  }
  const stroke = hot ? '#d9a441' : '#d97757'

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-5 block">
      <line x1="0" y1="0.5" x2={W} y2="0.5" stroke="#26262b" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      <line x1="0" y1={H - 0.5} x2={W} y2={H - 0.5} stroke="#26262b" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      {proj && (
        <polyline
          points={proj}
          fill="none"
          stroke={stroke}
          strokeWidth="1.5"
          strokeDasharray="3 3"
          strokeOpacity="0.6"
          vectorEffect="non-scaling-stroke"
        />
      )}
      <polyline points={line} fill="none" stroke={stroke} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function forecast(l: UsageLimit, now: number): { text: string; hot: boolean } {
  if (!l.resetsAt) return { text: 'window not started', hot: false }
  const p = l.pace
  if (!p) return { text: 'gathering pace…', hot: false }
  if (p.hitsAt !== null) return { text: `100% ~${clock(p.hitsAt, now)}`, hot: true }
  const at = Math.round(p.atReset ?? l.utilization)
  if (p.ratePerHour < 0.05) return { text: `steady · ${at}% at reset`, hot: false }
  return { text: `≈${at}% at reset`, hot: at >= 80 }
}

function rate(r: number): string {
  if (r < 0.05) return '0%/h'
  return r < 10 ? `${r.toFixed(1)}%/h` : `${Math.round(r)}%/h`
}

/**
 * Where each plan limit is heading: at the current rate, does it run out
 * before it resets — and if so, when.
 */
export function PacePanel({ limits, now, block }: Props) {
  return (
    <section className="flex flex-col shrink-0 border-t border-ink-line">
      <h2 className="flex items-baseline justify-between gap-2 text-xs px-3 pt-2 text-ink-faint">
        <span>pace</span>
        <span>at this rate, by reset</span>
      </h2>
      {limits.state !== 'ok' || limits.limits.length === 0 ? (
        <p className="text-xs text-ink-faint px-3 py-2">No usage data.</p>
      ) : (
        <ul className="px-3 pb-1 flex flex-col">
          {limits.limits.map((l) => {
            const f = forecast(l, now)
            return (
              <li key={l.key} className="py-1.5 flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-2 text-xs whitespace-nowrap">
                  <span className="text-ink-muted shrink-0">
                    {l.label}
                    {l.pace && <span className="text-ink-faint"> · {rate(l.pace.ratePerHour)}</span>}
                  </span>
                  <span className={`tabular-nums truncate min-w-0 ${f.hot ? 'text-warn' : 'text-ink-faint'}`}>
                    {f.text}
                  </span>
                </div>
                <Spark l={l} now={now} hot={f.hot} />
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

import { C } from '../theme.ts'
import type { MachineView } from '../ws.ts'
import { Ring } from './Ring.tsx'

interface Props {
  machine: MachineView | null
  /** Full-width section in the portrait stack, vs. the right half in landscape. */
  block?: boolean
  /** Smaller rings so three fit across a portrait phone. */
  compact?: boolean
}

/** Past these the reading turns to the warning colour. */
const HOT_PCT = 90
const HOT_TEMP = 85
const HOUR = 60 * 60 * 1000

function Gauge({
  label,
  value,
  unit,
  pct,
  color,
  hot,
  compact,
}: {
  label: string
  value: number | null
  unit: string
  pct: number
  color: string
  hot: boolean
  compact?: boolean
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <Ring pct={value === null ? 0 : pct} color={hot ? C.warn : color} size={compact ? '6rem' : '6.5rem'}>
        <span className={`${compact ? 'text-2xl' : 'text-3xl'} tabular-nums ${hot ? 'text-warn' : 'text-ink-text'}`}>
          {value === null ? '—' : Math.round(value)}
          {value !== null && <span className={`text-ink-faint ${compact ? 'text-xs' : 'text-base'}`}>{unit}</span>}
        </span>
      </Ring>
      <div className={compact ? 'text-xs' : 'text-sm'} style={{ color }}>
        {label}
      </div>
    </div>
  )
}

function Bar({
  label,
  used,
  total,
  unit,
  color,
}: {
  label: string
  used: number
  total: number
  unit: number
  color: string
}) {
  const share = total > 0 ? Math.min(1, used / total) : 0
  const hot = share * 100 >= HOT_PCT
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-8 shrink-0" style={{ color }}>
        {label}
      </span>
      <span className="flex-1 h-2 rounded overflow-hidden" style={{ backgroundColor: C.track }}>
        <span
          className="block h-full rounded"
          style={{ width: `${share * 100}%`, backgroundColor: hot ? C.warn : color }}
        />
      </span>
      <span className="tabular-nums whitespace-nowrap shrink-0">
        <span className={hot ? 'text-warn' : 'text-ink-text'}>{Math.round(used / unit)}</span>
        <span className="text-ink-faint"> / {Math.round(total / unit)} GB</span>
      </span>
    </div>
  )
}

const W = 100
const H = 40

/** CPU, GPU and temperature over the last hour, all on a 0–100 scale. */
function History({ history }: { history: MachineView['history'] }) {
  const end = history.length ? history[history.length - 1][0] : 0
  const x = (t: number) => (Math.max(0, 1 - (end - t) / HOUR) * W).toFixed(2)
  const y = (v: number) => (H - (Math.max(0, Math.min(100, v)) / 100) * H).toFixed(2)
  const line = (i: 1 | 2 | 3) =>
    history
      .filter((s) => s[i] !== null && end - s[0] <= HOUR)
      .map((s) => `${x(s[0])},${y(s[i] as number)}`)
      .join(' ')
  const series: [1 | 2 | 3, string][] = [
    [2, C.violet],
    [3, C.rose],
    [1, C.teal],
  ]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-full block">
      {[0.5, H / 2, H - 0.5].map((v) => (
        <line key={v} x1="0" y1={v} x2={W} y2={v} stroke={C.track} strokeWidth="1" vectorEffect="non-scaling-stroke" />
      ))}
      {series.map(([i, color]) => (
        <polyline
          key={i}
          points={line(i)}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  )
}

/**
 * The Mac this runs on: is it working hard, running hot, or running out of
 * room. Each metric keeps one colour everywhere it appears.
 */
export function MachinePanel({ machine, block, compact }: Props) {
  const m = machine
  return (
    <section
      className={`flex flex-col min-h-0 min-w-0 ${
        block ? 'shrink-0 border-t border-ink-line' : 'flex-1 border-l border-ink-line'
      }`}
    >
      <h2 className="flex items-baseline justify-between gap-2 text-xs px-3 pt-2">
        <span className="text-teal">machine</span>
        <span className="text-ink-faint">{m?.model ?? ''}</span>
      </h2>
      {!m ? (
        <p className="text-xs text-ink-faint px-3 py-2">Waiting for readings…</p>
      ) : (
        <>
          <div className={`flex items-start justify-around gap-2 ${compact ? 'py-3' : 'py-3'}`}>
            <Gauge label="cpu" value={m.cpu} unit="%" pct={m.cpu ?? 0} color={C.teal} hot={(m.cpu ?? 0) >= HOT_PCT} compact={compact} />
            <Gauge label="gpu" value={m.gpu} unit="%" pct={m.gpu ?? 0} color={C.violet} hot={(m.gpu ?? 0) >= HOT_PCT} compact={compact} />
            <Gauge label="temp" value={m.temp} unit="°" pct={m.temp ?? 0} color={C.rose} hot={(m.temp ?? 0) >= HOT_TEMP} compact={compact} />
          </div>
          <div className="flex flex-col gap-2 px-3 pb-3">
            {m.ram && <Bar label="ram" used={m.ram.used} total={m.ram.total} unit={2 ** 30} color={C.blue} />}
            {m.disk && <Bar label="ssd" used={m.disk.used} total={m.disk.total} unit={1e9} color={C.amber} />}
          </div>
          <div className={`flex flex-col gap-1 px-3 pb-3 border-t border-ink-line pt-2 ${block ? '' : 'flex-1 min-h-0'}`}>
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="text-ink-faint">last hour</span>
              <span className="flex gap-3">
                <span style={{ color: C.teal }}>cpu</span>
                <span style={{ color: C.violet }}>gpu</span>
                <span style={{ color: C.rose }}>temp</span>
              </span>
            </div>
            <div className={block ? 'h-16' : 'flex-1 min-h-[3rem] max-h-40'}>
              {m.history.length > 1 ? (
                <History history={m.history} />
              ) : (
                <p className="text-xs text-ink-faint">Gathering history…</p>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  )
}

import { tokens } from '../format.ts'
import type { ContextBreakdown } from '../ws.ts'

interface Props {
  used: number
  limit: number
  /** null while the cwd's overhead is still being probed. */
  context: ContextBreakdown | null
}

/**
 * Bar order and colours follow the Claude Code CLI's own context readout, so the
 * wall board and the terminal read the same way. Messages takes the accent: it's
 * the only segment that grows during a session.
 */
const SEGMENTS: { key: string; label: string; color: string }[] = [
  { key: 'system-prompt', label: 'system prompt', color: '#8296c8' },
  { key: 'system-tools', label: 'tools', color: '#86c3c3' },
  { key: 'mcp-tools', label: 'mcp tools', color: '#a48be0' },
  { key: 'custom-agents', label: 'agents', color: '#94c784' },
  { key: 'memory-files', label: 'memory files', color: '#dcc56c' },
  { key: 'skills', label: 'skills', color: '#dca3bd' },
  { key: 'messages', label: 'messages', color: '#d97757' },
]
/** Rows the CLI may add that belong with an existing segment. */
const ALIAS: Record<string, string> = {
  'mcp-server-instructions': 'mcp-tools',
}
const OTHER = { key: 'other', label: 'other', color: '#6e6e78' }
const FREE = '#363b4b'
/** Past the compaction point — reserved, never filled. */
const RESERVED = '#1b1b1f'
const MARKER = '#dcc56c'
const OK = '#5fae6e'

function pct(n: number, limit: number): string {
  if (limit <= 0) return ''
  const p = (n / limit) * 100
  if (p > 0 && p < 0.1) return '<0.1%'
  return p < 0.95 ? `${p.toFixed(1)}%` : `${Math.round(p)}%`
}

export function ContextBar({ used, limit, context }: Props) {
  const reserve = context?.autocompact ?? 0
  const compactAt = Math.max(0, limit - reserve)
  const share = limit > 0 ? Math.min(1, used / limit) : 0
  const hot = share >= 0.8

  // Fold aliases into their segment and anything unrecognised into "other", so
  // the bar always sums to the real total even when the CLI adds a category.
  const known = new Set(SEGMENTS.map((s) => s.key))
  const byKey = new Map<string, number>()
  for (const i of context?.items ?? []) {
    const k = ALIAS[i.key] ?? (known.has(i.key) ? i.key : OTHER.key)
    byKey.set(k, (byKey.get(k) ?? 0) + i.tokens)
  }
  const rows = context
    ? [...SEGMENTS, OTHER].map((s) => ({ ...s, tokens: byKey.get(s.key) ?? 0 })).filter((r) => r.tokens > 0)
    : // Breakdown not probed yet: one undifferentiated "used" segment.
      [{ key: 'used', label: 'used', color: '#d97757', tokens: used }]
  const free = Math.max(0, compactAt - used)
  const w = (n: number) => `${limit > 0 ? (n / limit) * 100 : 0}%`

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-x-4 gap-y-1 flex-wrap text-base">
        <span className="flex items-baseline gap-2 shrink-0">
          <span className="text-accent text-sm">◆</span>
          <span className="text-ink-text">context</span>
        </span>
        <span className="flex items-center gap-2 shrink-0 tabular-nums">
          <span className="text-ink-text">{tokens(used)}</span>
          <span className="text-ink-faint">of {tokens(limit)}</span>
          {context && (
            <span className="text-ink-faint">· compacts at {tokens(compactAt)}</span>
          )}
          <span
            className="px-1.5 rounded text-ink-bg"
            style={{ backgroundColor: hot ? '#d9a441' : OK }}
          >
            {Math.round(share * 100)}%
          </span>
        </span>
      </div>

      <div className="relative flex h-5 rounded overflow-hidden" style={{ backgroundColor: RESERVED }}>
        {rows.map((r) => (
          <span
            key={r.key}
            className="block h-full shrink-0"
            style={{ width: w(r.tokens), backgroundColor: r.color, minWidth: 3 }}
          />
        ))}
        <span className="block h-full shrink-0" style={{ width: w(free), backgroundColor: FREE }} />
        {context && reserve > 0 && (
          <span
            className="absolute top-0 bottom-0 w-0.5"
            style={{ left: w(compactAt), backgroundColor: MARKER }}
            title={`auto-compacts at ${tokens(compactAt)}`}
          />
        )}
      </div>

      <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center gap-2 whitespace-nowrap">
            <span className="w-2.5 h-4 rounded-sm shrink-0" style={{ backgroundColor: r.color }} />
            <span className="text-ink-muted">{r.label}</span>
            <span className="text-ink-text tabular-nums">{tokens(r.tokens)}</span>
            <span className="text-ink-faint tabular-nums">{pct(r.tokens, limit)}</span>
          </li>
        ))}
        <li className="flex items-center gap-2 whitespace-nowrap">
          <span className="w-2.5 h-4 rounded-sm shrink-0" style={{ backgroundColor: FREE }} />
          <span className="text-ink-muted">free</span>
          <span className="text-ink-text tabular-nums">{tokens(free)}</span>
        </li>
        {!context && <li className="text-ink-faint">estimating breakdown…</li>}
      </ul>
    </div>
  )
}

import { tokens } from '../format.ts'
import type { ContextItem, SessionView } from '../ws.ts'

interface Props {
  /** The session in focus; null when nothing is running. */
  session: SessionView | null
  /** Full-width section below the sessions (portrait), vs. a fixed side rail. */
  block?: boolean
}

/**
 * One swatch per headline category, matching the desktop app's panel so the two
 * read the same at a glance. Everything folded into "Other" shares one grey.
 */
const SWATCH: Record<string, string> = {
  messages: '#4f8ef7',
  'mcp-tools': '#d9603b',
  'system-tools': '#3fa374',
  skills: '#d9a441',
  'system-prompt': '#8a8a93',
  other: '#5c5c66',
}
const DEFAULT_SWATCH = '#6e6e78'

/** Rows smaller than this fold into "Other" — they'd only be noise on a wall board. */
const FOLD_BELOW_SHARE = 0.02
const FOLD_BELOW_TOKENS = 1_500

interface Row extends ContextItem {
  color: string
}

/**
 * Messages always shows. Any other row under the threshold folds into "Other",
 * unless only one would fold — then there's nothing to gain by hiding it.
 */
function foldSmall(items: ContextItem[], used: number): Row[] {
  const threshold = Math.max(FOLD_BELOW_TOKENS, used * FOLD_BELOW_SHARE)
  const keep: ContextItem[] = []
  const small: ContextItem[] = []
  for (const it of items) {
    if (it.key === 'messages' || it.tokens >= threshold) keep.push(it)
    else small.push(it)
  }
  const rows = small.length >= 2 ? keep : [...keep, ...small]
  const out: Row[] = rows.map((it) => ({ ...it, color: SWATCH[it.key] ?? DEFAULT_SWATCH }))
  if (small.length >= 2) {
    out.push({
      key: 'other',
      label: `Other (${small.length})`,
      tokens: small.reduce((n, it) => n + it.tokens, 0),
      color: SWATCH.other,
    })
  }
  return out
}

function pct(n: number, limit: number): string {
  if (limit <= 0) return '—'
  const p = (n / limit) * 100
  return p > 0 && p < 0.1 ? '<0.1%' : `${p.toFixed(1)}%`
}

export function ContextPanel({ session, block }: Props) {
  const u = session?.usage ?? null
  const ctx = session?.context ?? null
  const used = u?.contextTokens ?? 0
  const limit = u?.contextLimit ?? 0
  const rows = ctx ? foldSmall(ctx.items, used) : []
  const free = ctx ? Math.max(0, limit - used - ctx.autocompact) : 0
  const hot = limit > 0 && used / limit >= 0.8

  return (
    <aside
      className={`flex flex-col ${
        block ? 'w-full border-t border-ink-line' : 'w-64 shrink-0 border-l border-ink-line'
      }`}
    >
      {/* The footer bar already carries the %, so the rail header keeps just the fraction. */}
      <h2 className="flex items-baseline justify-between gap-2 text-xs px-3 py-2 border-b border-ink-line whitespace-nowrap">
        <span className="text-ink-faint">context</span>
        {u && (
          <span className={`tabular-nums ${hot ? 'text-warn' : 'text-ink-muted'}`}>
            {tokens(used)} / {tokens(limit)}
          </span>
        )}
      </h2>

      <div className="flex-1 overflow-y-auto">
        {!session ? (
          <p className="text-xs text-ink-faint px-3 py-2">No session.</p>
        ) : !ctx ? (
          <p className="text-xs text-ink-faint px-3 py-2">Estimating…</p>
        ) : (
          <>
            {/* Stacked bar: one segment per row, in row order, over the whole window. */}
            <div className="px-3 pt-3 pb-1">
              <div className="flex h-2 rounded-full overflow-hidden bg-ink-raised border border-ink-line">
                {rows.map((r) => (
                  <span
                    key={r.key}
                    className="block h-full"
                    style={{
                      width: `${limit > 0 ? (r.tokens / limit) * 100 : 0}%`,
                      backgroundColor: r.color,
                      minWidth: r.tokens > 0 ? 2 : 0,
                    }}
                  />
                ))}
              </div>
            </div>

            <ul className="px-3 py-1">
              {rows.map((r) => (
                <li key={r.key} className="flex items-center gap-2 py-1 text-xs">
                  <span
                    className="w-2.5 h-2.5 rounded-sm shrink-0"
                    style={{ backgroundColor: r.color }}
                  />
                  <span className="flex-1 min-w-0 truncate text-ink-text">{r.label}</span>
                  <span className="tabular-nums text-ink-faint shrink-0">{tokens(r.tokens)}</span>
                  <span className="tabular-nums text-ink-muted shrink-0 w-12 text-right">
                    {pct(r.tokens, limit)}
                  </span>
                </li>
              ))}
              <li className="flex items-center gap-2 py-1 text-xs mt-1 pt-2 border-t border-ink-line/50">
                <span className="w-2.5 h-2.5 rounded-sm shrink-0 bg-ink-raised border border-ink-line" />
                <span className="flex-1 min-w-0 truncate text-ink-muted">Autocompact</span>
                <span className="tabular-nums text-ink-faint shrink-0">{tokens(ctx.autocompact)}</span>
                <span className="tabular-nums text-ink-faint shrink-0 w-12 text-right">
                  {pct(ctx.autocompact, limit)}
                </span>
              </li>
              <li className="flex items-center gap-2 py-1 text-xs">
                <span className="w-2.5 h-2.5 rounded-sm shrink-0 border border-ink-line" />
                <span className="flex-1 min-w-0 truncate text-ink-muted">Free space</span>
                <span className="tabular-nums text-ink-faint shrink-0">{tokens(free)}</span>
                <span className="tabular-nums text-ink-faint shrink-0 w-12 text-right">
                  {pct(free, limit)}
                </span>
              </li>
            </ul>

            <p className="text-xs text-ink-faint px-3 py-2 truncate">
              est. · {session.title ?? session.name ?? session.sessionId.slice(0, 8)}
            </p>
          </>
        )}
      </div>
    </aside>
  )
}

const LABELS: Record<string, string> = {
  'claude-fable-5-1': 'Fable 5.1',
  'claude-opus-5-5': 'Opus 5.5',
  'claude-opus-5': 'Opus 5',
  'claude-opus-4-8': 'Opus 4.8',
  'claude-opus-4-7': 'Opus 4.7',
  'claude-sonnet-5': 'Sonnet 5',
  'claude-sonnet-4-6': 'Sonnet 4.6',
  'claude-haiku-4-5': 'Haiku 4.5',
  'claude-fable-5': 'Fable 5',
}

export function modelLabel(model: string | null): string {
  if (!model) return 'waiting'
  const long = model.endsWith('[1m]')
  const base = model.replace(/\[1m\]$/, '')
  const label = LABELS[base] ?? base
  return long ? `${label} 1M` : label
}

/** Matches the Claude Code CLI: 744, 3.4k, 186k, 1M, 1.25M. */
export function tokens(n: number): string {
  if (n >= 1_000_000) return `${Number((n / 1_000_000).toFixed(2))}M`
  if (n >= 10_000) return `${Math.round(n / 1_000)}k`
  if (n >= 1_000) return `${Number((n / 1_000).toFixed(1))}k`
  return String(n)
}

export function homeRelative(cwd: string): string {
  return cwd.replace(/^\/Users\/[^/]+/, '~')
}

/** "2h 14m" until an ISO timestamp, for limit reset windows. */
export function until(iso: string | null, now: number): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  const s = Math.round((t - now) / 1000)
  if (s <= 0) return 'now'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export function ago(ts: number | null, now: number): string {
  if (!ts) return '—'
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 10) return 'now'
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

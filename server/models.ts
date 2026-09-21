import { getToken, OAUTH_BETA } from './credential.ts'

const MODELS_URL = 'https://api.anthropic.com/v1/models?limit=50'
/** Model specs change on the order of months; a daily refresh is plenty. */
const REFRESH_MS = 24 * 60 * 60 * 1000

/**
 * Fallback only — used before the first fetch lands, or when no live token
 * exists. Verified against the Models API on 2026-07-17. Note that nearly every
 * current model is 1M, not 200k; hardcoding 200k under-reports context by 5x.
 */
const FALLBACK: Record<string, number> = {
  'claude-fable-5-1': 1_000_000,
  'claude-opus-5': 1_000_000,
  'claude-opus-4-8': 1_000_000,
  'claude-opus-4-7': 1_000_000,
  'claude-opus-4-6': 1_000_000,
  'claude-opus-4-5': 200_000,
  'claude-opus-4-1': 200_000,
  'claude-sonnet-5': 1_000_000,
  'claude-sonnet-4-6': 1_000_000,
  'claude-sonnet-4-5': 1_000_000,
  'claude-fable-5': 1_000_000,
  'claude-haiku-4-5': 200_000,
}

const DEFAULT_LIMIT = 200_000

const LABELS: Record<string, string> = {
  'claude-fable-5-1': 'Fable 5.1',
  'claude-opus-5': 'Opus 5',
  'claude-opus-4-8': 'Opus 4.8',
  'claude-opus-4-7': 'Opus 4.7',
  'claude-opus-4-6': 'Opus 4.6',
  'claude-opus-4-5': 'Opus 4.5',
  'claude-sonnet-5': 'Sonnet 5',
  'claude-sonnet-4-6': 'Sonnet 4.6',
  'claude-sonnet-4-5': 'Sonnet 4.5',
  'claude-haiku-4-5': 'Haiku 4.5',
  'claude-fable-5': 'Fable 5',
}

/** Claude Code appends "[1m]" to select a long-context variant. */
function baseModel(model: string): string {
  return model.replace(/\[1m\]$/, '')
}

export function labelFor(model: string | null): string {
  if (!model) return 'waiting'
  const long = model.endsWith('[1m]')
  const base = baseModel(model)
  const label = LABELS[base] ?? base
  return long ? `${label} 1M` : label
}

/**
 * Context windows come from the live Models API rather than a hardcoded table —
 * the table was wrong by 5x for Opus 4.8, and would silently rot again.
 */
export class ModelCatalog {
  private live: Record<string, number> | null = null
  private timer: NodeJS.Timeout | null = null

  start(onChange: () => void): void {
    const tick = () =>
      void this.refresh().then((changed) => {
        if (changed) onChange()
      })
    tick()
    this.timer = setInterval(tick, REFRESH_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }

  /** True while limits come from the fallback table rather than the API. */
  get isFallback(): boolean {
    return this.live === null
  }

  limitFor(model: string | null): number {
    if (!model) return DEFAULT_LIMIT
    if (model.endsWith('[1m]')) return 1_000_000
    const base = baseModel(model)
    const table = this.live ?? FALLBACK

    if (table[base] !== undefined) return table[base]
    // The API returns dated ids (claude-haiku-4-5-20251001) while transcripts
    // carry the alias (claude-haiku-4-5). Match either direction.
    for (const [id, limit] of Object.entries(table)) {
      if (id.startsWith(base) || base.startsWith(id)) return limit
    }
    return FALLBACK[base] ?? DEFAULT_LIMIT
  }

  private async refresh(): Promise<boolean> {
    const tok = await getToken()
    if (tok.state !== 'ok') return false
    try {
      const res = await fetch(MODELS_URL, {
        headers: {
          authorization: `Bearer ${tok.accessToken}`,
          'anthropic-beta': OAUTH_BETA,
          'anthropic-version': '2023-06-01',
        },
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) return false
      const body: any = await res.json()
      if (!Array.isArray(body?.data)) return false

      const next: Record<string, number> = {}
      for (const m of body.data) {
        if (typeof m?.id === 'string' && typeof m?.max_input_tokens === 'number') {
          next[m.id] = m.max_input_tokens
        }
      }
      if (Object.keys(next).length === 0) return false
      const changed = JSON.stringify(next) !== JSON.stringify(this.live)
      this.live = next
      return changed
    } catch {
      return false // keep the fallback; never break the dashboard over this
    }
  }
}

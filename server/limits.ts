import fs from 'node:fs/promises'
import { getToken, OAUTH_BETA } from './credential.ts'
import type { LimitsView, UsageLimit } from './types.ts'

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'

/** Plan limits are not cached anywhere on disk, so this has to be polled. */
const POLL_MS = 60_000

function labelFor(l: any): string {
  const model = l?.scope?.model?.display_name
  if (typeof model === 'string' && model) return model // e.g. "Fable"
  if (l?.kind === 'session') return '5-hour'
  if (l?.kind === 'weekly_all') return '7-day'
  return String(l?.kind ?? 'limit').replace(/_/g, ' ')
}

function rank(l: any): number {
  if (l?.kind === 'session') return 0
  if (l?.kind === 'weekly_all') return 1
  return 2 // model-scoped (Fable) and anything else after the two headline limits
}

/**
 * The `limits` array is the authoritative source — richer than the top-level
 * buckets (it carries per-model scope and a severity), and the only place the
 * Fable limit shows up. Top-level five_hour/seven_day are a fallback for shape
 * changes.
 */
function parseLimits(data: any): UsageLimit[] {
  const arr = Array.isArray(data?.limits) ? data.limits : []
  const out: UsageLimit[] = []
  for (const l of arr) {
    if (typeof l?.percent !== 'number') continue
    out.push({
      key: `${l.kind}:${l?.scope?.model?.display_name ?? ''}`,
      label: labelFor(l),
      utilization: l.percent,
      resetsAt: typeof l.resets_at === 'string' ? l.resets_at : null,
      severity: typeof l.severity === 'string' ? l.severity : 'normal',
    })
  }
  if (out.length > 0) {
    return out.sort((a, b) => a.key.localeCompare(b.key)).sort((a, b) => {
      const la = arr.find((x: any) => `${x.kind}:${x?.scope?.model?.display_name ?? ''}` === a.key)
      const lb = arr.find((x: any) => `${x.kind}:${x?.scope?.model?.display_name ?? ''}` === b.key)
      return rank(la) - rank(lb)
    })
  }

  // Fallback: top-level buckets, if the limits array is ever absent.
  for (const key of ['five_hour', 'seven_day']) {
    const v = data?.[key]
    if (v && typeof v.utilization === 'number') {
      out.push({
        key,
        label: key === 'five_hour' ? '5-hour' : '7-day',
        utilization: v.utilization,
        resetsAt: typeof v.resets_at === 'string' ? v.resets_at : null,
        severity: 'normal',
      })
    }
  }
  return out
}

/**
 * The usage endpoint rate-limits, and has been seen asking for a 50-minute
 * wait. Honour its `retry-after` (capped), falling back to this when absent —
 * re-polling early only extends the lockout.
 */
const RATE_LIMIT_BACKOFF_MS = 3 * 60 * 1000
const RATE_LIMIT_MAX_MS = 60 * 60 * 1000

export class Limits {
  private view: LimitsView = {
    state: 'no-token',
    detail: null,
    limits: [],
    fetchedAt: null,
  }
  /** Last successful read, kept so a transient blip doesn't blank the gauges. */
  private lastGood: UsageLimit[] = []
  private backoffUntil = 0
  private timer: NodeJS.Timeout | null = null

  current(): LimitsView {
    return this.view
  }

  start(onChange: () => void): void {
    const tick = () =>
      void this.refresh().then((changed) => {
        if (changed) onChange()
      })
    tick()
    this.timer = setInterval(tick, POLL_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }

  private set(next: LimitsView): boolean {
    const changed = JSON.stringify(next) !== JSON.stringify(this.view)
    this.view = next
    return changed
  }

  /** Auth failures are persistent — clear the gauges and tell the user to act. */
  private hardFail(state: LimitsView['state'], detail: string): boolean {
    this.lastGood = []
    return this.set({ state, detail, limits: [], fetchedAt: Date.now() })
  }

  /** Transient failures (429, network, 5xx) — keep showing the last-good gauges. */
  private softFail(detail = 'usage temporarily unavailable'): boolean {
    if (this.lastGood.length === 0) {
      return this.set({ state: 'error', detail, limits: [], fetchedAt: Date.now() })
    }
    // Slightly stale but valid; a kiosk should keep displaying it.
    return this.set({ state: 'ok', detail: null, limits: this.lastGood, fetchedAt: this.view.fetchedAt })
  }

  private async refresh(): Promise<boolean> {
    // Offline/demo hook: render from a saved usage response instead of the API.
    const fixture = process.env.COCKPIT_USAGE_FIXTURE
    if (fixture) {
      try {
        const data = JSON.parse(await fs.readFile(fixture, 'utf8'))
        const limits = parseLimits(data)
        if (limits.length) {
          this.lastGood = limits
          return this.set({ state: 'ok', detail: null, limits, fetchedAt: Date.now() })
        }
      } catch {
        /* unreadable fixture — fall through to the real API */
      }
    }

    if (Date.now() < this.backoffUntil) return false

    // getToken auto-refreshes a near-expiry token and writes it back, so the
    // panel stays live without anyone re-running `claude auth login`.
    const tok = await getToken()
    if (tok.state === 'no-token') {
      return this.hardFail('no-token', 'Run `claude auth login` in a terminal.')
    }
    if (tok.state === 'refresh-failed') {
      return this.hardFail('expired', tok.detail)
    }

    try {
      const res = await fetch(USAGE_URL, {
        headers: {
          authorization: `Bearer ${tok.accessToken}`,
          'anthropic-beta': OAUTH_BETA,
          'content-type': 'application/json',
        },
        signal: AbortSignal.timeout(8000),
      })
      if (res.status === 401) {
        return this.hardFail('expired', 'Rejected by the API. Run `claude auth login`.')
      }
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('retry-after')) * 1000
        const wait = Math.min(RATE_LIMIT_MAX_MS, Math.max(RATE_LIMIT_BACKOFF_MS, retryAfter || 0))
        this.backoffUntil = Date.now() + wait
        return this.softFail(`usage rate-limited · retry in ${Math.ceil(wait / 60000)}m`)
      }
      if (!res.ok) {
        return this.softFail()
      }
      const limits = parseLimits(await res.json())
      if (limits.length === 0) return this.softFail()
      this.lastGood = limits
      return this.set({ state: 'ok', detail: null, limits, fetchedAt: Date.now() })
    } catch {
      return this.softFail() // network/timeout — keep the last-good gauges
    }
  }
}

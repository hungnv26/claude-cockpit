import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getToken, OAUTH_BETA } from './credential.ts'
import type { LimitsView, Pace, UsageLimit } from './types.ts'

/** The API's view of a limit, before history and pace are attached. */
type BaseLimit = Omit<UsageLimit, 'windowStart' | 'history' | 'pace'>

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
function parseLimits(data: any): BaseLimit[] {
  const arr = Array.isArray(data?.limits) ? data.limits : []
  const out: BaseLimit[] = []
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

const HOUR = 60 * 60 * 1000
/** Session limits roll every 5 hours; everything else here is weekly. */
const windowMs = (key: string) => (key.startsWith('session') ? 5 * HOUR : 7 * 24 * HOUR)
/** "Recent" pace looks back this far — long enough to smooth whole-percent steps. */
const lookbackMs = (key: string) => (key.startsWith('session') ? HOUR : 24 * HOUR)
/** A recent slope needs at least this much history behind it to be trusted. */
const minSpanMs = (key: string) => (key.startsWith('session') ? 15 * 60 * 1000 : 3 * HOUR)
/** Keep ~150 samples per window, plus every change. */
const sampleEveryMs = (key: string) => windowMs(key) / 150
const SPARK_POINTS = 60

/**
 * History survives restarts so the sparkline doesn't start over, and the last
 * good reading is replayed at startup so the gauges don't blank while the
 * first poll (which the usage endpoint likes to 429) is in flight.
 */
const STORE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.cockpit-usage.json')
/** A replayed reading older than this is too stale to show as current. */
const REPLAY_MAX_AGE_MS = 30 * 60 * 1000

interface Series {
  /** resetsAt as ms, rounded to the minute — it identifies the window. */
  window: number | null
  samples: [number, number][]
}

interface Store {
  fetchedAt: number | null
  lastGood: BaseLimit[]
  series: Record<string, Series>
}

const roundMin = (ms: number) => Math.round(ms / 60_000) * 60_000

function windowEnd(l: BaseLimit): number | null {
  const t = l.resetsAt ? Date.parse(l.resetsAt) : NaN
  return Number.isNaN(t) ? null : roundMin(t)
}

function record(series: Record<string, Series>, l: BaseLimit, now: number): void {
  const end = windowEnd(l)
  let s = series[l.key]
  const last = s?.samples[s.samples.length - 1]
  // New window: a different reset time, or the value fell (the window rolled).
  if (!s || s.window !== end || (last && l.utilization < last[1] - 1)) {
    s = series[l.key] = { window: end, samples: [] }
  }
  const prev = s.samples[s.samples.length - 1]
  const changed = !prev || prev[1] !== l.utilization
  if (!prev || (changed && now - prev[0] >= 60_000) || now - prev[0] >= sampleEveryMs(l.key)) {
    s.samples.push([now, l.utilization])
  }
}

function downsample(samples: [number, number][], n: number): [number, number][] {
  if (samples.length <= n) return samples
  const out: [number, number][] = []
  for (let i = 0; i < n; i++) out.push(samples[Math.round((i * (samples.length - 1)) / (n - 1))])
  return out
}

/**
 * Prefer the slope over the recent stretch (responds when you speed up or
 * stop); fall back to the average since the window opened, which needs no
 * history at all — the window started at 0%.
 */
export function paceFor(l: BaseLimit, samples: [number, number][], start: number | null, now: number): Pace | null {
  const end = windowEnd(l)
  if (end === null || start === null) return null
  let ratePerHour: number | null = null
  let basis: Pace['basis'] = 'recent'

  const from = now - lookbackMs(l.key)
  const recent = samples.filter(([t]) => t >= from)
  if (recent.length >= 2) {
    const [t0, u0] = recent[0]
    const [t1, u1] = recent[recent.length - 1]
    if (t1 - t0 >= minSpanMs(l.key)) ratePerHour = ((u1 - u0) / (t1 - t0)) * HOUR
  }
  if (ratePerHour === null) {
    const elapsed = now - start
    if (elapsed < 5 * 60 * 1000) return null
    ratePerHour = (l.utilization / elapsed) * HOUR
    basis = 'window'
  }
  ratePerHour = Math.max(0, ratePerHour)

  const hoursLeft = Math.max(0, (end - now) / HOUR)
  const atReset = l.utilization + ratePerHour * hoursLeft
  const hitsAt =
    ratePerHour > 0 && l.utilization < 100 && atReset >= 100
      ? now + ((100 - l.utilization) / ratePerHour) * HOUR
      : null
  return { ratePerHour, basis, hitsAt, atReset }
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
  private lastGood: BaseLimit[] = []
  private series: Record<string, Series> = {}
  private backoffUntil = 0
  private timer: NodeJS.Timeout | null = null

  current(): LimitsView {
    return this.view
  }

  start(onChange: () => void): void {
    void this.load().then((replayed) => {
      if (replayed) onChange()
    })
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

  private async load(): Promise<boolean> {
    try {
      const store: Store = JSON.parse(await fs.readFile(STORE, 'utf8'))
      this.series = store.series ?? {}
      const fresh = store.fetchedAt && Date.now() - store.fetchedAt < REPLAY_MAX_AGE_MS
      // Only replay if no live reading has landed in the meantime.
      if (fresh && store.lastGood?.length && this.lastGood.length === 0) {
        this.lastGood = store.lastGood
        return this.set({ state: 'ok', detail: null, limits: this.decorate(store.lastGood), fetchedAt: store.fetchedAt })
      }
    } catch {
      /* first run, or unreadable — start empty */
    }
    return false
  }

  private async save(fetchedAt: number): Promise<void> {
    const store: Store = { fetchedAt, lastGood: this.lastGood, series: this.series }
    const tmp = `${STORE}.tmp`
    try {
      await fs.writeFile(tmp, JSON.stringify(store))
      await fs.rename(tmp, STORE)
    } catch {
      /* history is a nicety; never break polling over it */
    }
  }

  /** Attach window start, sparkline history and pace to each API limit. */
  private decorate(limits: BaseLimit[]): UsageLimit[] {
    const now = Date.now()
    return limits.map((l) => {
      const end = windowEnd(l)
      const start = end === null ? null : end - windowMs(l.key)
      const series = this.series[l.key]
      const samples = series && series.window === end ? series.samples : []
      return {
        ...l,
        windowStart: start,
        history: downsample(samples, SPARK_POINTS),
        pace: paceFor(l, samples, start, now),
      }
    })
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
    return this.set({ state: 'ok', detail: null, limits: this.decorate(this.lastGood), fetchedAt: this.view.fetchedAt })
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
          return this.set({ state: 'ok', detail: null, limits: this.decorate(limits), fetchedAt: Date.now() })
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
      const now = Date.now()
      for (const l of limits) record(this.series, l, now)
      this.lastGood = limits
      void this.save(now)
      return this.set({ state: 'ok', detail: null, limits: this.decorate(limits), fetchedAt: now })
    } catch {
      return this.softFail() // network/timeout — keep the last-good gauges
    }
  }
}

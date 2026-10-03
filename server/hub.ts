import { scanSessions, watchSessions, isAlive } from './sessions.ts'
import { Tailer } from './transcript.ts'
import { EventLog } from './events.ts'
import { Limits } from './limits.ts'
import { ModelCatalog } from './models.ts'
import { AgentRegistry } from './agents.ts'
import { PermissionBroker } from './permissions.ts'
import { ContextProbe } from './context.ts'
import type { SessionView, ServerMessage } from './types.ts'

/**
 * The iPad Mini 4 is a 2015 A8 with 2GB of RAM. A socket that fires on every
 * transcript append would pin its CPU, so all churn collapses into one frame
 * per COALESCE_MS.
 */
const COALESCE_MS = 250
/** A crashed session leaves its registry file behind; only a pid check finds it. */
const LIVENESS_POLL_MS = 5_000

type Listener = (msg: ServerMessage) => void

export class Hub {
  private tailer: Tailer
  readonly events = new EventLog()
  readonly agents = new AgentRegistry(() => this.schedule())
  readonly permissions = new PermissionBroker(() => this.broadcast())
  private limits = new Limits()
  private catalog = new ModelCatalog()
  private context = new ContextProbe(() => this.schedule())
  private listeners = new Set<Listener>()
  private pending: NodeJS.Timeout | null = null
  private stopWatch: (() => void) | null = null
  private poll: NodeJS.Timeout | null = null
  private snapshot: SessionView[] = []

  constructor() {
    this.tailer = new Tailer(
      () => this.schedule(),
      (model) => this.catalog.limitFor(model),
    )
  }

  async start(): Promise<void> {
    // Catalog first: a session's context % is wrong until the window is known.
    this.catalog.start(() => void this.refresh())
    await this.refresh()
    this.stopWatch = watchSessions(() => this.schedule())
    this.poll = setInterval(() => void this.refresh(), LIVENESS_POLL_MS)
    this.limits.start(() => this.broadcast())
  }

  async stop(): Promise<void> {
    this.stopWatch?.()
    this.permissions.drain()
    this.agents.stopAll()
    this.limits.stop()
    this.catalog.stop()
    if (this.poll) clearInterval(this.poll)
    if (this.pending) clearTimeout(this.pending)
    await this.tailer.close()
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    fn(this.message())
    return () => void this.listeners.delete(fn)
  }

  /** A hook fired; reflect it immediately rather than waiting for the poll. */
  onHook(tag: string, payload: unknown): void {
    this.events.record(tag, payload)
    this.schedule()
  }

  message(): ServerMessage {
    return {
      type: 'snapshot',
      ts: Date.now(),
      sessions: this.snapshot,
      events: this.events.recent(),
      limits: this.limits.current(),
      agents: this.agents.views(),
      permissions: this.permissions.list(),
    }
  }

  private schedule(): void {
    if (this.pending) return
    this.pending = setTimeout(() => {
      this.pending = null
      void this.refresh()
    }, COALESCE_MS)
  }

  private async refresh(): Promise<void> {
    const metas = await scanSessions()
    const live = metas.filter((m) => isAlive(m.pid))
    const liveIds = new Set(live.map((m) => m.sessionId))

    for (const id of this.tailer.tracked()) {
      if (!liveIds.has(id)) this.tailer.untrack(id)
    }
    await Promise.all(live.map((m) => this.tailer.track(m.sessionId)))
    this.events.prune(liveIds)
    this.context.ensure(live)

    this.snapshot = live
      .map((m) => {
        const usage = this.tailer.usage(m.sessionId)
        return {
          ...m,
          alive: true,
          transcriptPath: this.tailer.transcriptPath(m.sessionId),
          title: this.tailer.title(m.sessionId),
          usage,
          context: this.context.breakdownFor(m, usage),
          activity: this.tailer.activity(m.sessionId),
          attention: this.events.attentionFor(m.sessionId),
        }
      })
      .sort((a, b) => (b.usage?.lastActivity ?? 0) - (a.usage?.lastActivity ?? 0))

    this.broadcast()
  }

  private broadcast(): void {
    const msg = this.message()
    for (const fn of this.listeners) fn(msg)
  }
}

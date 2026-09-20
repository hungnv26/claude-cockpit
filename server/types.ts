export interface SessionMeta {
  pid: number
  sessionId: string
  cwd: string
  startedAt: number
  version: string
  entrypoint: string
  kind: string
  name: string | null
}

export interface UsageSnapshot {
  model: string | null
  /** input + cache_read + cache_creation from the newest assistant turn. */
  contextTokens: number
  contextLimit: number
  outputTokens: number
  /** "standard" | "fast" — Claude Code records this per turn. */
  speed: string | null
  lastActivity: number | null
}

export interface ContextItem {
  key: string
  label: string
  tokens: number
}

/**
 * Where the context window went, by category. Fixed rows come from a
 * `claude -p /context` probe in the session's cwd; `Messages` is the real
 * token count minus that overhead. Free space is left to the client.
 */
export interface ContextBreakdown {
  items: ContextItem[]
  /** Tokens Claude Code reserves before auto-compacting. */
  autocompact: number
  estimatedAt: number
}

export interface SessionView extends SessionMeta {
  alive: boolean
  transcriptPath: string | null
  title: string | null
  usage: UsageSnapshot | null
  /** null until the cwd has been probed. */
  context: ContextBreakdown | null
  /** Set by hooks: this session is blocked on the human. */
  attention: 'permission' | 'idle' | 'done' | null
}

export interface UsageLimit {
  key: string
  label: string
  utilization: number
  resetsAt: string | null
  /** From the API: "normal" | elevated states. Drives the warn color. */
  severity: string
}

export interface LimitsView {
  state: 'ok' | 'no-token' | 'expired' | 'error'
  detail: string | null
  limits: UsageLimit[]
  fetchedAt: number | null
}

export type AgentStatus = 'starting' | 'idle' | 'running' | 'exited'

export interface AgentEvent {
  id: number
  kind: 'user' | 'assistant' | 'tool' | 'system' | 'result' | 'error'
  text: string
  ts: number
}

export interface AgentView {
  id: string
  cwd: string
  model: string
  effort: string
  permissionMode: string
  status: AgentStatus
  events: AgentEvent[]
}

export interface PendingPermission {
  id: string
  sessionId: string | null
  toolName: string
  preview: string
  cwd: string | null
  ts: number
}

export type ServerMessage = {
  type: 'snapshot'
  ts: number
  sessions: SessionView[]
  events: import('./events.ts').CockpitEvent[]
  limits: LimitsView
  agents: AgentView[]
  permissions: PendingPermission[]
}

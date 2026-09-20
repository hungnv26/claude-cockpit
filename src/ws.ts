import { useEffect, useRef, useState } from 'react'

export interface UsageSnapshot {
  model: string | null
  contextTokens: number
  contextLimit: number
  outputTokens: number
  speed: string | null
  lastActivity: number | null
}

export type Attention = 'permission' | 'idle' | 'done' | null

export interface ContextItem {
  key: string
  label: string
  tokens: number
}

export interface ContextBreakdown {
  items: ContextItem[]
  autocompact: number
  estimatedAt: number
}

export interface SessionView {
  pid: number
  sessionId: string
  cwd: string
  startedAt: number
  version: string
  entrypoint: string
  kind: string
  name: string | null
  alive: boolean
  transcriptPath: string | null
  title: string | null
  usage: UsageSnapshot | null
  context: ContextBreakdown | null
  attention: Attention
}

export interface CockpitEvent {
  id: number
  tag: string
  sessionId: string | null
  cwd: string | null
  message: string | null
  ts: number
}

export interface UsageLimit {
  key: string
  label: string
  utilization: number
  resetsAt: string | null
  severity: string
}

export interface LimitsView {
  state: 'ok' | 'no-token' | 'expired' | 'error'
  detail: string | null
  limits: UsageLimit[]
  fetchedAt: number | null
}

export interface PendingPermission {
  id: string
  sessionId: string | null
  toolName: string
  preview: string
  cwd: string | null
  ts: number
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

/** POST to the control plane; the token rides in the query string as elsewhere. */
export async function control(path: string, body: unknown): Promise<any> {
  const token = resolveToken()
  const res = await fetch(`${path}?t=${token}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText)
  return res.json()
}

const TOKEN_KEY = 'cockpit.token'

/** Token arrives as ?t= once, then lives in localStorage so the home-screen app works. */
export function resolveToken(): string | null {
  const fromUrl = new URLSearchParams(window.location.search).get('t')
  if (fromUrl) {
    localStorage.setItem(TOKEN_KEY, fromUrl)
    return fromUrl
  }
  return localStorage.getItem(TOKEN_KEY)
}

const EMPTY_LIMITS: LimitsView = {
  state: 'no-token',
  detail: null,
  limits: [],
  fetchedAt: null,
}

export function useCockpit() {
  const [sessions, setSessions] = useState<SessionView[]>([])
  const [agents, setAgents] = useState<AgentView[]>([])
  const [permissions, setPermissions] = useState<PendingPermission[]>([])
  const [events, setEvents] = useState<CockpitEvent[]>([])
  const [limits, setLimits] = useState<LimitsView>(EMPTY_LIMITS)
  const [updatedAt, setUpdatedAt] = useState(0)
  const [connected, setConnected] = useState(false)
  const [authError, setAuthError] = useState(false)
  const retry = useRef(0)

  useEffect(() => {
    let socket: WebSocket | null = null
    let timer: number | undefined
    let closed = false

    const connect = () => {
      const token = resolveToken()
      if (!token) {
        setAuthError(true)
        return
      }
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
      socket = new WebSocket(`${proto}://${window.location.host}/ws?t=${token}`)

      socket.onopen = () => {
        retry.current = 0
        setConnected(true)
        setAuthError(false)
      }
      socket.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data)
          if (msg.type !== 'snapshot') return
          setSessions(msg.sessions)
          setAgents(msg.agents ?? [])
          setPermissions(msg.permissions ?? [])
          setEvents(msg.events ?? [])
          setLimits(msg.limits ?? EMPTY_LIMITS)
          setUpdatedAt(msg.ts ?? Date.now())
        } catch {
          /* ignore malformed frame */
        }
      }
      socket.onclose = (ev) => {
        setConnected(false)
        if (ev.code === 4001) {
          setAuthError(true)
          return
        }
        if (closed) return
        // Back off to at most 5s; the iPad may sit disconnected for a while.
        const delay = Math.min(5000, 500 * 2 ** retry.current++)
        timer = window.setTimeout(connect, delay)
      }
      socket.onerror = () => socket?.close()
    }

    connect()
    return () => {
      closed = true
      if (timer) clearTimeout(timer)
      socket?.close()
    }
  }, [])

  return { sessions, agents, permissions, events, limits, updatedAt, connected, authError }
}

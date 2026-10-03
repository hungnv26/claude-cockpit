import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import { CLAUDE_BIN } from './agent.ts'
import { findTranscript } from './transcript.ts'
import type { ContextBreakdown, ContextItem, UsageSnapshot } from './types.ts'

/**
 * Claude Code never persists its per-category context breakdown — the desktop
 * app's "Context window" panel is computed inside the CLI process and only
 * shown there. The one way to get the same numbers from outside is to ask the
 * CLI itself: `claude -p /context` prints the estimate for a fresh session in
 * that cwd (same system prompt, tools, skills, memory, agents), makes no API
 * call, and exits in about a second.
 *
 * That gives the fixed overhead. The live part — messages — is the difference
 * between the newest turn's real token count and that overhead.
 *
 * The probe runs with the session's own CLAUDE_CODE_ENTRYPOINT: tool loading
 * depends on it (under launchd's bare env every system tool is deferred and the
 * "System tools" row vanishes; as `claude-desktop` it matches the app's panel).
 */
const PROBE_TIMEOUT_MS = 30_000
/** Overhead only moves when settings, MCP servers or memory files change. */
const PROBE_TTL_MS = 15 * 60 * 1000
/** Failed probes (no binary, timeout) retry sooner but not on every frame. */
const PROBE_RETRY_MS = 60 * 1000

/** Row order matches the desktop panel; anything unknown sorts after. */
const ORDER = [
  'System prompt',
  'System tools',
  'MCP tools',
  'Skills',
  'Memory files',
  'Custom agents',
]

/** Rows the probe prints that aren't fixed overhead. */
const SKIP = new Set(['Messages', 'Free space'])

interface Probe {
  /** Non-deferred fixed categories, in ORDER. */
  fixed: ContextItem[]
  autocompact: number
  probedAt: number
  ok: boolean
}

/** "6.2k" → 6200, "1.5M" → 1500000, "520" → 520 */
function parseTokens(s: string): number | null {
  const m = /^([\d.]+)\s*([kM]?)$/.exec(s.trim())
  if (!m) return null
  const n = Number(m[1])
  if (Number.isNaN(n)) return null
  return Math.round(n * (m[2] === 'M' ? 1_000_000 : m[2] === 'k' ? 1_000 : 1))
}

/**
 * Parses the "Estimated usage by category" table:
 *   | System prompt | 6.2k | 3.1% |
 * Deferred tools ("MCP tools (deferred)") don't occupy context and are dropped.
 */
export function parseProbe(markdown: string): Omit<Probe, 'probedAt' | 'ok'> | null {
  const section = markdown.split(/^### /m).find((s) => s.startsWith('Estimated usage'))
  if (!section) return null
  const byLabel = new Map<string, number>()
  let autocompact = 0
  for (const line of section.split('\n')) {
    const m = /^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/.exec(line)
    if (!m) continue
    const label = m[1]
    const n = parseTokens(m[2])
    if (n === null) continue
    if (label === 'Autocompact buffer') {
      autocompact = n
      continue
    }
    if (SKIP.has(label) || /\(deferred\)/.test(label)) continue
    byLabel.set(label, n)
  }
  if (byLabel.size === 0) return null

  const fixed: ContextItem[] = []
  for (const label of ORDER) {
    const n = byLabel.get(label)
    if (n !== undefined) {
      fixed.push({ key: label.toLowerCase().replace(/\s+/g, '-'), label, tokens: n })
      byLabel.delete(label)
    }
  }
  for (const [label, n] of byLabel) {
    fixed.push({ key: label.toLowerCase().replace(/\s+/g, '-'), label, tokens: n })
  }
  return { fixed, autocompact }
}

/** One probe per distinct (cwd, entrypoint) — both change what gets loaded. */
export interface ProbeTarget {
  cwd: string
  entrypoint: string
}

const keyOf = (t: ProbeTarget) => `${t.entrypoint}\0${t.cwd}`

async function runProbe(t: ProbeTarget): Promise<Omit<Probe, 'probedAt' | 'ok'> | null> {
  const env = { ...process.env }
  if (/^[\w-]+$/.test(t.entrypoint)) env.CLAUDE_CODE_ENTRYPOINT = t.entrypoint
  let stdout: string
  try {
    ;({ stdout } = await new Promise<{ stdout: string }>((resolve, reject) => {
      execFile(
        CLAUDE_BIN,
        ['-p', '/context', '--output-format', 'json'],
        { cwd: t.cwd, env, timeout: PROBE_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
        (err, out) => (err ? reject(err) : resolve({ stdout: String(out) })),
      )
    }))
  } catch {
    return null
  }

  let body: any
  try {
    body = JSON.parse(stdout)
  } catch {
    return null
  }

  // Each probe is a real (empty) session and leaves a transcript behind. Remove
  // it so the projects dir doesn't fill with one 9KB file per probe.
  if (typeof body?.session_id === 'string') {
    const file = await findTranscript(body.session_id)
    if (file) await fs.rm(file, { force: true }).catch(() => {})
  }

  return typeof body?.result === 'string' ? parseProbe(body.result) : null
}

export class ContextProbe {
  private cache = new Map<string, Probe>()
  private inFlight = new Set<string>()
  private queue: ProbeTarget[] = []
  private running = false

  constructor(private onChange: () => void) {}

  /** Make sure every live target has a fresh probe; kicks off missing ones. */
  ensure(targets: Iterable<ProbeTarget>): void {
    const now = Date.now()
    for (const t of targets) {
      const key = keyOf(t)
      const p = this.cache.get(key)
      const ttl = p?.ok ? PROBE_TTL_MS : PROBE_RETRY_MS
      if (p && now - p.probedAt < ttl) continue
      if (this.inFlight.has(key)) continue
      this.inFlight.add(key)
      this.queue.push(t)
    }
    void this.drain()
  }

  /** One probe at a time — each is a full CLI start-up, don't stack them. */
  private async drain(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      while (this.queue.length > 0) {
        const t = this.queue.shift()!
        const key = keyOf(t)
        const result = await runProbe(t)
        const prev = this.cache.get(key)
        this.cache.set(
          key,
          result
            ? { ...result, probedAt: Date.now(), ok: true }
            : // Keep the last good numbers through a failed retry.
              { fixed: prev?.fixed ?? [], autocompact: prev?.autocompact ?? 0, probedAt: Date.now(), ok: false },
        )
        this.inFlight.delete(key)
        if (result) this.onChange()
      }
    } finally {
      this.running = false
    }
  }

  breakdownFor(t: ProbeTarget, usage: UsageSnapshot | null): ContextBreakdown | null {
    const p = this.cache.get(keyOf(t))
    if (!p || p.fixed.length === 0 || !usage) return null
    const overhead = p.fixed.reduce((n, i) => n + i.tokens, 0)
    // The newest turn's usage is the real count; whatever the fixed estimate
    // doesn't account for is conversation.
    const messages = Math.max(0, usage.contextTokens - overhead)
    return {
      items: [{ key: 'messages', label: 'Messages', tokens: messages }, ...p.fixed],
      autocompact: p.autocompact,
      estimatedAt: p.probedAt,
    }
  }
}

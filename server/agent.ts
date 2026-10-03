import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AgentEvent, AgentView, AgentStatus } from './types.ts'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const AGENT_SETTINGS = path.join(ROOT, '.cockpit-agent-settings.json')

/**
 * Owned sessions get an extra PreToolUse hook so tool calls can be held for
 * approval on the iPad. `-p` mode has no permission dialog — it silently denies
 * anything not pre-allowed — so PreToolUse is the only place to intervene.
 * --settings merges with the user's own settings rather than replacing them.
 */
function writeAgentSettings(): string {
  const hook = path.join(ROOT, 'hooks', 'permission.mjs')
  const settings = {
    hooks: {
      PreToolUse: [
        {
          matcher: '*',
          hooks: [{ type: 'command', command: `${process.execPath} ${hook}` }],
        },
      ],
    },
  }
  fs.writeFileSync(AGENT_SETTINGS, JSON.stringify(settings, null, 2))
  return AGENT_SETTINGS
}

/** Highest semver first, so we pick the newest installed build. */
function cmpSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pb[i] ?? 0) !== (pa[i] ?? 0)) return (pb[i] ?? 0) - (pa[i] ?? 0)
  }
  return 0
}

/**
 * The Claude Desktop app ships a native (arm64) build; the standalone npm CLI may
 * be x86_64 — which needs Rosetta, and macOS 27 has none ("bad CPU type") — so
 * prefer the bundled one. Resolve the newest installed version rather than
 * pinning a version number that breaks on the next update; fall back to whatever
 * `claude` is on PATH.
 *
 * The bundle has lived at both `<version>/claude.app` and, since 2.1.28x,
 * `<version>/<build-hash>/claude.app`; check both.
 */
function resolveClaudeBin(): string {
  if (process.env.COCKPIT_CLAUDE_BIN) return process.env.COCKPIT_CLAUDE_BIN
  const base = path.join(os.homedir(), 'Library/Application Support/Claude/claude-code')
  const inApp = (dir: string) => path.join(dir, 'claude.app/Contents/MacOS/claude')
  try {
    const versions = fs
      .readdirSync(base)
      .filter((v) => /^\d+\.\d+\.\d+$/.test(v))
      .sort(cmpSemver)
    for (const v of versions) {
      const dir = path.join(base, v)
      if (fs.existsSync(inApp(dir))) return inApp(dir)
      for (const sub of fs.readdirSync(dir)) {
        if (fs.existsSync(inApp(path.join(dir, sub)))) return inApp(path.join(dir, sub))
      }
    }
  } catch {
    /* not installed here — fall through */
  }
  return 'claude' // rely on PATH
}

export const CLAUDE_BIN = resolveClaudeBin()

export const MODELS = ['opus', 'sonnet', 'haiku'] as const
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export const PERMISSION_MODES = ['default', 'acceptEdits', 'plan'] as const

const MAX_EVENTS = 200

export interface AgentOptions {
  cwd: string
  model: string
  effort: string
  permissionMode: string
}

export class Agent {
  /** Doubles as the Claude session id, so --resume can reattach to it. */
  readonly id = randomUUID()
  cwd: string
  model: string
  effort: string
  permissionMode: string
  status: AgentStatus = 'starting'
  events: AgentEvent[] = []
  lastError: string | null = null

  private child: ChildProcess | null = null
  private buf = ''
  private seq = 0
  /** True while a deliberate restart is in flight, so exit isn't reported as a crash. */
  private restarting = false
  private started = false

  constructor(
    opts: AgentOptions,
    private onChange: () => void,
  ) {
    this.cwd = opts.cwd
    this.model = opts.model
    this.effort = opts.effort
    this.permissionMode = opts.permissionMode
  }

  private push(kind: AgentEvent['kind'], text: string): void {
    this.events.push({ id: ++this.seq, kind, text, ts: Date.now() })
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS)
    this.onChange()
  }

  start(): void {
    const args = [
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--model', this.model,
      '--effort', this.effort,
      '--permission-mode', this.permissionMode,
      '--settings', writeAgentSettings(),
    ]
    // First run claims the id; later runs reattach to the same conversation.
    if (this.started) args.push('--resume', this.id)
    else args.push('--session-id', this.id)
    this.started = true

    this.status = 'starting'
    const child = spawn(CLAUDE_BIN, args, { cwd: this.cwd, stdio: ['pipe', 'pipe', 'pipe'] })
    this.child = child

    child.stdout.on('data', (c: Buffer) => this.consume(c.toString()))
    child.stderr.on('data', (c: Buffer) => {
      const s = c.toString().trim()
      // The Rosetta AVX warning is noise on Apple Silicon; don't surface it.
      if (!s || /AVX|baseline|oven-sh/i.test(s)) return
      this.lastError = s.slice(0, 300)
      this.push('error', this.lastError)
    })
    child.on('exit', (code) => {
      this.child = null
      if (this.restarting) return
      this.status = 'exited'
      if (code) this.push('error', `claude exited with code ${code}`)
      this.onChange()
    })
    child.on('error', (err) => {
      this.status = 'exited'
      this.push('error', err.message)
    })
    this.onChange()
  }

  private consume(chunk: string): void {
    this.buf += chunk
    const lines = this.buf.split('\n')
    this.buf = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      let e: any
      try {
        e = JSON.parse(line)
      } catch {
        continue
      }
      this.handle(e)
    }
  }

  private handle(e: any): void {
    switch (e.type) {
      case 'system':
        if (e.subtype === 'init') {
          this.status = 'idle'
          if (typeof e.model === 'string') this.model = e.model
          this.onChange()
        }
        break
      case 'assistant': {
        const blocks = e.message?.content ?? []
        const text = blocks
          .filter((b: any) => b.type === 'text')
          .map((b: any) => b.text)
          .join('')
        if (text.trim()) this.push('assistant', text)
        for (const b of blocks) {
          if (b.type === 'tool_use') this.push('tool', b.name)
        }
        break
      }
      case 'result':
        this.status = 'idle'
        if (e.subtype !== 'success') this.push('error', `result: ${e.subtype}`)
        this.onChange()
        break
      case 'control_response':
        if (e.response?.subtype === 'error') {
          this.push('error', String(e.response.error ?? 'control request failed'))
        }
        break
    }
  }

  private write(o: unknown): boolean {
    if (!this.child?.stdin?.writable) return false
    this.child.stdin.write(JSON.stringify(o) + '\n')
    return true
  }

  send(text: string): boolean {
    if (this.status === 'exited') return false
    const ok = this.write({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text }] },
    })
    if (ok) {
      this.push('user', text)
      this.status = 'running'
      this.onChange()
    }
    return ok
  }

  /** Live switch — the CLI supports set_model as a control request. */
  setModel(model: string): boolean {
    this.model = model
    const ok = this.write({
      type: 'control_request',
      request_id: `m-${Date.now()}`,
      request: { subtype: 'set_model', model },
    })
    this.onChange()
    return ok
  }

  setPermissionMode(mode: string): boolean {
    this.permissionMode = mode
    const ok = this.write({
      type: 'control_request',
      request_id: `p-${Date.now()}`,
      request: { subtype: 'set_permission_mode', mode },
    })
    this.onChange()
    return ok
  }

  interrupt(): boolean {
    return this.write({
      type: 'control_request',
      request_id: `i-${Date.now()}`,
      request: { subtype: 'interrupt' },
    })
  }

  /**
   * There is no set_effort control request ("Unsupported control request
   * subtype: set_effort"), so effort can only change at spawn. Restarting with
   * --resume keeps the conversation — verified: the resumed session still
   * recalled a fact from before the switch.
   */
  async setEffort(effort: string): Promise<void> {
    if (effort === this.effort) return
    this.effort = effort
    this.push('system', `effort → ${effort} (restarting, conversation preserved)`)
    await this.restart()
  }

  private async restart(): Promise<void> {
    this.restarting = true
    const child = this.child
    if (child) {
      const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
      child.stdin?.end()
      child.kill('SIGTERM')
      await Promise.race([exited, new Promise((r) => setTimeout(r, 4000))])
    }
    this.buf = ''
    this.restarting = false
    this.start()
  }

  stop(): void {
    this.restarting = true // suppress the crash path on a deliberate stop
    this.child?.stdin?.end()
    this.child?.kill('SIGTERM')
    this.child = null
    this.status = 'exited'
    this.onChange()
  }

  view(): AgentView {
    return {
      id: this.id,
      cwd: this.cwd,
      model: this.model,
      effort: this.effort,
      permissionMode: this.permissionMode,
      status: this.status,
      events: this.events,
    }
  }
}

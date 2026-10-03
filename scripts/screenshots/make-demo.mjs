// Builds a throwaway ~/.claude lookalike + usage fixture for the README
// screenshots: three neutral sessions with timestamps relative to now, and plan
// usage chosen to show every forecast state. Usage: node make-demo.mjs <outDir>
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = process.argv[2]
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
// The context probe runs in each session's cwd, so it must exist. Use the
// public sibling projects when present, else the repo itself.
const cwd = (p) => (fs.existsSync(p) ? p : REPO)
const PROJECTS = path.join(os.homedir(), 'Projects')
const now = Date.now()
const M = 60e3, H = 60 * M
const iso = (t) => new Date(t).toISOString()
fs.rmSync(root, { recursive: true, force: true })
fs.mkdirSync(path.join(root, 'claude/sessions'), { recursive: true })

const usage = (ctx, out = 900) => ({ input_tokens: 4, cache_read_input_tokens: ctx - 2004, cache_creation_input_tokens: 2000, output_tokens: out, speed: 'standard' })
const asst = (t, model, id, content, ctx, stop) => ({ type: 'assistant', isSidechain: false, timestamp: iso(t), message: { model, id, type: 'message', role: 'assistant', content: [content], usage: usage(ctx), stop_reason: stop } })
const user = (t, content) => ({ type: 'user', isSidechain: false, timestamp: iso(t), message: { role: 'user', content } })

const sessions = [
  {
    id: '0a1b2c3d-0000-4000-8000-000000000001', cwd: REPO,
    title: 'Cockpit pace panel', model: 'claude-opus-5-5', status: 'busy', since: now - 7 * M,
    lines: (m) => [
      user(now - 7 * M, 'Add a pace forecast to the side rail'),
      asst(now - 6 * M, m, 'msg_a1', { type: 'tool_use', id: 'toolu_a1', name: 'Read', input: { file_path: path.join(REPO, 'server/limits.ts') } }, 296_000, 'tool_use'),
      user(now - 6 * M + 2e3, [{ type: 'tool_result', tool_use_id: 'toolu_a1', content: 'ok' }]),
      asst(now - 40e3, m, 'msg_a2', { type: 'text', text: 'Server compiles and the forecast tests pass. Building the panels and wiring them into both layouts next.' }, 309_000, 'tool_use'),
      asst(now - 14e3, m, 'msg_a2', { type: 'tool_use', id: 'toolu_a2', name: 'Bash', input: { command: 'pnpm build', description: 'Build the frontend' } }, 312_400, 'tool_use'),
    ],
  },
  {
    id: '0a1b2c3d-0000-4000-8000-000000000002', cwd: cwd(path.join(PROJECTS, '2d-3d-knowledge-graph')),
    title: 'Knowledge graph 3D layout', model: 'claude-fable-5-1', status: 'idle', since: now - 4 * M,
    lines: (m) => [
      user(now - 19 * M, 'Make the 3D layout settle faster on big graphs'),
      asst(now - 4 * M, m, 'msg_b1', { type: 'text', text: 'Done: the force layout now warm-starts from the 2D positions, so large graphs settle in about a third of the time.' }, 188_000, 'end_turn'),
    ],
  },
  {
    id: '0a1b2c3d-0000-4000-8000-000000000003', cwd: cwd(path.join(PROJECTS, 'ocr-studio')),
    title: 'OCR Studio review queue', model: 'claude-opus-5-5', status: 'idle', since: now - 2 * H,
    lines: (m) => [
      user(now - 2.4 * H, 'Add a queue view for pending reviews'),
      asst(now - 2 * H, m, 'msg_c1', { type: 'text', text: 'The queue view is in and the tests pass.' }, 96_000, 'end_turn'),
    ],
  },
]

for (const s of sessions) {
  const dir = path.join(root, 'claude/projects', s.cwd.replace(/[^A-Za-z0-9]/g, '-'))
  fs.mkdirSync(dir, { recursive: true })
  const lines = [{ type: 'custom-title', customTitle: s.title, sessionId: s.id }, ...s.lines(s.model)]
  fs.writeFileSync(path.join(dir, `${s.id}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  // pid 1 always exists, so the liveness check passes.
  fs.writeFileSync(path.join(root, 'claude/sessions', `${s.id.slice(-4)}.json`), JSON.stringify({
    pid: 1, sessionId: s.id, cwd: s.cwd, startedAt: now - 3 * H, version: '2.1.286', kind: 'interactive',
    entrypoint: 'claude-desktop', name: s.title, status: s.status, statusUpdatedAt: s.since, updatedAt: s.since,
  }))
}

// Usage: the 5-hour window is borderline, 7-day runs out early, Fable is fine.
const r5 = now + 2 * H + 18 * M, r7 = now + 3 * 24 * H + 4 * H
fs.writeFileSync(path.join(root, 'usage.json'), JSON.stringify({ limits: [
  { kind: 'session', percent: 43, severity: 'normal', resets_at: iso(r5), scope: null },
  { kind: 'weekly_all', percent: 62, severity: 'normal', resets_at: iso(r7), scope: null },
  { kind: 'weekly_scoped', percent: 38, severity: 'normal', resets_at: iso(r7), scope: { model: { display_name: 'Fable' } } },
] }))
console.log('demo ready', root)

import fs from 'node:fs/promises'
import path from 'node:path'
import chokidar from 'chokidar'
import { SESSIONS_DIR } from './paths.ts'
import type { SessionMeta } from './types.ts'

/**
 * Claude Code drops a json file per live session into ~/.claude/sessions and
 * removes it on exit. A crashed process can leave one behind, so treat the file
 * as a claim and confirm it against the pid.
 */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM means the process exists but belongs to someone else.
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

async function readSessionFile(file: string): Promise<SessionMeta | null> {
  try {
    const raw = await fs.readFile(file, 'utf8')
    const d = JSON.parse(raw)
    if (!d?.sessionId || typeof d.pid !== 'number') return null
    return {
      pid: d.pid,
      sessionId: d.sessionId,
      cwd: d.cwd ?? '',
      startedAt: d.startedAt ?? 0,
      version: d.version ?? '',
      entrypoint: d.entrypoint ?? '',
      kind: d.kind ?? '',
      name: d.name ?? null,
      status: typeof d.status === 'string' ? d.status : null,
      statusSince: typeof d.statusUpdatedAt === 'number' ? d.statusUpdatedAt : null,
    }
  } catch {
    // Half-written file mid-flush; the watcher will fire again.
    return null
  }
}

export async function scanSessions(): Promise<SessionMeta[]> {
  let files: string[]
  try {
    files = await fs.readdir(SESSIONS_DIR)
  } catch {
    return []
  }
  const metas = await Promise.all(
    files
      .filter((f) => f.endsWith('.json'))
      .map((f) => readSessionFile(path.join(SESSIONS_DIR, f))),
  )
  return metas.filter((m): m is SessionMeta => m !== null)
}

export function watchSessions(onChange: () => void): () => void {
  const watcher = chokidar.watch(SESSIONS_DIR, {
    ignoreInitial: true,
    depth: 0,
  })
  watcher.on('add', onChange).on('change', onChange).on('unlink', onChange)
  return () => void watcher.close()
}

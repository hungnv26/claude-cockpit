import { ago, dur } from '../format.ts'
import type { SessionView } from '../ws.ts'

interface Props {
  /** The session in focus; null when nothing is running. */
  session: SessionView | null
  now: number
  /** Full-width section (portrait), vs. part of the side rail. */
  block?: boolean
}

/**
 * What the focused session is doing right now — the question you actually have
 * when you glance across the desk: is it working, stuck on me, or done?
 * Busy/idle comes from Claude Code's own session registry; the tool and prose
 * come from the transcript tail.
 */
export function NowPanel({ session, now, block }: Props) {
  const a = session?.activity ?? null
  const busy = session?.status === 'busy'
  const blocked = session?.attention === 'permission'
  const tool = a?.tool ?? null
  const running = busy && !!tool?.running

  let state: string
  let stateClass = 'text-ink-text'
  let since: number | null = null
  if (!session) {
    state = 'no session'
    stateClass = 'text-ink-faint'
  } else if (blocked) {
    state = 'needs approval'
    stateClass = 'text-accent'
  } else if (running) {
    state = `running ${tool!.name}`
    since = tool!.startedAt
  } else if (busy) {
    state = 'thinking'
    since = Math.max(a?.textAt ?? 0, tool?.startedAt ?? 0, session.statusSince ?? 0) || null
  } else {
    state = 'idle'
    stateClass = 'text-ink-muted'
    since = session.statusSince
  }

  const turnStart = busy ? (session?.statusSince ?? a?.turnStartedAt ?? null) : null
  const tools = a?.toolCount ?? 0

  return (
    <section className={`flex flex-col shrink-0 ${block ? 'border-t border-ink-line' : ''}`}>
      {/* No header: the footer already names the session this describes. */}
      <div className="px-3 py-3 flex flex-col gap-1.5 min-h-0">
        <div className="flex items-baseline justify-between gap-2">
          <span className={`flex items-center gap-2 text-base min-w-0 ${stateClass}`}>
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                blocked ? 'bg-accent animate-pulse' : busy ? 'bg-accent' : 'bg-ink-faint'
              }`}
            />
            <span className="truncate">{state}</span>
          </span>
          {since !== null && (
            <span className="text-xs text-ink-faint tabular-nums shrink-0">
              {busy ? dur(now - since) : ago(since, now)}
            </span>
          )}
        </div>

        {tool?.detail && (
          <p className={`text-xs truncate ${running ? 'text-ink-muted' : 'text-ink-faint'}`}>
            {running ? '' : `last · ${tool.name} · `}
            {tool.detail}
          </p>
        )}

        {a?.text && <p className="text-xs text-ink-muted line-clamp-2">{a.text}</p>}

        {session && (turnStart !== null || tools > 0) && (
          <p className="text-xs text-ink-faint tabular-nums">
            {turnStart !== null ? `turn ${dur(now - turnStart)}` : 'last turn'}
            {` · ${tools} tool${tools === 1 ? '' : 's'}`}
          </p>
        )}
      </div>
    </section>
  )
}

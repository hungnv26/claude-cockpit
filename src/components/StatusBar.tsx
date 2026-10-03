import { modelLabel } from '../format.ts'
import type { ContextBreakdown } from '../ws.ts'
import { ContextBar } from './ContextBar.tsx'

export interface Focus {
  model: string | null
  /** null when unobservable (desktop sessions on the monitor). */
  effort: string | null
  contextTokens: number | null
  contextLimit: number | null
  context: ContextBreakdown | null
  /** Which session the footer describes. */
  title: string | null
}

interface Props {
  connected: boolean
  focus: Focus | null
  /** Phone layout: compact context legend. */
  compact?: boolean
}

function Field({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <span className="whitespace-nowrap shrink-0">
      {label && <span className="text-ink-faint">{label} </span>}
      <span className={accent ? 'text-accent' : 'text-ink-text'}>{value}</span>
    </span>
  )
}

/**
 * Footer. Line 1 is at-a-glance status and which session is in focus; below it
 * the segmented context bar with its legend, along the bottom edge. Bottom
 * padding respects the iOS home-indicator safe area.
 */
export function StatusBar({ connected, focus, compact }: Props) {
  const hasCtx = focus && focus.contextTokens !== null && focus.contextLimit !== null

  return (
    <div
      className="border-t border-ink-line px-4 pt-3 flex flex-col gap-3 shrink-0"
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
    >
      <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-base min-w-0">
        <span className="flex items-center gap-2 shrink-0">
          <span
            className={`w-2.5 h-2.5 rounded-full ${connected ? 'bg-accent' : 'bg-warn animate-pulse'}`}
          />
          <span className={connected ? 'text-accent' : 'text-warn'}>
            {connected ? 'LIVE' : 'OFFLINE'}
          </span>
        </span>

        <span className="text-ink-line shrink-0">·</span>

        {focus ? (
          <>
            <Field label="" value={modelLabel(focus.model)} />
            <span className="text-ink-line shrink-0">·</span>
            <Field label="effort" value={focus.effort ?? '—'} accent={!!focus.effort} />
            {focus.title && (
              <>
                <span className="text-ink-line shrink-0">·</span>
                <span className="text-ink-faint truncate min-w-[8rem] flex-1">{focus.title}</span>
              </>
            )}
          </>
        ) : (
          <span className="text-ink-faint">no active session</span>
        )}
      </div>

      {hasCtx && (
        <ContextBar
          used={focus!.contextTokens!}
          limit={focus!.contextLimit!}
          context={focus!.context}
          compact={compact}
        />
      )}
    </div>
  )
}

import { Fragment } from 'react'
import { PLAYER_PLACEHOLDER, type GameEvent } from '@game-platform/sdk'
import type { PlayerRow } from '../lib/dbTypes'

/**
 * The narration log (@game-platform/sdk's gameLog.ts), newest first. `{player}` in a
 * message is swapped for the acting player's name in their colour — the
 * engine builds narration without access to display names.
 *
 * While history is being reviewed (GamePage.tsx), `review` is the reviewed
 * step as a range of log entries — `[from, to)`, `to` being the reviewed
 * point: those lines are highlighted and the ones after the point dimmed.
 * With `onSelectEntry`, each line is a button that jumps review to right
 * after its entry.
 */
export function GameLogPanel({
  events,
  players,
  review,
  onSelectEntry,
}: {
  events: GameEvent[]
  players: PlayerRow[]
  review?: { from: number; to: number }
  onSelectEntry?: (entryIndex: number) => void
}) {
  if (events.length === 0) return null
  return (
    <section className="flex flex-col gap-2 rounded-md border border-neutral-800 p-4">
      <h2 className="font-medium">Log</h2>
      <ol className="flex max-h-80 flex-col gap-1 overflow-auto text-sm text-neutral-300">
        {[...events].reverse().map((event) => {
          const inStep = review !== undefined && event.entryIndex >= review.from && event.entryIndex < review.to
          const later = review !== undefined && event.entryIndex >= review.to
          const content = (
            <>
              <span className="shrink-0 font-mono text-xs leading-5 text-neutral-500">{event.turn}</span>
              <span className="flex-1">
                <EventMessage event={event} players={players} />
                {event.adminMode && <span className="ml-1 text-xs text-amber-400">(admin mode)</span>}
              </span>
            </>
          )
          return (
            <li
              key={event.id}
              data-in-step={inStep || undefined}
              className={`rounded ${inStep ? 'bg-amber-500/10 ring-1 ring-amber-700/40' : ''} ${later ? 'opacity-40' : ''}`}
            >
              {onSelectEntry ? (
                <button
                  type="button"
                  onClick={() => onSelectEntry(event.entryIndex)}
                  title="Review the game right after this"
                  className="flex w-full gap-2 px-1 text-left hover:bg-neutral-800/60"
                >
                  {content}
                </button>
              ) : (
                <div className="flex gap-2 px-1">{content}</div>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}

function EventMessage({ event, players }: { event: GameEvent; players: PlayerRow[] }) {
  const player = event.playerId ? players.find((p) => p.id === event.playerId) : undefined
  const parts = event.message.split(PLAYER_PLACEHOLDER)
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 && (
            <span className="font-medium" style={{ color: player?.color }}>
              {player?.display_name ?? 'Someone'}
            </span>
          )}
          {part}
        </Fragment>
      ))}
    </>
  )
}

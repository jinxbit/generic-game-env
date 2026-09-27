import { Fragment } from 'react'
import { PLAYER_PLACEHOLDER } from '../engine/gameLog'
import type { GameEvent } from '../engine/types'
import type { PlayerRow } from '../lib/dbTypes'

/**
 * The narration log (engine/gameLog.ts), newest first. `{player}` in a
 * message is swapped for the acting player's name in their colour — the
 * engine builds narration without access to display names.
 */
export function GameLogPanel({ events, players }: { events: GameEvent[]; players: PlayerRow[] }) {
  if (events.length === 0) return null
  return (
    <section className="flex flex-col gap-2 rounded-md border border-neutral-800 p-4">
      <h2 className="font-medium">Log</h2>
      <ol className="flex max-h-80 flex-col gap-1 overflow-auto text-sm text-neutral-300">
        {[...events].reverse().map((event) => (
          <li key={event.id} className="flex gap-2">
            <span className="shrink-0 font-mono text-xs leading-5 text-neutral-500">{event.turn}</span>
            <span className="flex-1">
              <EventMessage event={event} players={players} />
              {event.adminMode && <span className="ml-1 text-xs text-amber-400">(admin mode)</span>}
            </span>
          </li>
        ))}
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

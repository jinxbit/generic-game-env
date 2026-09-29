import type { SeatInfo } from '@game-platform/sdk/ui'
import { formatChips, potTotal, type GameState } from '../rules.ts'
import type { PlayerId } from '../types.ts'
import { nameOf, seatColourOf } from './helpers.ts'
import { PlayingCard } from './PlayingCard.tsx'

/** The board (with empty slots for the cards still to come) and the pot. */
export function Board({ state }: { state: GameState }) {
  const g = state.game
  const pot = potTotal(g)
  return (
    <section className="flex flex-col items-center gap-3 rounded-xl border border-emerald-900 bg-emerald-950/60 p-4">
      <div className="flex gap-2" aria-label="Board">
        {Array.from({ length: 5 }, (_, i) => (g.board[i] ? <PlayingCard key={i} card={g.board[i]} /> : <PlayingCard key={i} card={null} slot />))}
      </div>
      {state.status === 'active' && (
        <p className="text-sm text-emerald-200">
          Pot <span className="font-mono">{formatChips(pot)}</span>
        </p>
      )}
    </section>
  )
}

function Badge({ children, title }: { children: string; title: string }) {
  return (
    <span title={title} className="rounded-full border border-neutral-600 px-1.5 text-[10px] font-semibold leading-4 text-neutral-300">
      {children}
    </span>
  )
}

/**
 * Every seat: chips, this street's bet, the dealer and blinds, and hole
 * cards — face up only for the viewer's own seat. Anyone else's are backs
 * (the server never sends them when the game hides information; this view
 * hides them too for games where every client holds the full state).
 */
export function Seats({ state, players, myPlayerId }: { state: GameState; players: SeatInfo[]; myPlayerId: string | null }) {
  const g = state.game
  const active = state.status === 'active'
  const statusOf = (id: PlayerId): string | null => {
    const player = state.players.find((p) => p.id === id)
    const p = g.players[id]
    if (player?.conceded) return 'Left'
    if (player?.eliminated) return 'Out'
    if (!active) return null
    if (p.status === 'folded') return 'Folded'
    if (p.status === 'in' && p.stack === 0) return 'All in'
    return null
  }
  return (
    <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" aria-label="Seats">
      {g.seatOrder.map((id) => {
        const p = g.players[id]
        const toAct = active && g.toActId === id
        const label = statusOf(id)
        const showCards = active && p.hole.length > 0 && p.status === 'in'
        return (
          <li
            key={id}
            className={`flex items-center justify-between gap-2 rounded-md border p-2 ${toAct ? 'border-indigo-400 bg-indigo-950/40' : 'border-neutral-800'} ${label === 'Out' || label === 'Left' || label === 'Folded' ? 'opacity-50' : ''}`}
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="flex items-center gap-1.5 text-sm">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: seatColourOf(players, id) }} />
                <span className="truncate">{nameOf(players, id)}</span>
                {id === myPlayerId && <span className="text-xs text-neutral-500">(you)</span>}
                {state.winnerPlayerIds.includes(id) && <span>🏆</span>}
              </span>
              <span className="flex flex-wrap items-center gap-1 text-xs text-neutral-400">
                <span className="font-mono text-neutral-200">{formatChips(p.stack)}</span>
                {active && g.buttonId === id && <Badge title="Dealer button">D</Badge>}
                {active && g.smallBlindId === id && <Badge title="Small blind">SB</Badge>}
                {active && g.bigBlindId === id && <Badge title="Big blind">BB</Badge>}
                {label && <span className={label === 'All in' ? 'text-amber-300' : ''}>{label}</span>}
                {toAct && <span className="text-indigo-300">to act</span>}
              </span>
              {active && p.committed > 0 && (
                <span className="text-xs text-emerald-300">
                  bet <span className="font-mono">{formatChips(p.committed)}</span>
                </span>
              )}
            </div>
            {showCards && (
              <div className="flex gap-1">
                {p.hole.map((card, i) => (
                  <PlayingCard key={i} card={id === myPlayerId ? card : null} size="sm" />
                ))}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

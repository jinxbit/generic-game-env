import type { SeatInfo } from '@game-platform/sdk/ui'
import { formatChips, type GameState } from '../rules.ts'
import type { HandResult } from '../types.ts'
import { nameOf, namesOf, seatColourOf } from './helpers.ts'
import { PlayingCard } from './PlayingCard.tsx'

/** The last finished hand: who showed what, and who won which pot (AMBIG-3: it stays up until the next hand ends). */
export function LastHand({ result, players }: { result: HandResult; players: SeatInfo[] }) {
  const potLabel = (i: number) => (result.pots.length === 1 ? 'Pot' : i === 0 ? 'Main pot' : `Side pot ${i}`)
  return (
    <section className="flex flex-col gap-3 rounded-md border border-neutral-800 p-4 text-sm">
      <h2 className="font-medium">Hand {result.hand} result</h2>
      {result.board.length > 0 && (
        <div className="flex gap-1" aria-label={`Hand ${result.hand} board`}>
          {result.board.map((card) => (
            <PlayingCard key={card} card={card} size="sm" />
          ))}
        </div>
      )}
      {result.showdown && (
        <ul className="flex flex-col gap-1.5">
          {Object.entries(result.shown).map(([id, shown]) => (
            <li key={id} className="flex flex-wrap items-center gap-2">
              <span className="flex min-w-24 items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: seatColourOf(players, id) }} />
                {nameOf(players, id)}
              </span>
              <span className="flex gap-1">
                {shown.hole.map((card) => (
                  <PlayingCard key={card} card={card} size="sm" />
                ))}
              </span>
              <span className="text-neutral-400">{shown.handName}</span>
            </li>
          ))}
        </ul>
      )}
      <ul className="flex flex-col gap-0.5 text-neutral-300">
        {result.returned && (
          <li className="text-neutral-500">
            Uncalled {formatChips(result.returned.amount)} returned to {nameOf(players, result.returned.playerId)}.
          </li>
        )}
        {result.pots.map((pot, i) => (
          <li key={i}>
            {potLabel(i)} (<span className="font-mono">{formatChips(pot.amount)}</span>): {namesOf(players, pot.winners)}
            {pot.winners.length > 1 ? ' split it' : ' wins'}
            {pot.handName ? ` with ${pot.handName}` : ''}
          </li>
        ))}
        {result.busted.map((id) => (
          <li key={id} className="text-rose-300">
            {nameOf(players, id)} is out of chips.
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * R-END-02/03: players still standing by chips, then everyone else by how
 * long they lasted. (A game a concession ended mid-hand never zeroed the
 * leaver's stack — see onPlayerEliminated — so chips alone can't rank them.)
 */
export function Standings({ state, players }: { state: GameState; players: SeatInfo[] }) {
  const g = state.game
  const standing = (id: string) => (state.players.find((p) => p.id === id)?.eliminated ? 0 : 1)
  const lasted = (id: string) => g.players[id].bustedInHand ?? Infinity
  const rows = [...g.seatOrder].sort((a, b) => standing(b) - standing(a) || g.players[b].stack - g.players[a].stack || lasted(b) - lasted(a))
  return (
    <section className="flex flex-col gap-2 rounded-md border border-neutral-800 p-4">
      <h2 className="font-medium">Final standings</h2>
      <ol className="flex flex-col gap-1 text-sm">
        {rows.map((id, i) => {
          const player = state.players.find((p) => p.id === id)
          return (
            <li key={id} className="flex items-center gap-2">
              <span className="w-5 text-right text-neutral-500">{i + 1}.</span>
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: seatColourOf(players, id) }} />
              <span className="min-w-24">{nameOf(players, id)}</span>
              <span className="font-mono">{formatChips(g.players[id].stack)}</span>
              {state.winnerPlayerIds.includes(id) && <span>🏆</span>}
              {player?.conceded ? (
                <span className="text-xs text-neutral-500">(left)</span>
              ) : (
                g.players[id].bustedInHand !== null && <span className="text-xs text-neutral-500">(out in hand {g.players[id].bustedInHand})</span>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}

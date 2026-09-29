import type { SeatInfo } from '@game-platform/sdk/ui'
import { farmScore, formatPoints, isEnclosed, scoresOf, sheepLabel, type GameState } from '../rules.ts'
import type { Sheep } from '../types.ts'
import { nameOf, seatColourOf } from './helpers.ts'

/**
 * Fences left, enclosure and farm value per player while the game runs; the
 * final standings with the score breakdown once it ends (§7).
 */
export function PlayersPanel({ state, players }: { state: GameState; players: SeatInfo[] }) {
  const g = state.game
  const ended = state.status === 'completed'
  const scores = g.finalScores ?? scoresOf(state)
  const rows = g.seatOrder.map((id) => ({ id, player: state.players.find((p) => p.id === id), score: scores[id] }))
  if (ended) rows.sort((a, b) => b.score.total - a.score.total)
  return (
    <section className="flex flex-col gap-2 rounded-md border border-neutral-800 p-4">
      <h2 className="font-medium">{ended ? 'Final standings' : 'Farmers'}</h2>
      <ul className="flex flex-col gap-1 text-sm">
        {rows.map(({ id, player, score }) => (
          <li key={id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${player?.eliminated ? 'opacity-40' : ''}`}>
            <span className="flex min-w-32 items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: seatColourOf(players, id) }} />
              {nameOf(players, id)}
              {g.turnPlayerId === id && state.status === 'active' && <span className="text-xs text-indigo-300">(turn)</span>}
              {g.startPlayerId === id && <span className="text-xs text-neutral-500">(started)</span>}
              {state.winnerPlayerIds.includes(id) && <span>🏆</span>}
              {player?.conceded && <span className="text-xs text-neutral-500">(conceded)</span>}
            </span>
            <span className="text-neutral-400">
              {g.farms[id].fencesLeft} fence{g.farms[id].fencesLeft === 1 ? '' : 's'} left
            </span>
            {ended ? (
              <span className="text-neutral-300">
                farm {formatPoints(score.farm)}
                {!score.enclosed && ' (not enclosed)'}, fences {formatPoints(score.fences)} = <span className="font-mono font-semibold">{formatPoints(score.total)}</span>
              </span>
            ) : isEnclosed(g, id) ? (
              <span className="text-emerald-400">enclosed · face-up sheep {formatPoints(farmScore(g, id))}</span>
            ) : (
              <span className="text-neutral-500">not enclosed</span>
            )}
          </li>
        ))}
      </ul>
      <p className="text-xs text-neutral-500">
        {g.bag.length} sheep left in the bag.
        {state.status === 'active' && state.options.multiRoundScoring && ' Multi-round scoring: an unenclosed farm scores 10 below the lowest enclosed one.'}
      </p>
    </section>
  )
}

/** The sheep the viewer drew and still has to place; pick one, then a field. */
export function Hand({ hand, selected, onSelect, disabled }: { hand: (Sheep | null)[]; selected: number; onSelect: (index: number) => void; disabled: boolean }) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Sheep to place">
      {hand.map((sheep, i) => (
        <button
          key={i}
          type="button"
          role="radio"
          aria-checked={selected === i}
          disabled={disabled}
          onClick={() => onSelect(i)}
          className={`rounded-full border-2 px-3 py-1 text-sm font-semibold ${sheep?.black ? 'bg-neutral-950 text-white' : 'bg-stone-100 text-stone-900'} ${selected === i ? 'border-yellow-300' : 'border-transparent'}`}
        >
          {sheep ? sheepLabel(sheep) : '?'}
        </button>
      ))}
    </div>
  )
}

import type { SeatInfo } from '@game-platform/sdk/ui'
import { cardById, enhanced, scoreOf, type Analysis, type GameState } from '../rules.ts'
import type { FinalScore } from '../types.ts'
import { nameOf, seatColourOf } from './helpers.ts'

/** The round's action card: turn order, and each action's value with its enhanced value (R-CARD-01/02). */
export function CardPanel({ state, players }: { state: GameState; players: SeatInfo[] }) {
  const g = state.game
  if (state.status !== 'active') return null
  const card = cardById(g.card)
  const actions = [
    ['Build roads', card.roads, enhanced('roads', card.roads)],
    ['Found/expand cities', card.cities, enhanced('cities', card.cities)],
    ['Resupply', card.resupply, enhanced('resupply', card.resupply)],
  ] as const
  return (
    <section className="flex flex-col gap-2 rounded-md border border-neutral-800 p-4 text-sm">
      <h2 className="font-medium">
        Round {g.round} of {g.rounds} — action card
      </h2>
      <ol className="flex flex-wrap gap-x-4 gap-y-1">
        {g.roundOrder.map((id, i) => (
          <li key={id} className={`flex items-center gap-1 ${id === g.turnPlayerId ? 'font-semibold text-indigo-300' : 'text-neutral-400'}`}>
            {i + 1}.
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: seatColourOf(players, id) }} />
            {nameOf(players, id)}
          </li>
        ))}
      </ol>
      <ul className="flex flex-wrap gap-x-6 gap-y-1">
        {actions.map(([label, value, boosted]) => (
          <li key={label}>
            {label}: <span className="font-mono">{value}</span> <span className="text-xs text-neutral-500">(alone: {boosted})</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-neutral-500">Take up to two actions, or one enhanced — resupply last. Then build or sell one market.</p>
    </section>
  )
}

/** Points, pieces and the score if the game ended now; the final standings once it has (R-END-01). */
export function PlayersPanel({ state, players, analysis }: { state: GameState; players: SeatInfo[]; analysis: Analysis }) {
  const g = state.game
  const ended = state.status === 'completed'
  const rows = g.seatOrder.map((id) => ({ id, player: state.players.find((p) => p.id === id), score: (g.finalScores?.[id] ?? scoreOf(g, id, analysis)) as FinalScore }))
  if (ended) rows.sort((a, b) => b.score.total - a.score.total)
  return (
    <section className="flex flex-col gap-2 rounded-md border border-neutral-800 p-4">
      <h2 className="font-medium">{ended ? 'Final standings' : 'Players'}</h2>
      <ul className="flex flex-col gap-2 text-sm">
        {rows.map(({ id, player, score }) => {
          const p = g.players[id]
          return (
            <li key={id} className={`flex flex-col gap-0.5 ${player?.eliminated ? 'opacity-40' : ''}`}>
              <span className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: seatColourOf(players, id) }} />
                <span className="font-medium">{nameOf(players, id)}</span>
                {g.turnPlayerId === id && !ended && <span className="text-xs text-indigo-300">(turn)</span>}
                {state.winnerPlayerIds.includes(id) && <span>🏆</span>}
                {player?.conceded && <span className="text-xs text-neutral-500">(conceded)</span>}
                <span className="ml-auto font-mono">{score.total}</span>
              </span>
              <span className="text-xs text-neutral-400">
                {score.points} on the track + {score.markets} markets + {score.oracles} oracles
                {!ended && (
                  <>
                    {' '}
                    · supply {p.supply.roads} roads / {p.supply.cities} cities · staging {p.staging.roads} / {p.staging.cities} · {p.markets} markets left
                  </>
                )}
              </span>
            </li>
          )
        })}
      </ul>
      {!ended && <p className="text-xs text-neutral-500">Scores are what each player would have if the game ended now.</p>}
    </section>
  )
}

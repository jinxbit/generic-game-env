import type { SeatInfo } from '@game-platform/sdk/ui'
import { countryName, INDUSTRIES } from '../rules.ts'
import type { GameState } from '../rules.ts'
import { corpColour, corpDef, displayNameOf } from './helpers.tsx'
import { Badge, Section } from './Section.tsx'

/**
 * One row per corporation in play order. Cash is private (§1.1): it shows
 * only for the viewer's own seat until the game ends — even in hotseat, where
 * the full state is on the device.
 */
export function PlayersPanel({ state, players, myPlayerId }: { state: GameState; players: SeatInfo[]; myPlayerId: string | null }) {
  const game = state.game
  const completed = state.status === 'completed'
  return (
    <Section title={completed ? 'Final standings' : 'Corporations'}>
      <ul className="flex flex-col gap-3">
        {game.seatOrder.map((id) => {
          const p = game.players[id]
          const seat = state.players.find((s) => s.id === id)
          const corp = corpDef(game, id)
          const showCash = p.cash !== null && (id === myPlayerId || completed)
          const shares = Object.entries(p.shares).filter(([, n]) => n > 0)
          const score = game.finalScores?.[id] ?? null
          return (
            <li key={id} className={`flex flex-col gap-1 rounded-md border border-neutral-800 p-3 text-sm ${seat?.eliminated ? 'opacity-50' : ''}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: corpColour(game, players, id) }} />
                <span className="font-medium">{corp?.name ?? 'Corporation'}</span>
                <span className="text-neutral-400">{displayNameOf(players, id)}</span>
                {id === myPlayerId && <Badge className="border-indigo-500 text-indigo-300">you</Badge>}
                {state.pendingPlayerIds.includes(id) && <Badge className="border-amber-500 text-amber-300">to act</Badge>}
                {state.winnerPlayerIds.includes(id) && <span>🏆</span>}
                {seat?.conceded && <span className="text-neutral-500">(conceded)</span>}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-neutral-300">
                <span>Cash: {showCash ? <span className="font-mono">${p.cash}</span> : <span className="text-neutral-500">hidden</span>}</span>
                <span>Bonds: {p.bonds}</span>
                <span>Cube supply: {p.supply}</span>
                <span>
                  Executives: {p.executives} / {p.executiveCount}
                  {p.parkedExecutives > 0 && <span className="text-neutral-500"> ({p.parkedExecutives} in Tax Havens)</span>}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1 text-neutral-300">
                <span>Shares:</span>
                {shares.length === 0 ? (
                  <span className="text-neutral-500">none</span>
                ) : (
                  shares.map(([country, n]) => (
                    <Badge key={country}>
                      {countryName(country)} ×{n}
                    </Badge>
                  ))
                )}
              </div>
              {score && (
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-neutral-400">
                  <span>Start cash ${score.startingCash}</span>
                  {INDUSTRIES.map((industry) => (
                    <span key={industry}>
                      {industry} {score.squares[industry] ?? 0}
                    </span>
                  ))}
                  <span>Industry cash ${score.industryCash}</span>
                  <span>Leader bonus ${score.leaderBonus}</span>
                  <span>Bond penalty −${score.bondPenalty}</span>
                  <span className="font-medium text-neutral-100">Total ${score.total}</span>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </Section>
  )
}

import type { SeatInfo } from '@game-platform/sdk/ui'
import { BONUS_INFO, CITIES, developmentPoints, handSize, scoreOf } from '../rules.ts'
import type { GameState } from '../rules.ts'
import { colorOf, nameOf } from './format.ts'
import { Badge, GoodsList, Hand, Section } from './helpers.tsx'

/**
 * One row per player in turn order. Route markers in hand are secret
 * (RULES.md §1.3): only the viewer's own hand is shown until the game ends,
 * even when the state on this device holds them all (hotseat).
 */
export function PlayersPanel({ state, players, myPlayerId }: { state: GameState; players: SeatInfo[]; myPlayerId: string | null }) {
  const g = state.game
  const completed = state.status === 'completed'
  const rows = [...g.order, ...g.seatOrder.filter((id) => !g.order.includes(id))]
  return (
    <Section title={completed ? 'Final standings' : 'Merchants'}>
      <ul className="flex flex-col gap-3">
        {rows.map((id) => {
          const p = g.players[id]
          const seat = state.players.find((s) => s.id === id)
          const position = g.order.indexOf(id)
          const score = g.scores?.[id] ?? (g.stage !== 'start' ? scoreOf(g, id) : null)
          const showHand = id === myPlayerId || completed
          return (
            <li key={id} className={`flex flex-col gap-1 rounded-md border border-neutral-800 p-3 text-sm ${seat?.eliminated ? 'opacity-50' : ''}`}>
              <div className="flex flex-wrap items-center gap-2">
                {position >= 0 && g.stage !== 'start' && <Badge className="border-neutral-600 font-mono text-neutral-200">{position + 1}</Badge>}
                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: colorOf(players, id) }} />
                <span className="font-medium">{nameOf(players, id)}</span>
                {id === myPlayerId && <Badge className="border-indigo-500 text-indigo-300">you</Badge>}
                {state.pendingPlayerIds.includes(id) && <Badge className="border-amber-500 text-amber-300">to act</Badge>}
                {state.winnerPlayerIds.includes(id) && <span>🏆</span>}
                {seat?.conceded && <span className="text-neutral-500">(conceded)</span>}
                <span className="ml-auto text-neutral-400">
                  ⛵ {p.city === null ? 'not placed' : CITIES[p.city].name} · <b className="text-neutral-200">{developmentPoints(g, id)}</b> / 5 DP
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-neutral-300">
                <span className="inline-flex items-center gap-1">
                  Goods: <GoodsList goods={p.goods} empty="none" />
                </span>
                <span>Raid markers: {p.raidMarkers}</span>
                {p.bonuses.map((b, i) => (
                  <Badge key={i} className="border-amber-700 text-amber-200">
                    <span title={BONUS_INFO[b].text}>{BONUS_INFO[b].name}</span>
                  </Badge>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-1 text-neutral-300">
                <span>Markers:</span>
                {showHand && p.hiddenHand === undefined ? <Hand markers={p.markers} /> : <span className="text-neutral-400">{p.hiddenHand ?? handSize(p)} hidden</span>}
              </div>
              {score && (
                <div className="flex flex-wrap gap-x-3 text-xs text-neutral-500">
                  <span>
                    {completed ? 'Final' : 'Now'}: <b className="text-neutral-300">{score.total} VP</b>
                  </span>
                  <span>houses {score.houses}</span>
                  <span>raid markers {score.raids}</span>
                  <span>bonuses {score.bonuses}</span>
                  <span>goods {score.goods}</span>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </Section>
  )
}

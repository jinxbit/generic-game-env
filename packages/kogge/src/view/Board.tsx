import type { SeatInfo } from '@game-platform/sdk/ui'
import { BONUS_INFO, BONUS_TYPES, CITIES, COLORS } from '../rules.ts'
import type { GameState } from '../rules.ts'
import { COLOR_HEX, colorOf, nameOf, visibleRoute } from './format.ts'
import { Badge, GoodDot, GoodsList, Marker } from './helpers.tsx'

/** Where each city sits on the 5×4 board grid (md and up), following the printed board. */
const PLACEMENT: Record<number, string> = {
  0: 'md:col-start-2 md:row-start-1',
  1: 'md:col-start-3 md:row-start-1',
  2: 'md:col-start-4 md:row-start-1',
  3: 'md:col-start-5 md:row-start-2',
  4: 'md:col-start-5 md:row-start-3',
  5: 'md:col-start-4 md:row-start-4',
  6: 'md:col-start-2 md:row-start-4',
  7: 'md:col-start-1 md:row-start-3',
  8: 'md:col-start-1 md:row-start-2',
}

export function Board({ state, players, myPlayerId }: { state: GameState; players: SeatInfo[]; myPlayerId: string | null }) {
  const g = state.game
  return (
    <div className="flex flex-col gap-3 md:grid md:grid-cols-5 md:grid-rows-[auto_auto_auto_auto]">
      <div className="order-first rounded-md border border-sky-900 bg-sky-950/40 p-3 md:col-span-3 md:col-start-2 md:row-span-2 md:row-start-2">
        <Sea state={state} />
      </div>
      {CITIES.map((info) => {
        const city = g.cities[info.id]
        const boats = g.seatOrder.filter((id) => g.players[id].city === info.id)
        const isGuildmaster = g.guildmaster === info.id
        return (
          <div key={info.id} className={`flex flex-col gap-2 rounded-md border border-neutral-800 bg-neutral-900/40 p-2 text-sm ${PLACEMENT[info.id]}`}>
            <div className="flex items-center gap-2 rounded px-2 py-1 font-medium text-neutral-900" style={{ backgroundColor: COLOR_HEX[info.color] }}>
              <span className="font-mono">{info.id}</span>
              <span className="flex-1 truncate">{info.name}</span>
              {isGuildmaster && <span title="Guildmaster">👑</span>}
              {g.guildmasterStart === info.id && <span title="Game Ends marker (the Guildmaster's start)">⌛</span>}
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs text-neutral-500">Routes</span>
              {city.routes.map((slot, i) => (
                <Marker key={i} value={visibleRoute(state, slot, myPlayerId)} faceDown={slot.faceDown} />
              ))}
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs text-neutral-500">Goods</span>
              <GoodsList goods={city.goods} />
            </div>
            {city.houses.length > 0 && (
              <div className="flex flex-col gap-0.5">
                {city.houses.map((house, i) => (
                  <div key={i} className="flex items-center gap-1 text-xs">
                    <span title="House">🏠</span>
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colorOf(players, house.owner) }} />
                    <span className="truncate">{nameOf(players, house.owner)}</span>
                    <GoodsList goods={house.goods} empty="" />
                  </div>
                ))}
              </div>
            )}
            {(boats.length > 0 || city.raids.length > 0) && (
              <div className="flex flex-wrap items-center gap-1 text-xs">
                {boats.map((id) => (
                  <Badge key={id} className="border-neutral-700 text-neutral-200">
                    <span className="mr-1 h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colorOf(players, id) }} />⛵ {nameOf(players, id)}
                  </Badge>
                ))}
                {city.raids.map((id, i) => (
                  <Badge key={`raid-${i}`} className="border-red-800 text-red-300">
                    <span className="mr-1 h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colorOf(players, id) }} />
                    raided
                  </Badge>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** The middle of the board: Guildmaster progress, the route-marker market, bonus markers and the supply. */
function Sea({ state }: { state: GameState }) {
  const g = state.game
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap gap-x-6 gap-y-1">
        <span>
          👑 Guildmaster in <b>{CITIES[g.guildmaster].name}</b>
        </span>
        <span className="text-neutral-400">
          Started in {CITIES[g.guildmasterStart].name} · back there {g.guildmasterLaps} of 2 times
          {g.guildmasterLaps >= 2 && state.status === 'active' && <b className="text-amber-300"> — final round</b>}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-neutral-400">Market:</span>
        {g.market.length === 0 && <span className="text-neutral-500">empty</span>}
        {g.market.map((lot, i) => (
          <span key={i} className="inline-flex gap-0.5 rounded border border-neutral-700 p-0.5" title={`Lot ${i + 1}`}>
            {lot.map((m, k) => (
              <Marker key={k} value={m} />
            ))}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-neutral-400">Bonus markers:</span>
        {BONUS_TYPES.map((b) => (
          <Badge key={b} className={g.bonusesAvailable[b] > 0 ? 'border-amber-700 text-amber-200' : 'border-neutral-800 text-neutral-600'}>
            <span title={BONUS_INFO[b].text}>
              {BONUS_INFO[b].name} ×{g.bonusesAvailable[b]}
            </span>
          </Badge>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-neutral-400">Supply:</span>
        {COLORS.map((c) => (
          <span key={c} className="inline-flex items-center gap-1 font-mono">
            <GoodDot color={c} />
            {g.supply[c]}
          </span>
        ))}
        <span className="text-neutral-400">Reserve: {g.hiddenReserve ?? g.reserve.reduce((a, b) => a + b, 0)} markers</span>
      </div>
    </div>
  )
}

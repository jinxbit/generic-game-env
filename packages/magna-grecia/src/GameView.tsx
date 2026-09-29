import { useMemo, useState } from 'react'
import type { GameViewProps } from '@game-platform/sdk/ui'
import { analyse, cellLabel, legalCityCells, legalMarkets, legalRoads, planCity, sellableMarkets } from './rules.ts'
import type { Dir, GameAction, GameData, GameOptions } from './types.ts'
import { ActionPanel, type Mode } from './view/ActionPanel.tsx'
import { Board } from './view/Board.tsx'
import { CardPanel, PlayersPanel } from './view/Panels.tsx'
import { nameOf } from './view/helpers.ts'

/**
 * Magna Grecia's table: the round's card and turn order, the turn player's
 * controls, the map (every placement happens by clicking a ringed space) and
 * the players' points and scores. Nothing is secret, so every viewer sees the
 * same thing. The rules (./rules.ts) validate every submission; the view only
 * rings what they would accept.
 */
export function GameView({ state, players, myPlayerId, submitting, onAction }: GameViewProps<GameData, GameOptions, GameAction>) {
  const g = state.game
  const analysis = useMemo(() => analyse(g), [g])
  const myTurn = state.status === 'active' && myPlayerId !== null && state.pendingPlayerIds.includes(myPlayerId)

  const targets = useMemo(() => {
    const road = new Map<number, [Dir, Dir][]>()
    const city = new Map<number, string>()
    const market = new Map<number, string>()
    const sell = new Map<number, string>()
    if (!myTurn) return { road, city, market, sell }
    for (const { cell, ends } of legalRoads(g)) road.set(cell, [...(road.get(cell) ?? []), ends])
    for (const cell of legalCityCells(g, analysis)) {
      const plan = planCity(g, analysis, g.turnPlayerId!, cell)
      const what = plan.ok && plan.founds ? 'found a city' : 'expand your city'
      city.set(cell, plan.ok && plan.tiles.length === 2 ? `${what} with 2 tiles, bridging onto the village (2 points)` : `${what} (1 point)`)
    }
    for (const { cell, cost } of legalMarkets(g, analysis)) {
      const cityTiles = analysis.tilesOf.get(cell)
      for (const tile of cityTiles ?? [cell]) market.set(tile, `build a market for ${cost} point${cost === 1 ? '' : 's'} (ends your turn)`)
    }
    for (const { market: m, value } of sellableMarkets(g, analysis)) sell.set(m.cell, `sell this market for ${value} point${value === 1 ? '' : 's'} (ends your turn)`)
    return { road, city, market, sell }
  }, [g, analysis, myTurn])

  const counts: Record<Mode, number> = { road: targets.road.size, city: targets.city.size, market: targets.market.size, sell: targets.sell.size }
  const [chosenMode, setMode] = useState<Mode>('city')
  const mode: Mode = counts[chosenMode] > 0 ? chosenMode : ((['city', 'road', 'market', 'sell'] as Mode[]).find((m) => counts[m] > 0) ?? chosenMode)
  const [roadCell, setRoadCell] = useState<number | null>(null)
  const pickedRoad = mode === 'road' && roadCell !== null && targets.road.has(roadCell) ? roadCell : null

  const highlight = !myTurn
    ? null
    : mode === 'road'
      ? new Map([...targets.road].map(([cell, shapes]) => [cell, `road: ${shapes.length} shape${shapes.length === 1 ? '' : 's'}`]))
      : targets[mode]

  const onCell = (cell: number) => {
    if (!myPlayerId) return
    if (mode === 'road') {
      const shapes = targets.road.get(cell) ?? []
      if (shapes.length === 1) onAction({ type: 'PLACE_ROAD', playerId: myPlayerId, cell, ends: shapes[0] })
      else setRoadCell(cell)
    } else if (mode === 'city') onAction({ type: 'PLACE_CITY', playerId: myPlayerId, cell })
    else if (mode === 'market') onAction({ type: 'BUILD_MARKET', playerId: myPlayerId, cell })
    else onAction({ type: 'SELL_MARKET', playerId: myPlayerId, cell })
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="text-lg font-semibold">
          Round {g.round} of {g.rounds}
        </h2>
        <span className="text-sm text-neutral-400">{state.status === 'active' ? `${nameOf(players, g.turnPlayerId)} is building` : 'Game over'}</span>
      </header>
      <CardPanel state={state} players={players} />
      <ActionPanel
        state={state}
        players={players}
        myPlayerId={myPlayerId}
        submitting={submitting}
        onAction={onAction}
        mode={mode}
        modes={counts}
        onMode={(m) => {
          setMode(m)
          setRoadCell(null)
        }}
        roadCell={pickedRoad === null ? null : { cell: pickedRoad, label: cellLabel(pickedRoad) }}
        roadShapes={pickedRoad === null ? [] : (targets.road.get(pickedRoad) ?? [])}
      />
      <Board game={g} analysis={analysis} players={players} highlight={highlight} selected={pickedRoad} disabled={submitting} onCell={onCell} />
      <p className="text-xs text-neutral-500">
        Green-bordered villages can be settled from the start; inland villages once your road reaches them. Markets: filled = active or waiting for a road, faded = inactive, hollow = sold. An oracle’s dot
        and arrow show whose city it attends to (4 points at the end).
      </p>
      <PlayersPanel state={state} players={players} analysis={analysis} />
    </div>
  )
}

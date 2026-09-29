import { useState } from 'react'
import type { SeatInfo } from '@game-platform/sdk/ui'
import { allowanceLeft, type GameState } from '../rules.ts'
import type { Dir, GameAction } from '../types.ts'
import { BTN, BTN_ACTIVE, BTN_PRIMARY, INPUT, nameOf, roadPath, shapeName } from './helpers.ts'

export type Mode = 'road' | 'city' | 'market' | 'sell'

const MODE_LABELS: Record<Mode, string> = {
  road: 'Build roads',
  city: 'Place city tiles',
  market: 'Build a market',
  sell: 'Sell a market',
}

function RoadShapes({ cell, shapes, disabled, onPick }: { cell: string; shapes: [Dir, Dir][]; disabled: boolean; onPick: (ends: [Dir, Dir]) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-neutral-300">Choose the road for {cell}:</p>
      <div className="flex flex-wrap gap-2">
        {shapes.map((ends) => (
          <button key={ends.join('')} type="button" aria-label={shapeName(ends)} title={shapeName(ends)} disabled={disabled} onClick={() => onPick(ends)} className={`${BTN} p-1`}>
            <svg viewBox="0 0 40 40" className="h-10 w-10">
              <rect width="40" height="40" fill="#3f3a33" />
              <path d={roadPath(ends)} fill="none" stroke="#e5e5e5" strokeWidth="7" />
            </svg>
          </button>
        ))}
      </div>
    </div>
  )
}

function ResupplyControls({ state, me, submitting, onAction }: { state: GameState; me: string; submitting: boolean; onAction: (a: GameAction) => void }) {
  const g = state.game
  const p = g.players[me]
  const left = allowanceLeft(g).resupply
  const [roads, setRoads] = useState(0)
  const [cities, setCities] = useState(0)
  if (left === 0 || p.staging.roads + p.staging.cities === 0) return null
  const clamp = (value: string, max: number) => Math.max(0, Math.min(max, Math.floor(Number(value) || 0)))
  const total = roads + cities
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-neutral-400">Resupply (up to {left}, last):</span>
      <label className="flex items-center gap-1">
        roads
        <input type="number" min={0} max={p.staging.roads} aria-label="Road tiles to resupply" value={roads} disabled={submitting} onChange={(e) => setRoads(clamp(e.target.value, p.staging.roads))} className={`${INPUT} w-14 text-center`} />
      </label>
      <label className="flex items-center gap-1">
        cities
        <input type="number" min={0} max={p.staging.cities} aria-label="City tiles to resupply" value={cities} disabled={submitting} onChange={(e) => setCities(clamp(e.target.value, p.staging.cities))} className={`${INPUT} w-14 text-center`} />
      </label>
      <button type="button" className={BTN} disabled={submitting || total < 1 || total > left} onClick={() => onAction({ type: 'RESUPPLY', playerId: me, roads, cities })}>
        Resupply {total}
      </button>
    </div>
  )
}

/**
 * The turn player's controls: which kind of move clicking the map makes, the
 * road-shape choice for a picked space, resupply and ending the turn.
 * Placement itself happens on the map; the rules re-check everything.
 */
export function ActionPanel({
  state,
  players,
  myPlayerId,
  submitting,
  onAction,
  mode,
  modes,
  onMode,
  roadCell,
  roadShapes,
}: {
  state: GameState
  players: SeatInfo[]
  myPlayerId: string | null
  submitting: boolean
  onAction: (a: GameAction) => void
  mode: Mode
  /** How many clickable targets each mode has right now. */
  modes: Record<Mode, number>
  onMode: (mode: Mode) => void
  roadCell: { cell: number; label: string } | null
  roadShapes: [Dir, Dir][]
}) {
  const g = state.game
  if (state.status !== 'active') return null
  const mine = myPlayerId !== null && state.pendingPlayerIds.includes(myPlayerId)
  if (!mine) {
    return <section className="rounded-md border border-neutral-800 p-4 text-sm text-neutral-400">Waiting for {nameOf(players, g.turnPlayerId)} to build.</section>
  }
  const me = myPlayerId!
  const p = g.players[me]
  const left = allowanceLeft(g)
  return (
    <section className="flex flex-col gap-3 rounded-md border border-indigo-700/60 p-4">
      <h2 className="font-medium">Your turn</h2>
      <p className="text-sm text-neutral-400">
        This turn you may still place {left.roads} road tile{left.roads === 1 ? '' : 's'} ({p.supply.roads} in supply) and {left.cities} city tile{left.cities === 1 ? '' : 's'} ({p.supply.cities} in
        supply, 1 point each). You have {p.points} point{p.points === 1 ? '' : 's'}. Building or selling a market ends your turn.
      </p>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="What clicking the map does">
        {(Object.keys(MODE_LABELS) as Mode[]).map((m) => (
          <button key={m} type="button" role="radio" aria-checked={mode === m} className={mode === m ? BTN_ACTIVE : BTN} disabled={modes[m] === 0} onClick={() => onMode(m)}>
            {MODE_LABELS[m]} ({modes[m]})
          </button>
        ))}
      </div>
      {mode === 'road' && roadCell && roadShapes.length > 0 && (
        <RoadShapes cell={roadCell.label} shapes={roadShapes} disabled={submitting} onPick={(ends) => onAction({ type: 'PLACE_ROAD', playerId: me, cell: roadCell.cell, ends })} />
      )}
      {modes[mode] > 0 && !(mode === 'road' && roadCell) && <p className="text-xs text-neutral-500">Click a ringed space on the map.</p>}
      <ResupplyControls key={`${g.round}-${me}`} state={state} me={me} submitting={submitting} onAction={onAction} />
      <div>
        <button type="button" className={BTN_PRIMARY} disabled={submitting} onClick={() => onAction({ type: 'END_TURN', playerId: me })}>
          End turn
        </button>
      </div>
    </section>
  )
}

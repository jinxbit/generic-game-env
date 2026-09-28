import { useState } from 'react'
import type { GameViewProps } from '@game-platform/sdk/ui'
import { placementsForRoll, STEP_LABELS } from './rules.ts'
import type { Colour, GameAction, GameData, GameOptions } from './types.ts'
import { ActionPanel } from './view/ActionPanel.tsx'
import { Board } from './view/Board.tsx'
import { nameOf } from './view/helpers.ts'
import { LastMove, Market, PlayersPanel } from './view/Panels.tsx'

/**
 * Shark's table: whose turn it is, the action panel for the current step,
 * the board (placement happens by clicking a ringed box), the stock exchange
 * and the players. Nothing is secret, so every viewer sees the same thing.
 * The rules (./rules.ts) validate every submission; the controls only guide.
 */
export function GameView({ state, players, myPlayerId, submitting, onAction }: GameViewProps<GameData, GameOptions, GameAction>) {
  const g = state.game
  const placing = g.step === 'place' && myPlayerId !== null && state.pendingPlayerIds.includes(myPlayerId)
  const legal = placing ? placementsForRoll(g) : []
  const placeOptions = [...new Set(legal.map((p) => p.colour))]
  const [chosen, setChosen] = useState<Colour | null>(null)
  const placeColour = placing ? (chosen && placeOptions.includes(chosen) ? chosen : (placeOptions[0] ?? null)) : null
  const legalCells = new Set(legal.filter((p) => p.colour === placeColour).map((p) => p.cell))

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="text-lg font-semibold">Turn {state.turn}</h2>
        {state.status === 'active' ? (
          <span className="text-sm text-neutral-400">
            {nameOf(players, g.turnPlayerId)} · {STEP_LABELS[g.step]}
            {g.roll && g.step !== 'preTrade' && ` · rolled ${g.roll.colour}, zone ${g.roll.zone}`}
          </span>
        ) : (
          <span className="text-sm text-neutral-400">
            Game over
            {g.endReason && (g.endReason.kind === 'priceCap' ? ` — ${g.endReason.colour} reached the top of the scale` : ` — the ${g.endReason.colour} markers ran out`)}
          </span>
        )}
      </header>
      <ActionPanel
        state={state}
        players={players}
        myPlayerId={myPlayerId}
        submitting={submitting}
        onAction={onAction}
        placeColour={placeColour}
        placeOptions={placeOptions}
        onPlaceColour={setChosen}
      />
      <Board
        game={g}
        placeColour={placeColour}
        legalCells={legalCells}
        disabled={submitting}
        onPlace={(cell) => myPlayerId && placeColour && onAction({ type: 'PLACE', playerId: myPlayerId, cell, colour: placeColour })}
      />
      <LastMove game={g} players={players} />
      <Market game={g} />
      <PlayersPanel state={state} players={players} />
    </div>
  )
}

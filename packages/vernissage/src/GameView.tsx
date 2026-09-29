import type { GameViewProps } from '@game-platform/sdk/ui'
import { END_REASONS, STEP_LABELS } from './rules.ts'
import type { GameAction, GameData, GameOptions } from './types.ts'
import { ActionPanel } from './view/ActionPanel.tsx'
import { FameScale, Staircase } from './view/Board.tsx'
import { nameOf } from './view/helpers.ts'
import { HandPanel, LastTrial, Market, PlayersPanel } from './view/Panels.tsx'

/**
 * Vernissage's table: whose turn it is, the action panel for the current
 * step, the success staircase with agents and fate counters, the scale of
 * fame, the viewer's hand, the cards for sale and the galleries. Other hands
 * and face-down cards reach the view as nulls (redactGame), so it only ever
 * shows what the viewer may see. The rules (./rules.ts) validate every
 * submission; the controls only guide.
 */
export function GameView({ state, players, myPlayerId, submitting, onAction }: GameViewProps<GameData, GameOptions, GameAction>) {
  const g = state.game
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="text-lg font-semibold">Turn {state.turn}</h2>
        <span className="text-sm text-neutral-400">
          {state.status === 'active' ? `${nameOf(players, g.turnPlayerId)} · ${STEP_LABELS[g.step]}` : `Game over${g.endReason ? ` — ${END_REASONS[g.endReason]}` : ''}`}
        </span>
      </header>
      <ActionPanel state={state} players={players} myPlayerId={myPlayerId} submitting={submitting} onAction={onAction} />
      {myPlayerId && g.players[myPlayerId] && <HandPanel game={g} me={myPlayerId} />}
      <Staircase game={g} players={players} />
      <FameScale game={g} />
      <LastTrial game={g} players={players} />
      <Market game={g} />
      <PlayersPanel state={state} players={players} />
    </div>
  )
}

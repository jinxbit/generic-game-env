import type { GameViewProps } from '@game-platform/sdk/ui'
import { formatChips, STEP_LABELS } from './rules.ts'
import type { GameAction, GameData, GameOptions } from './types.ts'
import { ActionPanel } from './view/ActionPanel.tsx'
import { LastHand, Standings } from './view/Results.tsx'
import { Board, Seats } from './view/Table.tsx'

/**
 * The poker table: the hand and blinds, the action panel for whoever is to
 * act, the board and pot, every seat, and the last hand's showdown. Only the
 * viewer's own hole cards are ever shown face up. The rules (./rules.ts)
 * validate every submission; the controls only guide.
 */
export function GameView({ state, players, myPlayerId, submitting, onAction }: GameViewProps<GameData, GameOptions, GameAction>) {
  const g = state.game
  const active = state.status === 'active'
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="text-lg font-semibold">Hand {g.hand}</h2>
        <span className="text-sm text-neutral-400">
          {active ? (
            <>
              {STEP_LABELS[g.step]} · blinds {formatChips(g.blinds.small)}/{formatChips(g.blinds.big)}
              {state.options.maxHands > 0 && ` · of ${state.options.maxHands}`}
            </>
          ) : (
            <>Game over{g.endReason === 'handLimit' ? ' — the hand limit was reached' : ''}</>
          )}
        </span>
      </header>
      <ActionPanel state={state} players={players} myPlayerId={myPlayerId} submitting={submitting} onAction={onAction} />
      {active && <Board state={state} />}
      {active ? <Seats state={state} players={players} myPlayerId={myPlayerId} /> : <Standings state={state} players={players} />}
      {g.lastHand && <LastHand result={g.lastHand} players={players} />}
    </div>
  )
}

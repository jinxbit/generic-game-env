import type { GameViewProps } from '@game-platform/sdk/ui'
import type { GameAction, GameData, GameOptions } from './types.ts'
import { ActionPanel } from './view/ActionPanel.tsx'
import { Board } from './view/Board.tsx'
import { PlayersPanel } from './view/PlayersPanel.tsx'

/**
 * Kogge's board: the action panel for whatever the viewer may do now, the
 * merchants in turn order, and the Baltic with its nine cities laid out as on
 * the printed board. The rules (./rules.ts) validate every submission, so the
 * controls only guide.
 */
export function GameView({ state, players, myPlayerId, submitting, onAction }: GameViewProps<GameData, GameOptions, GameAction>) {
  return (
    <div className="flex flex-col gap-4">
      <ActionPanel state={state} players={players} myPlayerId={myPlayerId} submitting={submitting} onAction={onAction} />
      <Board state={state} players={players} myPlayerId={myPlayerId} />
      <PlayersPanel state={state} players={players} myPlayerId={myPlayerId} />
    </div>
  )
}

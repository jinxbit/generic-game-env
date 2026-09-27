import type { GameViewProps } from '@game-platform/sdk/ui'
import type { GameAction, GameData, GameOptions } from './types.ts'
import { ActionPanel } from './view/ActionPanel.tsx'
import { Board } from './view/Board.tsx'
import { Header } from './view/Header.tsx'
import { PlayersPanel } from './view/PlayersPanel.tsx'
import { Summaries } from './view/Summaries.tsx'

/**
 * Incorporated's board: the header (turn, phase, sliders, payoffs, Outlook),
 * the action panel driven by `state.game.prompt`, the corporations, recent
 * events and the world map. Everything the player may do is an answer to the
 * current prompt, plus a loan during Investment and Competition — the rules
 * (./rules.ts) validate every submission, so the controls only guide.
 */
export function GameView({ state, players, myPlayerId, submitting, onAction }: GameViewProps<GameData, GameOptions, GameAction>) {
  return (
    <div className="flex flex-col gap-4">
      <Header state={state} />
      <ActionPanel state={state} players={players} myPlayerId={myPlayerId} submitting={submitting} onAction={onAction} />
      <PlayersPanel state={state} players={players} myPlayerId={myPlayerId} />
      <Summaries game={state.game} players={players} />
      <Board game={state.game} players={players} />
    </div>
  )
}

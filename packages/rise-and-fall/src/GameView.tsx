// Rise & Fall's game view — the game area of the standalone app's game page,
// minus everything the platform's shell now provides around it (the
// narration log, chat, undo/redo, concede, admin mode, history review and
// its stepping, the hotseat hand-off, game export).
//
// The components under ./view/ are the standalone app's, carried over nearly
// verbatim: they read the engine's flat state, so this view renders
// `toEngine(state)` and hands them the engine content for this game
// (`contentFor`). Board setup, the round and the end-of-game screen are
// BoardSetupView, RoundView and EndGameView as before.
//
// What this view adds back from the old game page:
// - the old "Show history" review's overlays — halos and arrows on the units
//   that acted, resource and score changes, the card-choice recap — drawn on
//   whatever step the platform's history review is showing
//   (GameViewProps.review, ./view/useStepExplanation.ts; the stepping, a turn
//   at a time by this game's own turns, is the platform's);
// - the territory-control overlay (./view/GameToolbar.tsx);
// - the end-of-game charts, which replay the whole log (./view/history.ts);
// - the display settings that used to live on the player's profile, now
//   stored per browser (./view/preferences.ts).
//
// Every submission goes through `onAction`; the rules validate it. The
// panels only offer controls to a viewer in `pendingPlayerIds`, apart from
// the "take back my pick" buttons (RETRACT_CHOICE / RETRACT_DECLINE), which
// belong to a player who has already acted.

import type { GameViewProps } from '@game-platform/sdk/ui'
import { useMemo, useState } from 'react'
import type { Coordinate } from './engine/types.ts'
import { calculateScoreHistory } from './engine/scoreHistory.ts'
import { calculateGoldSpendingByCategory, calculateUnitValueDetail } from './engine/unitValue.ts'
import { contentFor, toEngine } from './rules.ts'
import type { GameAction, GameData, GameOptions } from './types.ts'
import { BoardSetupView } from './view/BoardSetupView.tsx'
import { EndGameView } from './view/EndGameView.tsx'
import { GameToolbar } from './view/GameToolbar.tsx'
import { replayableHistory, safeEngineGenesis } from './view/history.ts'
import { usePreferences } from './view/preferences.ts'
import { RoundView } from './view/RoundView.tsx'
import { useStepExplanation, type TerritoryControlMode } from './view/useStepExplanation.ts'
import { ViewSettings } from './view/ViewSettings.tsx'

export function GameView({ state, players, myPlayerId, submitting, onAction, review }: GameViewProps<GameData, GameOptions, GameAction>) {
  const engine = useMemo(() => toEngine(state), [state])
  const content = contentFor(state)
  const [preferences, setPreferences] = usePreferences()
  const [liveTerritoryControlOn, setLiveTerritoryControlOn] = useState(false)
  const [territoryControlMode, setTerritoryControlMode] = useState<TerritoryControlMode>('changes')

  // Genesis depends only on these; keyed on their contents so a refetched but
  // unchanged state doesn't rebuild it (and invalidate every replay below).
  const genesisKey = JSON.stringify([
    state.gameId,
    state.playMode,
    state.players.map((p) => [p.id, p.displayName, p.color]),
    state.options,
    state.game.seating,
    state.hiddenInformationEnabled,
    Boolean(state.lockRevealedInformationEnabled),
  ])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const genesis = useMemo(() => safeEngineGenesis(state), [genesisKey])
  const history = useMemo(() => replayableHistory(state), [state])

  const explanation = useStepExplanation({ state, review, genesis, content })

  /** The end-of-game charts' series — each replays the whole game, so only once it's over. Null (charts hidden) if a replay fails. */
  const endGame = useMemo(() => {
    if (engine.status !== 'completed' || !genesis) return null
    const { unitContent, achievementContent, boardGenerationContent, taleContent } = content
    try {
      return {
        scoreHistory: calculateScoreHistory(genesis, history, unitContent, achievementContent, boardGenerationContent, taleContent),
        unitValueDetail: calculateUnitValueDetail(engine, genesis, history, unitContent, achievementContent, boardGenerationContent, taleContent),
        spendingBreakdown: calculateGoldSpendingByCategory(genesis, history, unitContent, achievementContent, boardGenerationContent, taleContent),
      }
    } catch {
      return null
    }
  }, [engine, genesis, history, content])

  function submit(build: (playerId: string) => GameAction) {
    if (!myPlayerId || submitting) return
    onAction(build(myPlayerId))
  }

  let body
  if (explanation && engine.status !== 'completed') {
    body =
      engine.status === 'boardSetup' ? (
        <BoardSetupView state={engine} players={players} myPlayerId={null} boardGenerationContent={content.boardGenerationContent} onPlaceTile={() => {}} onPlaceUnit={() => {}} />
      ) : (
        <RoundView
          state={engine}
          players={players}
          myPlayerId={null}
          unitContent={content.unitContent}
          achievementContent={content.achievementContent}
          taleContent={content.taleContent}
          unitPlateColors={preferences.unitPlateColors}
          unitReserveDisplayMode={preferences.unitReserveDisplayMode}
          turnReview={explanation.turnHalos}
          showHistory
          showBankRow
          showCardChoiceRecap={explanation.showCardChoiceRecap}
          cardChoiceRecapPhase={explanation.cardChoiceRecapPhase}
          cardChoiceRecap={explanation.cardChoiceRecap ?? undefined}
          territoryControlMode={territoryControlMode}
          previousHistoryState={explanation.previousState}
          onChooseCard={() => {}}
          onResolveUnit={() => {}}
          onResolveBulkAction={() => {}}
          onResolveSupportedAction={() => {}}
          onPassActions={() => {}}
          onMoveToDecline={() => {}}
          onPurchaseCard={() => {}}
          onPassPurchase={() => {}}
        />
      )
  } else if (engine.status === 'boardSetup') {
    body = (
      <BoardSetupView
        state={engine}
        players={players}
        myPlayerId={myPlayerId}
        boardGenerationContent={content.boardGenerationContent}
        onPlaceTile={(anchor: Coordinate, rotationSteps: number) => submit((playerId) => ({ type: 'PLACE_TILE', playerId, anchor, rotationSteps }))}
        onPlaceUnit={(unitKind: string, coord: Coordinate) => submit((playerId) => ({ type: 'PLACE_UNIT', playerId, unitKind, coord }))}
        submitting={submitting}
      />
    )
  } else if (engine.status === 'completed') {
    body = (
      <EndGameView
        state={engine}
        players={players}
        achievementContent={content.achievementContent}
        taleContent={content.taleContent}
        scoreHistory={endGame?.scoreHistory.snapshots}
        achievementClaims={endGame?.scoreHistory.achievementClaims}
        unitValueDetail={endGame?.unitValueDetail}
        spendingBreakdown={endGame?.spendingBreakdown}
      />
    )
  } else {
    body = (
      <RoundView
        state={engine}
        players={players}
        myPlayerId={myPlayerId}
        unitContent={content.unitContent}
        achievementContent={content.achievementContent}
        taleContent={content.taleContent}
        unitPlateColors={preferences.unitPlateColors}
        unitReserveDisplayMode={preferences.unitReserveDisplayMode}
        confirmBeforeRevealingCards={preferences.confirmBeforeRevealingCards}
        submitting={submitting}
        turnReview={null}
        showHistory={false}
        showBankRow
        territoryControlMode="off"
        liveTerritoryControlOn={liveTerritoryControlOn}
        previousHistoryState={null}
        onChooseCard={(cardId) => submit((playerId) => ({ type: 'CHOOSE_CARD', playerId, cardId }))}
        onResolveUnit={(unitId, actionId, target) => submit((playerId) => ({ type: 'RESOLVE_UNIT_ACTION', playerId, unitActions: [{ unitId, actionId, target }] }))}
        onResolveBulkAction={(unitIds, actionId) => submit((playerId) => ({ type: 'RESOLVE_UNIT_ACTION', playerId, unitActions: unitIds.map((unitId) => ({ unitId, actionId })) }))}
        onResolveSupportedAction={(supportAssignments, primary) => submit((playerId) => ({ type: 'RESOLVE_UNIT_ACTION', playerId, unitActions: [...supportAssignments, primary] }))}
        onPassActions={() => submit((playerId) => ({ type: 'PASS_ACTIONS', playerId }))}
        onMoveToDecline={(cardId) => submit((playerId) => ({ type: 'MOVE_TO_DECLINE', playerId, cardId }))}
        onPurchaseCard={(cardId) => submit((playerId) => ({ type: 'PURCHASE_CARD', playerId, cardId }))}
        onPassPurchase={() => submit((playerId) => ({ type: 'PASS_PURCHASE', playerId }))}
        onRetractChoice={() => submit((playerId) => ({ type: 'RETRACT_CHOICE', playerId }))}
        onRetractDecline={() => submit((playerId) => ({ type: 'RETRACT_DECLINE', playerId }))}
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <GameToolbar
        reviewing={explanation !== null && engine.status === 'active'}
        territoryControlMode={territoryControlMode}
        onTerritoryControlModeChange={setTerritoryControlMode}
        showTerritoryToggle={engine.status === 'active'}
        liveTerritoryControlOn={liveTerritoryControlOn}
        onToggleLiveTerritoryControl={() => setLiveTerritoryControlOn((on) => !on)}
      />
      {body}
      <ViewSettings value={preferences} onChange={setPreferences} />
    </div>
  )
}

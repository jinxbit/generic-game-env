// A player conceding during board setup — CONCEDE's board-setup branch
// (dispatchAction, ./applyAction.ts). The round phases' concede is
// applyConcede there; this one was added with the move onto the platform,
// which lets a player concede at any point of an active game, board setup
// included, where the standalone app never offered it. It keeps the setup
// rotation well-formed without the leaver.
//
// Tile and unit placement each follow a wrapping index into `turnOrder`
// (BoardSetupState, ./engine/types.ts). Removing a player from `turnOrder`
// shifts every later seat down one, so the index is re-pointed at whoever
// would have placed next — which keeps the round-robin's shape (those
// earlier in this lap have placed one more unit than those after), so unit
// placement never lands on a player with nothing left to place.
//
// Server-reachable: keep the `.ts` extensions.

import { currentTilePlacerId, currentUnitPlacerId } from './boardSetup.ts'
import { syncCardZonesWithBoard } from './cards.ts'
import { eliminatePlayer } from './elimination.ts'
import { beginSelectCardsPhase } from './round.ts'
import type { GameState as EngineState } from './types.ts'

/** Who places after `current` once `leaverId` is gone — `current` itself unless it's the leaver, then the next seat round. */
function nextPlacerAfterLeaving(turnOrder: string[], current: string | null, leaverId: string): string | null {
  if (current === null) return null
  if (current !== leaverId) return current
  const index = turnOrder.indexOf(leaverId)
  for (let step = 1; step < turnOrder.length; step++) {
    const candidate = turnOrder[(index + step) % turnOrder.length]
    if (candidate !== leaverId) return candidate
  }
  return null
}

export function concedeDuringBoardSetup(state: EngineState, playerId: string, companionKindsByCardKind: Record<string, string[]>): EngineState {
  const boardSetup = state.boardSetup
  if (state.status !== 'boardSetup' || !boardSetup) return state

  const nextTilePlacer = boardSetup.builderId ? null : nextPlacerAfterLeaving(state.turnOrder, currentTilePlacerId(state), playerId)
  const nextUnitPlacer = nextPlacerAfterLeaving(state.turnOrder, currentUnitPlacerId(state), playerId)

  const eliminated = eliminatePlayer(state, playerId, true)
  if (eliminated.status === 'completed') return eliminated

  const turnOrder = eliminated.turnOrder
  const unitsRemainingByPlayerId = { ...boardSetup.unitsRemainingByPlayerId }
  delete unitsRemainingByPlayerId[playerId]
  const indexOf = (id: string | null, fallback: number) => (id !== null && turnOrder.includes(id) ? turnOrder.indexOf(id) : fallback)

  let next: EngineState = {
    ...eliminated,
    boardSetup: {
      ...boardSetup,
      // A solo builder who leaves hands the rest of the map to everyone.
      builderId: boardSetup.builderId === playerId ? null : (boardSetup.builderId ?? null),
      tilePlacerIndex: indexOf(nextTilePlacer, boardSetup.tilePlacerIndex),
      unitPlacerIndex: indexOf(nextUnitPlacer, boardSetup.unitPlacerIndex),
      unitsRemainingByPlayerId,
    },
  }

  const unitPlacementStarted = boardSetup.tileTierQueue.length === 0 && Object.keys(boardSetup.unitsRemainingByPlayerId).length > 0
  if (unitPlacementStarted && Object.values(unitsRemainingByPlayerId).every((kinds) => kinds.length === 0)) {
    next = syncCardZonesWithBoard({ ...next, status: 'active', boardSetup: null }, companionKindsByCardKind)
    next = beginSelectCardsPhase(next)
  }
  return next
}

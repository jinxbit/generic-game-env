// Rules for the example game, "Unique Pick" (see ./types.ts for the rules in
// one paragraph). This is the file to replace when building a new game: it
// implements the GameDefinition contract (../engine/gameDefinition.ts) that
// the framework calls into for everything game-specific.
//
// Pure and deterministic, like everything the engine runs — imported by the
// Edge Functions too, so keep the `.ts` extensions on relative imports.

import type { LoggedAction } from '../engine/actions.ts'
import type { ActionDescription, GameDefinition } from '../engine/gameDefinition.ts'
import type { ActionResult, GameState } from '../engine/types.ts'
import type { GameAction, GameData, GameOptions, RoundResult } from './types.ts'

/** Picks range from 1 to this, inclusive. */
export const MAX_PICK = 5

export const DEFAULT_GAME_OPTIONS: GameOptions = { targetScore: 12, maxRounds: 10 }

/** Bounds CreateGamePage/LobbyPage offer and setup clamps to. */
export const TARGET_SCORE_RANGE = { min: 5, max: 30 }
export const MAX_ROUNDS_RANGE = { min: 1, max: 30 }

export const PICK_PHASE = 'pick'

function clamp(value: number, range: { min: number; max: number }): number {
  if (!Number.isFinite(value)) return range.min
  return Math.max(range.min, Math.min(range.max, Math.round(value)))
}

/** Fills in and clamps possibly-missing/out-of-range options from a stored settings row. */
export function normalizeGameOptions(options: Partial<GameOptions> | null | undefined): GameOptions {
  return {
    targetScore: clamp(options?.targetScore ?? DEFAULT_GAME_OPTIONS.targetScore, TARGET_SCORE_RANGE),
    maxRounds: clamp(options?.maxRounds ?? DEFAULT_GAME_OPTIONS.maxRounds, MAX_ROUNDS_RANGE),
  }
}

function activePlayerIds(state: GameState): string[] {
  return state.players.filter((p) => !p.eliminated).map((p) => p.id)
}

/** Opens a new round: everyone still in the game owes a pick. */
function beginRound(state: GameState, round: number): GameState {
  const ids = activePlayerIds(state)
  return {
    ...state,
    turn: round,
    phase: PICK_PHASE,
    activePlayerId: null,
    pendingPlayerIds: ids,
    game: { ...state.game, picks: Object.fromEntries(ids.map((id) => [id, null])) },
  }
}

function highestScorers(state: GameState): string[] {
  const ids = activePlayerIds(state)
  const best = Math.max(...ids.map((id) => state.game.scores[id] ?? 0))
  return ids.filter((id) => (state.game.scores[id] ?? 0) === best)
}

function finishGame(state: GameState, winnerPlayerIds: string[]): GameState {
  return { ...state, status: 'completed', phase: null, activePlayerId: null, pendingPlayerIds: [], winnerPlayerIds }
}

/**
 * Reveals and scores the current round once nobody is pending, then either
 * ends the game or opens the next round.
 */
function resolveRound(state: GameState): GameState {
  const picks: Record<string, number> = {}
  for (const id of activePlayerIds(state)) {
    const value = state.game.picks[id]
    if (typeof value === 'number') picks[id] = value
  }
  const counts = new Map<number, number>()
  for (const value of Object.values(picks)) counts.set(value, (counts.get(value) ?? 0) + 1)

  const pointsByPlayerId: Record<string, number> = {}
  const scores = { ...state.game.scores }
  for (const [id, value] of Object.entries(picks)) {
    const points = counts.get(value) === 1 ? value : 0
    pointsByPlayerId[id] = points
    scores[id] = (scores[id] ?? 0) + points
  }
  const result: RoundResult = { round: state.turn, picks, pointsByPlayerId }
  const scored: GameState = { ...state, game: { ...state.game, scores, rounds: [...state.game.rounds, result] } }

  const reachedTarget = activePlayerIds(scored).some((id) => (scores[id] ?? 0) >= scored.options.targetScore)
  if (reachedTarget || state.turn >= scored.options.maxRounds) {
    return finishGame(scored, highestScorers(scored))
  }
  return beginRound(scored, state.turn + 1)
}

function applyPickNumber(state: GameState, playerId: string, value: number): ActionResult {
  const player = state.players.find((p) => p.id === playerId)
  if (!player) return { ok: false, error: `Unknown player: ${playerId}` }
  if (player.eliminated) return { ok: false, error: 'You are no longer in this game.' }
  if (state.phase !== PICK_PHASE) return { ok: false, error: 'Not in the picking phase.' }
  if (!Number.isInteger(value) || value < 1 || value > MAX_PICK) return { ok: false, error: `Pick a whole number from 1 to ${MAX_PICK}.` }
  // A player may change their pick until the round resolves — the round
  // resolves the moment the last pending player picks, so there's never an
  // already-revealed pick to change.
  if (state.game.picks[playerId] === value) return { ok: false, error: `You already picked ${value}.` }

  const next: GameState = {
    ...state,
    pendingPlayerIds: state.pendingPlayerIds.filter((id) => id !== playerId),
    game: { ...state.game, picks: { ...state.game.picks, [playerId]: value } },
  }
  return { ok: true, state: next.pendingPlayerIds.length === 0 ? resolveRound(next) : next }
}

export const gameDefinition: GameDefinition = {
  defaultOptions: DEFAULT_GAME_OPTIONS,
  minPlayers: 2,
  maxPlayers: 6,

  setup(lobby, options) {
    const game: GameData = {
      picks: {},
      scores: Object.fromEntries(lobby.players.map((p) => [p.id, 0])),
      rounds: [],
    }
    return beginRound({ ...lobby, status: 'active', options: normalizeGameOptions(options), game }, 1)
  },

  applyAction(state, action: GameAction) {
    switch (action.type) {
      case 'PICK_NUMBER':
        return applyPickNumber(state, action.playerId, action.value)
      default: {
        const exhaustive: never = action.type
        return { ok: false, error: `Unknown action: ${String(exhaustive)}` }
      }
    }
  },

  onPlayerEliminated(state, playerId) {
    const picks = { ...state.game.picks }
    delete picks[playerId]
    const next = { ...state, game: { ...state.game, picks } }
    // Everyone left may already have picked — the leaver was the only one
    // holding the round open.
    return next.status === 'active' && next.pendingPlayerIds.length === 0 ? resolveRound(next) : next
  },

  nextForcedAction() {
    return null
  },

  redactGame(state, viewerId) {
    if (state.status !== 'active') return state.game
    const picks: Record<string, number | null> = {}
    for (const [id, value] of Object.entries(state.game.picks)) picks[id] = id === viewerId ? value : null
    return { ...state.game, picks }
  },

  isActionSecret(entry: LoggedAction, state, viewerId) {
    // A pick stays secret for as long as its round is still open.
    return entry.action.type === 'PICK_NUMBER' && entry.action.playerId !== viewerId && state.status === 'active' && entry.turn === state.turn
  },

  describeAction(action, before, after): ActionDescription {
    switch (action.type) {
      case 'PICK_NUMBER': {
        const changed = typeof before.game.picks[action.playerId] === 'number'
        const verb = changed ? 'changed their pick to' : 'picked'
        const lines = [`{player} ${verb} ${action.value}.`]
        if (after.game.rounds.length > before.game.rounds.length) {
          lines.push(`Round ${before.turn} revealed.`)
        }
        return { message: lines.join(' '), redactedMessage: changed ? '{player} changed their pick.' : '{player} picked a number.' }
      }
    }
  },

  describePhase(phase) {
    return phase === PICK_PHASE ? 'Picking' : 'In progress'
  },
}

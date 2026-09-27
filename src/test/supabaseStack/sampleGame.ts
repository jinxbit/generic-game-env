// Picks a legal next action for the example game (src/game/, "Unique Pick")
// in any state, plus the room rows a stack test needs around it.
//
// This exists so the stack has something to exercise without a recorded game
// (see src/test/fixtures/productionGames/README.md) — the harness self-tests
// drive whole games through the real Edge Functions with it. It is *not* a
// substitute for a real game: it covers the plumbing (authorization,
// concurrency, persistence, redaction) rather than interesting play. Recorded
// games are what cover the rules.
//
// Game-specific by nature: replacing src/game/ means rewriting
// `nextLegalAction` (and `pickFor`) here too. Everything else in
// src/test/supabaseStack/ is game-agnostic.

import { applyAction } from '../../engine/applyAction.ts'
import type { Action } from '../../engine/actions.ts'
import type { GameState } from '../../engine/types.ts'
import type { GameRow, GameSettings, PlayerRow } from '../../lib/dbTypes.ts'
import { MAX_PICK, PICK_PHASE } from '../../game/rules.ts'

/**
 * The value `playerId` picks in `state`'s current round: distinct per seat
 * (as long as there are no more seats than MAX_PICK), and rotating round by
 * round, so picks rarely collide and a driven game actually scores, and so
 * ends, rather than stalling on endless ties.
 */
export function pickFor(state: GameState, playerId: string): number {
  const seatIndex = state.players.findIndex((player) => player.id === playerId)
  return ((Math.max(seatIndex, 0) + state.turn - 1) % MAX_PICK) + 1
}

/**
 * The first pending player's pick, or null when the game is over (or wedged
 * — which a caller should treat as a failure, not a stopping point, since an
 * active game always has someone pending).
 */
export function nextLegalAction(state: GameState): Action | null {
  if (state.status !== 'active' || state.phase !== PICK_PHASE) return null
  const playerId = state.pendingPlayerIds[0]
  if (!playerId) return null
  const action: Action = { type: 'PICK_NUMBER', playerId, value: pickFor(state, playerId) }
  return applyAction(state, action).ok ? action : null
}

/** `games.settings` for a stack test: rule-enforced, no hidden information, default game options — override what the test is about. */
export function testGameSettings(overrides: Partial<GameSettings> = {}): GameSettings {
  return {
    skipHotseatPassGate: false,
    ruleEnforcementEnabled: true,
    hiddenInformationEnabled: false,
    ...overrides,
  }
}

/** A started (status 'active') room row, the shape the lobby would have left behind. */
export function testGameRow(options: {
  id: string
  createdBy: string
  settings?: GameSettings
  playerCount: number
  playMode?: GameRow['play_mode']
  status?: GameRow['status']
  roomCode?: string
  name?: string
  visibility?: GameRow['visibility']
}): GameRow {
  return {
    id: options.id,
    room_code: options.roomCode ?? 'TESTS',
    name: options.name ?? 'Stack self-test',
    play_mode: options.playMode ?? 'live',
    status: options.status ?? 'active',
    min_players: options.playerCount,
    max_players: options.playerCount,
    created_by: options.createdBy,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    settings: options.settings ?? testGameSettings(),
    config_version: 0,
    visibility: options.visibility ?? 'private',
  }
}

const SEAT_COLORS = ['#e11d48', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#0891b2']

/** One seat per `{ id, userId, name }`, in seat order. */
export function testPlayers(gameId: string, seats: { id: string; userId: string; name: string }[]): PlayerRow[] {
  return seats.map((seat, index) => ({
    id: seat.id,
    game_id: gameId,
    user_id: seat.userId,
    display_name: seat.name,
    avatar_url: null,
    seat_index: index,
    color: SEAT_COLORS[index % SEAT_COLORS.length],
    is_active: true,
    joined_at: new Date(0).toISOString(),
    ready_for_version: 0,
  }))
}

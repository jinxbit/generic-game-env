// Turns a game export into everything a test needs to replay it against the
// Supabase stack.
//
// The input is the app's own export file — the exact JSON the "Copy game
// export" button on GamePage.tsx produces (see src/lib/gameStateExport.ts),
// dropped into this directory unmodified. That file carries a single
// GameState, which is enough on its own: `actionHistory` is the whole game
// (see GameState.actionHistory's doc comment), and the `games`/`players` rows
// the Edge Functions need around it are reconstructable from the state, as
// `reconstructRoom` below explains. A `<name>.room.json` sidecar can override
// any of that when a game's real room row is available or the inference
// can't work it out.
//
// Every fixture is verified at load time: the reconstructed genesis is
// replayed through the engine and must reproduce the exported final state
// exactly. A fixture that doesn't is rejected with a message saying so,
// rather than being handed to a test that would then "pass" against a game
// that never happened.

// The deployment's games, registered: every fixture's genesis and replay
// needs its game's rules, and the smoke and seed runs (vitest.smoke.config.ts,
// vitest.seed.config.ts) load this without src/test/setup.ts.
import '../../../games/registry.ts'
import { replayActions, type GameState } from '@game-platform/sdk'
import { buildGenesisState } from '../../../lib/gameGenesis.ts'
import type { GameRow, GameSettings, PlayerRow } from '../../../lib/dbTypes.ts'
import { decodeGameStateExport } from '../../../lib/gameStateExport.ts'
import { canonicalJson } from '../../../lib/gameStateHash.ts'
import { finalScoresOf } from './gameScores.ts'

/**
 * What a game is expected to have *ended* as, declared in the sidecar rather
 * than derived — the point being that it comes from outside the code under
 * test. A rules change that silently changed every game's outcome would still
 * satisfy "the replay matches the export" (both sides move together); it
 * cannot satisfy a result a human read off the end-of-game screen and wrote
 * down here.
 *
 * Players are named by display name or by engine player id, whichever is
 * easier to read for that game; an ambiguous or unknown name is an error at
 * load time, not a silently skipped assertion.
 */
export interface ExpectedResult {
  /** Who won. Empty array asserts nobody did (an unfinished game). */
  winners?: string[]
  /** Final score per player, as the end-of-game screen shows it — read through ./gameScores.ts, the one game-specific helper here. Optional. */
  finalScores?: Record<string, number>
}

/** Optional `<name>.room.json` sidecar — anything here wins over what `reconstructRoom` infers. */
export interface RoomOverrides {
  /** The game's recorded outcome, asserted against the replay. */
  expected?: ExpectedResult
  createdBy?: string
  roomCode?: string
  name?: string
  visibility?: GameRow['visibility']
  /** Auth user ids to mark `profiles.is_admin`. */
  admins?: string[]
  settings?: Partial<GameSettings>
  /** Auth user id per engine player id, for a game whose export lacks authUserId (or to substitute placeholders). */
  userIdByPlayerId?: Record<string, string>
}

export interface ProductionGameFixture {
  /** File name without extension — becomes the test name. */
  name: string
  exportedAt: string
  game: GameRow
  players: PlayerRow[]
  /** The state the game started from, rebuilt by gameGenesis.ts exactly as the server rebuilds it for undo/redo. */
  genesis: GameState
  /** The state as exported — what a replay has to reproduce. */
  finalState: GameState
  /** Which signed-in user submits a given seat's actions. */
  userIdForPlayer(playerId: string): string
  /** The sidecar's declared outcome, resolved to player ids — absent when the sidecar doesn't declare one. */
  expected: { winnerPlayerIds?: string[]; finalScoreByPlayerId?: Record<string, number> }
  /** Final score per player for any state of this game (./gameScores.ts). */
  finalScores(state: GameState): Record<string, number>
  /** `playerId` rendered for a failure message: display name plus colour. */
  describePlayer(playerId: string): string
}

/** applyAction() stamps wall-clock time, so two independently-produced states never match byte-for-byte there even when every game-logic field does. */
export function stripTimestamps(state: GameState): GameState {
  return { ...state, actionHistory: state.actionHistory.map((entry) => ({ ...entry, timestamp: '' })) }
}

/**
 * Two states compared as the same *game*, not as the same bytes: timestamps
 * stripped, and the two optional flags whose absence is documented as
 * meaning `false` (`adminModeActive`, `hiddenInformationEnabled` — see
 * packages/sdk/src/types.ts) coerced, so an export written without the key and a
 * state the engine just built compare equal.
 */
export function normalizeStateForComparison(state: GameState): GameState {
  return {
    ...stripTimestamps(state),
    adminModeActive: Boolean(state.adminModeActive),
    hiddenInformationEnabled: Boolean(state.hiddenInformationEnabled),
  }
}

/**
 * Which top-level GameState fields two states disagree on — the useful half of
 * any "these two states should be the same game" failure. Compared with keys
 * sorted, since a replayed state is built field by field and an exported one
 * is in whatever order it was serialized.
 */
export function divergentStateFields(left: GameState, right: GameState): string[] {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]) as Set<keyof GameState>
  return [...keys].filter((key) => canonicalJson(left[key]) !== canonicalJson(right[key]))
}

/**
 * Recovers the `games`/`players` rows a game must have had.
 *
 * Everything genesis depends on is carried on the state itself: `gameId`,
 * which game it is and at which rules version (`gameType`/`rulesVersion` —
 * the room's `game_type` and pinned `settings.rulesVersion`), `playMode`,
 * `hiddenInformationEnabled`, the game's creation-time `options` and
 * `randomSeed` (copied onto GameState at genesis for exactly this reason), and the seats —
 * `players` is in seat order and never shrinks, so it *is* the roster, and
 * each seat's `authUserId` names who sat there.
 *
 * `ruleEnforcementEnabled` defaults to on: replaying through the Edge
 * Functions is the point of these tests. A game actually played client-trusted
 * says so in its sidecar (`"settings": { "ruleEnforcementEnabled": false }`),
 * and is then replayed through direct writes instead — see
 * ../../supabaseStack/replayFixture.ts.
 */
function reconstructRoom(finalState: GameState, overrides: RoomOverrides): { game: GameRow; players: PlayerRow[] } {
  const seatOrder = finalState.players
  const ownerUserId =
    overrides.createdBy ?? overrides.userIdByPlayerId?.[seatOrder[0].id] ?? seatOrder[0].authUserId ?? `synthetic-user-${seatOrder[0].id}`

  const players: PlayerRow[] = seatOrder.map((player, index) => ({
    id: player.id,
    game_id: finalState.gameId,
    user_id: overrides.userIdByPlayerId?.[player.id] ?? player.authUserId ?? ownerUserId,
    display_name: player.displayName,
    avatar_url: null,
    seat_index: index,
    color: player.color,
    is_active: true,
    ready_for_version: 0,
    joined_at: new Date(0).toISOString(),
  }))

  const settings: GameSettings = {
    skipHotseatPassGate: false,
    ruleEnforcementEnabled: true,
    hiddenInformationEnabled: finalState.hiddenInformationEnabled ?? false,
    gameOptions: finalState.options,
    ...(finalState.randomSeed !== undefined ? { randomSeed: finalState.randomSeed } : {}),
    ...overrides.settings,
    // Not overridable: replay has to run the exact rules the game was played
    // under, and a sidecar that said otherwise would only fail the
    // self-check below with a less useful message.
    rulesVersion: finalState.rulesVersion,
  }

  const game: GameRow = {
    id: finalState.gameId,
    game_type: finalState.gameType,
    room_code: overrides.roomCode ?? 'PRODX',
    name: overrides.name ?? 'Replayed game',
    play_mode: finalState.playMode,
    // Never 'lobby': the game has started, and game_state's read policy keys
    // off exactly that (0001_baseline.sql section 8; see database.ts).
    status: 'active',
    min_players: seatOrder.length,
    max_players: seatOrder.length,
    created_by: ownerUserId,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    settings,
    config_version: 0,
    visibility: overrides.visibility ?? 'private',
  }

  return { game, players }
}

/** Builds (and self-verifies) a fixture from one decoded export. Exported so a test can build a fixture from a state it just played rather than the directory. */
export function buildFixture(name: string, envelope: { exportedAt: string; gameState: GameState }, overrides: RoomOverrides = {}): ProductionGameFixture {
  const finalState = envelope.gameState
  const { game, players } = reconstructRoom(finalState, overrides)
  const genesis = buildGenesisState(game, players)

  const replayed = replayActions(genesis, finalState.actionHistory)
  const diverged = divergentStateFields(normalizeStateForComparison(replayed), normalizeStateForComparison(finalState))
  if (diverged.length > 0) {
    throw new Error(
      `Fixture "${name}" could not be reconstructed: replaying its action history from the rebuilt genesis produced a different state than the export ` +
        `(disagrees on ${diverged.join(', ')}). The room was inferred from the state (see reconstructRoom) — add a ${name}.room.json ` +
        `sidecar with the game's real \`settings\` to fix this.`,
    )
  }

  const userIdByPlayerId = new Map(players.map((player) => [player.id, player.user_id]))

  /** Resolves a sidecar's player reference — a display name or a player id — to exactly one seat. */
  const resolvePlayerId = (reference: string): string => {
    const byId = finalState.players.filter((player) => player.id === reference)
    const byName = finalState.players.filter((player) => player.displayName === reference)
    const matches = byId.length > 0 ? byId : byName
    if (matches.length === 0) {
      throw new Error(`Fixture "${name}" declares a result for "${reference}", which is neither a player id nor a display name in this game.`)
    }
    if (matches.length > 1) {
      throw new Error(`Fixture "${name}" declares a result for "${reference}", but ${matches.length} players share that display name — use their player ids instead.`)
    }
    return matches[0].id
  }

  const expectedWinners = overrides.expected?.winners
  const expectedScores = overrides.expected?.finalScores

  return {
    name,
    exportedAt: envelope.exportedAt,
    game,
    players,
    genesis,
    finalState,
    userIdForPlayer: (playerId) => {
      const userId = userIdByPlayerId.get(playerId)
      if (!userId) throw new Error(`Fixture "${name}" has no seat for player ${playerId}.`)
      return userId
    },
    expected: {
      winnerPlayerIds: expectedWinners?.map(resolvePlayerId),
      finalScoreByPlayerId: expectedScores && Object.fromEntries(Object.entries(expectedScores).map(([reference, score]) => [resolvePlayerId(reference), score])),
    },
    finalScores: finalScoresOf,
    describePlayer: (playerId) => {
      const player = finalState.players.find((candidate) => candidate.id === playerId)
      return player ? `${player.displayName} (${player.color})` : playerId
    },
  }
}

/**
 * Every export file in this directory, loaded and verified, sorted by name.
 * Drop a `.json` export in and it shows up here (and so in the tests) with no
 * other change.
 */
export async function loadProductionGameFixtures(): Promise<ProductionGameFixture[]> {
  const files = import.meta.glob('./*.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

  const overridesByName: Record<string, RoomOverrides> = {}
  const exportsByName: Record<string, string> = {}
  for (const [path, text] of Object.entries(files)) {
    const fileName = path.replace(/^\.\//, '')
    if (fileName.endsWith('.room.json')) {
      overridesByName[fileName.slice(0, -'.room.json'.length)] = JSON.parse(text) as RoomOverrides
    } else {
      exportsByName[fileName.slice(0, -'.json'.length)] = text
    }
  }

  const fixtures: ProductionGameFixture[] = []
  for (const name of Object.keys(exportsByName).sort()) {
    const envelope = await decodeGameStateExport(exportsByName[name])
    fixtures.push(buildFixture(name, envelope, overridesByName[name] ?? {}))
  }
  return fixtures
}

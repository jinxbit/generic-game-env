// Builds the checked-in example-game fixtures in this directory — real game
// exports in the app's own format (encodeGameStateExport, the same function
// GamePage.tsx's "Copy game export" uses) plus their `.room.json` sidecars.
//
// Run once, by hand, whenever the example game's rules change in a way that
// changes these games (the loader's self-check will tell you: an export that
// no longer replays to itself is rejected at load time):
//
//   node scripts/generate-example-fixtures.mjs
//
// That script only loads this module through Vite (so the app's
// extensionless imports resolve) and writes the files; everything about the
// games themselves is here. Each game is scripted move by move through the
// real engine — applyAction, applyUndoAction, applyRedoAction — exactly as
// GamePage.tsx's client-trusted path would play it, so the result is a game
// that genuinely happened as far as the engine is concerned. Only the log's
// timestamps are then rewritten to a realistic, fixed timeline (they are
// metadata that replay never reads — see LoggedAction), which also keeps the
// output byte-for-byte reproducible apart from gzip itself.
//
// Game-specific by nature: these scripts play the example game
// (@game-platform/unique-pick). Fixtures for another registered game mean
// scripting that game here too (or dropping in real exports instead — see
// ./README.md).

// The deployment's games, registered — this module also runs outside vitest
// (scripts/generate-example-fixtures.mjs), where src/test/setup.ts doesn't.
import '../../../games/registry.ts'
import { applyAction, applyRedoAction, applyUndoAction, type GameState } from '@game-platform/sdk'
import { gameDefinition, type GameOptions, type PickNumberAction } from '@game-platform/unique-pick/rules'
import { buildGenesisState } from '../../../lib/gameGenesis.ts'
import type { GameRow, GameSettings } from '../../../lib/dbTypes.ts'
import { encodeGameStateExport } from '../../../lib/gameStateExport.ts'
import type { RoomOverrides } from './loadFixtures.ts'

/** One scripted move: a seat's pick, a concede, admin mode, or an undo/redo by a seat (null = the room owner, unseated narration). */
type Move =
  | { pick: [seat: string, value: number] }
  | { concede: string }
  | { adminMode: boolean }
  | { undo: string | null }
  | { redo: string | null }

interface Seat {
  key: string
  playerId: string
  userId: string
  displayName: string
  color: string
}

interface ExampleGame {
  name: string
  gameId: string
  playMode: GameRow['play_mode']
  settings: GameSettings
  seats: Seat[]
  /** When the first move was made. */
  startedAt: string
  /** Seconds between consecutive moves, cycled — a live game's cadence differs from an async one's. */
  gapsSeconds: number[]
  moves: Move[]
  sidecar: RoomOverrides
}

function seat(key: string, index: number, gameSuffix: string): Seat {
  const hex = (n: number) => n.toString(16).padStart(12, '0')
  const colors = ['#e11d48', '#2563eb', '#16a34a']
  return {
    key,
    playerId: `7a1e0000-0000-4000-8000-${hex(0xa0000 + Number.parseInt(gameSuffix, 16) * 16 + index)}`,
    userId: `5eed0000-0000-4000-8000-${hex(0xb0000 + Number.parseInt(gameSuffix, 16) * 16 + index)}`,
    displayName: `Player ${key}`,
    color: colors[index],
  }
}

function settings(options: GameOptions, overrides: Partial<GameSettings> = {}): GameSettings {
  return { skipHotseatPassGate: false, ruleEnforcementEnabled: true, hiddenInformationEnabled: false, rulesVersion: gameDefinition.rulesVersion, gameOptions: options, ...overrides }
}

const GAMES: ExampleGame[] = [
  // A short two-player live game on the client-trusted write path, played
  // straight to the target score: Player A reaches 12 in round 4.
  {
    name: 'two-player-live-win',
    gameId: 'c0ffee00-0000-4000-8000-000000000001',
    playMode: 'live',
    settings: settings({ targetScore: 12, maxRounds: 10 }, { ruleEnforcementEnabled: false }),
    seats: [seat('A', 0, '1'), seat('B', 1, '1')],
    startedAt: '2026-09-20T19:02:11.418Z',
    gapsSeconds: [7, 12, 5, 9, 14],
    moves: [
      { pick: ['A', 5] }, { pick: ['B', 3] }, // A 5, B 3
      { pick: ['B', 4] }, { pick: ['A', 4] }, // collision: nobody scores
      { pick: ['A', 2] }, { pick: ['B', 5] }, // A 7, B 8
      { pick: ['B', 1] }, { pick: ['A', 5] }, // A 12, B 9 — A reaches the target
    ],
    sidecar: {
      name: 'Player A vs Player B — first to 12',
      settings: { ruleEnforcementEnabled: false },
      expected: { winners: ['Player A'], finalScores: { 'Player A': 12, 'Player B': 9 } },
    },
  },
  // A three-player async game on the rule-enforced path, with everything the
  // framework adds on top of the rules: a changed pick, an undo and a redo of
  // the same move, an undo followed by a different move (a branch), and a
  // concede partway through.
  {
    name: 'three-player-async-undo-concede',
    gameId: 'c0ffee00-0000-4000-8000-000000000002',
    playMode: 'async',
    settings: settings({ targetScore: 10, maxRounds: 6 }),
    seats: [seat('A', 0, '2'), seat('B', 1, '2'), seat('C', 2, '2')],
    startedAt: '2026-09-14T08:31:47.052Z',
    gapsSeconds: [2917, 11404, 623, 40311, 7208, 19877],
    moves: [
      // Round 1: B changes 2 -> 4 and collides with C. A 3.
      { pick: ['A', 3] }, { pick: ['B', 2] }, { pick: ['B', 4] }, { pick: ['C', 4] },
      // Round 2: C picks 1, takes it back, then redoes it. A 8, B 3, C 1.
      { pick: ['A', 5] }, { pick: ['C', 1] }, { undo: 'C' }, { redo: 'C' }, { pick: ['B', 3] },
      // Round 3: B picks 2, undoes it and picks 4 instead; then A concedes,
      // and C's pick collides with B's.
      { pick: ['B', 2] }, { undo: 'B' }, { pick: ['B', 4] }, { concede: 'A' }, { pick: ['C', 4] },
      // Round 4: B 8, C 4.
      { pick: ['B', 5] }, { pick: ['C', 3] },
      // Round 5: collision.
      { pick: ['C', 2] }, { pick: ['B', 2] },
      // Round 6: B 12, C 5 — B passes the target in the last round.
      { pick: ['B', 4] }, { pick: ['C', 1] },
    ],
    sidecar: {
      name: 'Three-way async game — A concedes, B takes it',
      expected: { winners: ['Player B'], finalScores: { 'Player A': 8, 'Player B': 12, 'Player C': 5 } },
    },
  },
  // A three-player live game with rule enforcement and hidden information on,
  // so every pick was secret from the other seats until its round resolved —
  // with a changed pick while the round was still open, and room admin mode
  // switched on and back off by the owner along the way.
  {
    name: 'three-player-hidden-picks',
    gameId: 'c0ffee00-0000-4000-8000-000000000003',
    playMode: 'live',
    settings: settings({ targetScore: 8, maxRounds: 5 }, { hiddenInformationEnabled: true }),
    seats: [seat('A', 0, '3'), seat('B', 1, '3'), seat('C', 2, '3')],
    startedAt: '2026-09-22T20:15:03.740Z',
    gapsSeconds: [6, 11, 4, 18, 9],
    moves: [
      // Round 1: B changes 3 -> 1; A and C collide on 5. B 1.
      { pick: ['B', 3] }, { pick: ['A', 5] }, { pick: ['B', 1] }, { pick: ['C', 5] },
      // Round 2 (admin mode on): B and C collide on 4. A 2.
      { adminMode: true }, { pick: ['C', 4] }, { pick: ['A', 2] }, { pick: ['B', 4] },
      // Round 3: A 7, B 4, C 1.
      { pick: ['A', 5] }, { adminMode: false }, { pick: ['B', 3] }, { pick: ['C', 1] },
      // Round 4: A 8, B 9, C 4 — both A and B reach 8; B has more.
      { pick: ['C', 3] }, { pick: ['B', 5] }, { pick: ['A', 1] },
    ],
    sidecar: {
      name: 'Three-way live game with secret picks',
      expected: { winners: ['Player B'], finalScores: { 'Player A': 8, 'Player B': 9, 'Player C': 4 } },
    },
  },
]

function play(game: ExampleGame): GameState {
  const row: GameRow = {
    id: game.gameId,
    game_type: gameDefinition.id,
    room_code: 'EXAMPL',
    name: game.name,
    play_mode: game.playMode,
    status: 'active',
    min_players: game.seats.length,
    max_players: game.seats.length,
    created_by: game.seats[0].userId,
    created_at: game.startedAt,
    updated_at: game.startedAt,
    settings: game.settings,
    config_version: 0,
    visibility: 'private',
  }
  const genesis = buildGenesisState(
    row,
    game.seats.map((s) => ({ id: s.playerId, user_id: s.userId, display_name: s.displayName, color: s.color })),
  )
  const idFor = (key: string) => {
    const found = game.seats.find((s) => s.key === key)
    if (!found) throw new Error(`[${game.name}] no seat "${key}"`)
    return found.playerId
  }

  let state = genesis
  for (const [index, move] of game.moves.entries()) {
    let result
    if ('pick' in move) {
      const action: PickNumberAction = { type: 'PICK_NUMBER', playerId: idFor(move.pick[0]), value: move.pick[1] }
      result = applyAction(state, action)
    } else if ('concede' in move) {
      result = applyAction(state, { type: 'CONCEDE', playerId: idFor(move.concede) })
    } else if ('adminMode' in move) {
      result = applyAction(state, { type: 'SET_ADMIN_MODE', playerId: null, enabled: move.adminMode })
    } else if ('undo' in move) {
      result = applyUndoAction(genesis, state, move.undo === null ? null : idFor(move.undo))
    } else {
      result = applyRedoAction(genesis, state, move.redo === null ? null : idFor(move.redo))
    }
    if (!result.ok) throw new Error(`[${game.name}] move ${index + 1} (${JSON.stringify(move)}) was rejected: ${result.error}`)
    state = result.state
  }
  if (state.status !== 'completed') throw new Error(`[${game.name}] the scripted game did not finish (status ${state.status}, round ${state.turn}).`)

  // Realistic, fixed timestamps in place of the wall-clock ones applyAction
  // stamped — see this module's doc comment.
  let at = Date.parse(game.startedAt)
  const actionHistory = state.actionHistory.map((entry, index) => {
    if (index > 0) at += game.gapsSeconds[(index - 1) % game.gapsSeconds.length] * 1000 + ((index * 379) % 1000)
    return { ...entry, timestamp: new Date(at).toISOString() }
  })
  return { ...state, actionHistory }
}

export interface GeneratedFixture {
  name: string
  /** `<name>.json` — exactly what "Copy game export" would have produced, exported a couple of minutes after the last move. */
  exportText: string
  /** `<name>.room.json`. */
  sidecarText: string
}

export async function generateExampleFixtures(): Promise<GeneratedFixture[]> {
  const generated: GeneratedFixture[] = []
  for (const game of GAMES) {
    const state = play(game)
    const lastMoveAt = Date.parse(state.actionHistory.at(-1)!.timestamp)
    const file = JSON.parse(await encodeGameStateExport(state)) as { exportedAt: string }
    file.exportedAt = new Date(lastMoveAt + 143_207).toISOString()
    generated.push({
      name: game.name,
      exportText: `${JSON.stringify(file)}\n`,
      sidecarText: `${JSON.stringify(game.sidecar, null, 2)}\n`,
    })
  }
  return generated
}

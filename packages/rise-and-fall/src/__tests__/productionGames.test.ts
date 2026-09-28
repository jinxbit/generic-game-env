// The port's equivalence check: real games exported from the standalone Rise
// & Fall app (./fixtures/, that app's own "Copy game export" format), each
// replayed two ways —
//
// 1. through the carried-over engine alone, exactly as the standalone app
//    replayed it (its applyAction, historyFold and replay), and
// 2. through the platform: a genesis from ./adapter.ts, every entry replayed
//    by @game-platform/sdk's replayActions, which runs this package's
//    GameDefinition hooks (applyAction, nextForcedAction) and the framework's
//    own undo/redo folding and forced-follow-up convergence —
//
// and the two final states must agree field for field. Each fixture also
// declares the result a human read off the end-of-game screen (the
// `.room.json` sidecar), asserted against the platform replay.
//
// A game played before the standalone app folded forced follow-ups into the
// triggering entry can carry a standalone entry for what is now automatic;
// those are dropped first, asking the engine which they are (a trusted
// replay of one succeeds with no steps) — see the standalone app's
// src/test/fixtures/productionGames/README.md.

import { buildGameLog, replayActions, type LobbyState, type LoggedAction } from '@game-platform/sdk'
import { describe, expect, it } from 'vitest'
import { toPlatform, type GameState } from '../adapter.ts'
import { resolveResourceBank } from '../content/resolveContent.ts'
import { applyActionWithSteps } from '../engine/applyAction.ts'
import type { LoggedAction as EngineLoggedAction } from '../engine/actions.ts'
import { createEmptyBoard } from '../engine/board.ts'
import { createNewGame as createEngineGame, startGameWithPresetBoard } from '../engine/createGame.ts'
import { resolveHistory } from '../engine/historyFold.ts'
import { replayActions as replayEngine } from '../engine/replay.ts'
import type { Board } from '../engine/types.ts'
import { calculateVPBreakdown } from '../engine/victoryPoints.ts'
import { buildEngineGenesis } from '../adapter.ts'
import { contentFor, DEFAULT_GAME_OPTIONS, gameDefinition, toEngine } from '../rules.ts'
import type { EngineState, GameData, GameOptions } from '../types.ts'
import { newGame } from '../testing.ts'

interface Sidecar {
  expected?: { finalScores?: Record<string, number>; winners?: string[] }
}

async function gunzipBase64(base64: string): Promise<string> {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  const input = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
  const reader = input.pipeThrough(new DecompressionStream('gzip')).getReader()
  const decoder = new TextDecoder()
  let text = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return text + decoder.decode()
    text += decoder.decode(value, { stream: true })
  }
}

const files = import.meta.glob('./fixtures/*.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const fixtureNames = Object.keys(files)
  .map((path) => path.replace(/^\.\/fixtures\//, '').replace(/\.json$/, ''))
  .filter((name) => !name.endsWith('.room'))
  .sort()

async function loadExport(name: string): Promise<EngineState> {
  const file = JSON.parse(files[`./fixtures/${name}.json`]) as { gameStateZipped: string }
  return JSON.parse(await gunzipBase64(file.gameStateZipped)) as EngineState
}

function sidecar(name: string): Sidecar {
  const text = files[`./fixtures/${name}.room.json`]
  return text ? (JSON.parse(text) as Sidecar) : {}
}

function boardWithoutUnits(board: Board): Board {
  return { shape: board.shape, tiles: Object.fromEntries(Object.entries(board.tiles).map(([key, tile]) => [key, { ...tile, occupantIds: [] }])) }
}

/**
 * The game's genesis on both sides. The map source is inferred from the log
 * the same way the standalone app's fixture loader does: nobody placed a tile
 * (a preset map from its since-dropped map pool — laid out directly here, as
 * the platform's options can't express it), one player placed them all
 * ("build alone"), or everyone did.
 */
function genesisFor(final: EngineState): { engine: EngineState; platform: GameState } {
  const effective = resolveHistory(final.actionHistory).effective
  const placers = (type: 'PLACE_TILE' | 'PLACE_UNIT') => [
    ...new Set(effective.filter((e) => e.action.type === type).map((e) => e.action.playerId).filter((id): id is string => id !== null)),
  ]
  const tilePlacers = placers('PLACE_TILE')
  const unitOrder = placers('PLACE_UNIT')
  const seats = final.players.map((p) => ({ id: p.id, authUserId: p.authUserId, displayName: p.displayName, color: p.color }))
  const seatIds = seats.map((s) => s.id)

  const options: GameOptions = {
    ...DEFAULT_GAME_OPTIONS,
    gameLength: final.gameLength,
    activeTaleIds: final.activeTaleIds,
    mapMode: tilePlacers.length === 1 && seats.length > 1 ? 'solo' : 'together',
  }
  const seating: GameData['seating'] =
    options.mapMode === 'solo'
      ? { builderId: tilePlacers[0], turnOrder: unitOrder.length === seats.length ? unitOrder : seatIds }
      : { builderId: null, turnOrder: seatIds }
  const common = {
    gameId: final.gameId,
    playMode: final.playMode,
    hiddenInformationEnabled: Boolean(final.hiddenInformationEnabled),
    lockRevealedInformationEnabled: Boolean(final.lockRevealedInformationEnabled),
  }

  let engine: EngineState
  if (tilePlacers.length === 0) {
    const lobby = createEngineGame({
      ...common,
      board: createEmptyBoard('hex'),
      players: seats,
      resourceBank: resolveResourceBank(seats.length),
      activeTaleIds: final.activeTaleIds,
      gameLength: final.gameLength,
    })
    engine = startGameWithPresetBoard(lobby, boardWithoutUnits(final.board))
  } else {
    engine = buildEngineGenesis({ ...common, players: seats, options, seating })
  }

  const lobby: LobbyState<GameOptions> = {
    ...common,
    gameType: gameDefinition.id,
    rulesVersion: gameDefinition.rulesVersion,
    status: 'lobby',
    turn: 0,
    phase: null,
    activePlayerId: null,
    pendingPlayerIds: [],
    turnOrder: seatIds,
    players: seats.map((s) => ({ ...s, eliminated: false, conceded: false })),
    winnerPlayerIds: [],
    options,
    actionHistory: [],
    adminModeActive: false,
  }
  return { engine, platform: toPlatform(engine, lobby, seating) }
}

/** The log with pre-fold-in standalone forced follow-ups dropped (see this file's header), and the engine's own replay of it. */
function withoutStaleEntries(genesis: EngineState, history: EngineLoggedAction[], content: ReturnType<typeof contentFor>): { history: EngineLoggedAction[]; final: EngineState; dropped: number } {
  const kept: EngineLoggedAction[] = []
  let state = genesis
  let dropped = 0
  const replay = (entries: EngineLoggedAction[]) =>
    replayEngine(genesis, entries, content.unitContent, content.achievementContent, content.boardGenerationContent, content.taleContent)
  for (const entry of history) {
    if (entry.action.type === 'UNDO_ACTION' || entry.action.type === 'REDO_ACTION') {
      kept.push(entry)
      state = replay(kept)
      continue
    }
    const result = applyActionWithSteps(state, entry.action, content.unitContent, content.achievementContent, content.boardGenerationContent, content.taleContent, true)
    if (!result.ok) throw new Error(`engine replay rejected ${entry.action.type}: ${result.error}`)
    if (result.steps.length === 0) {
      dropped++
      continue
    }
    kept.push(entry)
    state = result.state
  }
  return { history: kept, final: replay(kept), dropped }
}

/** The fields both replays own, normalised the way the standalone app compared them. */
function comparable(state: EngineState): Record<string, unknown> {
  const declinePhaseOpen = state.status === 'active' && state.roundPhase === 'decline'
  const { actionHistory, ...rest } = state
  void actionHistory
  return JSON.parse(
    JSON.stringify({
      ...rest,
      adminModeActive: Boolean(state.adminModeActive),
      hiddenInformationEnabled: Boolean(state.hiddenInformationEnabled),
      lockRevealedInformationEnabled: Boolean(state.lockRevealedInformationEnabled),
      declineSourceZoneByCardId: declinePhaseOpen ? (state.declineSourceZoneByCardId ?? {}) : {},
      players: state.players.map((p) => ({ ...p, conceded: Boolean(p.conceded) })),
    }),
  )
}

describe('production games from the standalone app replay identically on the platform', () => {
  it('has fixtures to replay', () => {
    expect(fixtureNames.length).toBeGreaterThan(0)
  })

  for (const name of fixtureNames) {
    it(name, async () => {
      newGame() // registers the game
      const exported = await loadExport(name)
      const { engine: engineGenesis, platform: platformGenesis } = genesisFor(exported)
      const content = contentFor(platformGenesis)

      // The export itself must be reproducible by the engine — otherwise the
      // fixture, not the port, is what's wrong.
      const engineFinalFromExport = replayEngine(
        engineGenesis,
        exported.actionHistory,
        content.unitContent,
        content.achievementContent,
        content.boardGenerationContent,
        content.taleContent,
      )
      expect(comparable(engineFinalFromExport)).toEqual(comparable(exported))

      const { history, final: engineFinal } = withoutStaleEntries(engineGenesis, exported.actionHistory, content)
      expect(comparable(engineFinal)).toEqual(comparable(exported))

      const platformHistory: LoggedAction[] = history.map((entry) => ({
        action: entry.action,
        turn: entry.turn,
        timestamp: entry.timestamp,
        ...(entry.viaAdminMode ? { viaAdminMode: true as const } : {}),
      }))
      const platformFinal = replayActions(platformGenesis, platformHistory) as GameState
      expect(comparable(toEngine(platformFinal))).toEqual(comparable(engineFinal))

      // The envelope agrees with the engine on the things the platform reads.
      expect(platformFinal.status).toBe(engineFinal.status === 'completed' ? 'completed' : 'active')
      expect(platformFinal.winnerPlayerIds).toEqual(engineFinal.winnerPlayerIds)

      // The declared result.
      const expected = sidecar(name).expected
      const idOf = (reference: string) => exported.players.find((p) => p.id === reference || p.displayName === reference)!.id
      if (expected?.finalScores) {
        const breakdown = calculateVPBreakdown(toEngine(platformFinal), content.achievementContent, content.taleContent)
        const scores = Object.fromEntries(Object.entries(expected.finalScores).map(([reference]) => [idOf(reference), breakdown[idOf(reference)]?.total]))
        expect(scores).toEqual(Object.fromEntries(Object.entries(expected.finalScores).map(([reference, score]) => [idOf(reference), score])))
      }
      if (expected?.winners) expect([...platformFinal.winnerPlayerIds].sort()).toEqual(expected.winners.map(idOf).sort())

      // The whole game narrates without failing, one or more lines per entry.
      const log = buildGameLog(platformGenesis, platformHistory)
      expect(new Set(log.map((event) => event.entryIndex)).size).toBe(platformHistory.length)
    }, 60_000)
  }
})

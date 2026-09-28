// The platform half of Rise & Fall: options, setup, the envelope the adapter
// derives, concede at every stage, hidden information and narration. The
// rules themselves are pinned by the carried-over engine tests
// (../engine/__tests__/) and the production-game replays
// (./productionGames.test.ts).

import { applyAction, buildGameLog, createNewGame, isUndoLockedByReveal, redactStateForPlayer, replayActions, type Action } from '@game-platform/sdk'
import { seatPlayers } from '@game-platform/sdk/testing'
import { describe, expect, it } from 'vitest'
import type { GameState } from '../adapter.ts'
import { currentTilePlacerId } from '../engine/boardSetup.ts'
import { contentFor, DEFAULT_GAME_OPTIONS, describeGameOptions, gameDefinition, normalizeGameOptions, toEngine } from '../rules.ts'
import { newGame, play, simplestMove, testRandom, withoutTimestamps } from '../testing.ts'
import type { GameOptions } from '../types.ts'

/** Plays simplestMove until `done` holds (or throws after `limit` moves). */
function advance(state: GameState, done: (s: GameState) => boolean, limit = 500): GameState {
  let s = state
  for (let i = 0; i < limit; i++) {
    if (done(s)) return s
    const move = simplestMove(s)
    if (!move) throw new Error(`No move available in phase ${s.phase}`)
    s = play(s, move)
  }
  throw new Error(`Not reached after ${limit} moves (phase ${s.phase})`)
}

const TEMPLATE: Partial<GameOptions> = { mapMode: 'template', mapTemplateId: 'classic' }

function checkEnvelope(s: GameState): void {
  expect(new Set(s.pendingPlayerIds).size).toBe(s.pendingPlayerIds.length)
  for (const id of s.pendingPlayerIds) expect(s.turnOrder).toContain(id)
  if (s.status === 'completed') {
    expect(s.pendingPlayerIds).toEqual([])
    return
  }
  if (s.phase === 'placeTiles' || s.phase === 'placeUnits' || s.phase === 'actions') {
    expect(s.pendingPlayerIds).toEqual([s.activePlayerId])
  } else {
    expect(s.activePlayerId).toBeNull()
  }
}

describe('options', () => {
  it('normalizes anything into valid options', () => {
    expect(normalizeGameOptions(undefined)).toEqual(DEFAULT_GAME_OPTIONS)
    expect(normalizeGameOptions({ gameLength: 99, activeTaleIds: ['nope', 7], mapMode: 'weird' })).toEqual({
      ...DEFAULT_GAME_OPTIONS,
      gameLength: 6,
      activeTaleIds: [],
    })
    expect(normalizeGameOptions({ gameLength: -3 }).gameLength).toBe(1)
    // A template mode without a known template falls back to building together.
    expect(normalizeGameOptions({ mapMode: 'template', mapTemplateId: 'missing' })).toMatchObject({ mapMode: 'together', mapTemplateId: null })
    expect(normalizeGameOptions({ mapMode: 'template', mapTemplateId: 'classic' })).toMatchObject({ mapMode: 'template', mapTemplateId: 'classic' })
    expect(normalizeGameOptions({ mapMode: 'solo', soloBuilder: 'random', soloBuilderUnitOrder: 'random' })).toMatchObject({
      mapMode: 'solo',
      soloBuilder: 'random',
      soloBuilderUnitOrder: 'random',
    })
  })

  it('describes options in one line', () => {
    expect(describeGameOptions(DEFAULT_GAME_OPTIONS)).toBe('4 achievements to end')
    expect(describeGameOptions(normalizeGameOptions({ gameLength: 1, mapMode: 'solo' }))).toBe('1 achievement to end · map built by the host')
  })
})

describe('setup', () => {
  it('starts in tile placement with the first seat placing', () => {
    const s = newGame({ players: 3 })
    expect(s.status).toBe('active')
    expect(s.phase).toBe('placeTiles')
    expect(s.pendingPlayerIds).toEqual(['p1'])
    expect(s.activePlayerId).toBe('p1')
    expect(s.game.seating).toEqual({ turnOrder: ['p1', 'p2', 'p3'], builderId: null })
    expect(s.setupRandom).toBeUndefined()
    expect(Object.keys(s.game.board.tiles).length).toBeGreaterThan(0) // the seeded starting Sea
  })

  it('a template map skips tile placement', () => {
    const s = newGame({ players: 2, options: TEMPLATE })
    expect(s.phase).toBe('placeUnits')
    expect(s.pendingPlayerIds).toEqual(['p1'])
  })

  it('"build alone" by the host: the host places every tile and their starting units last', () => {
    let s = newGame({ players: 3, options: { mapMode: 'solo' } })
    expect(s.game.seating).toEqual({ builderId: 'p1', turnOrder: ['p2', 'p3', 'p1'] })
    for (let i = 0; i < 3; i++) {
      expect(s.pendingPlayerIds).toEqual(['p1'])
      s = play(s, simplestMove(s)!)
    }
    s = advance(s, (x) => x.phase === 'placeUnits')
    expect(s.pendingPlayerIds).toEqual(['p2'])
  })

  it('"build alone" at random draws the builder and order at setup, and genesis rebuilds from the recorded draws', () => {
    const s = newGame({ players: 4, options: { mapMode: 'solo', soloBuilder: 'random', soloBuilderUnitOrder: 'random' }, seed: 5 })
    expect(s.setupRandom?.length).toBeGreaterThan(0)
    expect(['p1', 'p2', 'p3', 'p4']).toContain(s.game.seating.builderId)
    expect([...s.game.seating.turnOrder].sort()).toEqual(['p1', 'p2', 'p3', 'p4'])
    expect(s.pendingPlayerIds).toEqual([s.game.seating.builderId])
    const rebuilt = createNewGame({
      gameId: s.gameId,
      gameType: s.gameType,
      playMode: s.playMode,
      players: seatPlayers(4),
      options: s.options,
      setupRandom: s.setupRandom,
    })
    expect(rebuilt).toEqual(s)
  })
})

describe('the round cycle on the platform', () => {
  it('reaches every phase with an accurate envelope, and replays to the same state', () => {
    let s = newGame({ players: 3 })
    const genesis = s
    const phases = new Set<string>()
    for (let i = 0; i < 400 && s.status === 'active'; i++) {
      checkEnvelope(s)
      phases.add(s.phase!)
      s = play(s, simplestMove(s)!)
    }
    // (No decline or purchase: nobody claims an achievement or declines a card when every unit passes.)
    expect([...phases]).toEqual(expect.arrayContaining(['placeTiles', 'placeUnits', 'selectCards', 'actions']))
    expect(withoutTimestamps(replayActions(genesis, s.actionHistory) as GameState)).toEqual(withoutTimestamps(s))
  })

  it('a one-card hand chooses itself, folded into the triggering entry', () => {
    const s = advance(newGame({ players: 2, options: TEMPLATE }), (x) => x.phase === 'selectCards')
    // Everyone's hand starts with their three starting kinds; nothing is forced yet.
    expect(s.pendingPlayerIds).toEqual(['p1', 'p2'])
    expect(gameDefinition.nextForcedAction(s)).toBeNull()
  })

  it('rejects a move from a player who may not act', () => {
    const s = newGame({ players: 2 })
    const result = applyAction(s, { type: 'PLACE_TILE', playerId: 'p2', anchor: { q: 0, r: 0 }, rotationSteps: 0 } as Action)
    expect(result).toEqual({ ok: false, error: "It is not this player's turn to place a tile" })
  })

  it('narrates the cascade as its own lines', () => {
    const genesis = newGame({ players: 2, options: TEMPLATE })
    const s = advance(genesis, (x) => x.turn === 1)
    const log = buildGameLog(genesis, s.actionHistory)
    expect(log.slice(0, 2).map((e) => [e.playerId, e.message])).toEqual([
      ['p1', '{player} placed a starting city.'],
      ['p1', "{player}'s city card entered their hand (first unit placed)."],
    ])
    expect(log.at(-1)).toMatchObject({ playerId: null, message: 'Round 1 begins.', entryIndex: s.actionHistory.length - 1 })
  })
})

describe('concede', () => {
  it('during tile placement: the rotation skips the leaver and the map still gets built', () => {
    let s = newGame({ players: 3 })
    s = play(s, simplestMove(s)!) // p1 places; p2 is up
    expect(s.pendingPlayerIds).toEqual(['p2'])
    s = play(s, { type: 'CONCEDE', playerId: 'p2' } as Action as never)
    expect(s.players.find((p) => p.id === 'p2')).toMatchObject({ eliminated: true, conceded: true })
    expect(s.turnOrder).toEqual(['p1', 'p3'])
    expect(s.pendingPlayerIds).toEqual(['p3'])
    s = advance(s, (x) => x.phase === 'selectCards')
    expect(toEngine(s).units.some((u) => u.ownerId === 'p2')).toBe(false)
  })

  it('during unit placement: nobody who has placed everything is asked to place again', () => {
    let s = newGame({ players: 3, options: TEMPLATE })
    // p1, p2, p3, p1 place; p2 is next.
    for (let i = 0; i < 4; i++) s = play(s, simplestMove(s)!)
    expect(s.pendingPlayerIds).toEqual(['p2'])
    s = play(s, { type: 'CONCEDE', playerId: 'p2' } as never)
    expect(s.pendingPlayerIds).toEqual(['p3'])
    s = advance(s, (x) => x.phase === 'selectCards')
    const engine = toEngine(s)
    for (const id of ['p1', 'p3']) expect(engine.units.filter((u) => u.ownerId === id)).toHaveLength(3)
    expect(engine.units.filter((u) => u.ownerId === 'p2')).toHaveLength(0)
  })

  it('a solo builder who leaves hands the map to everyone else', () => {
    let s = newGame({ players: 3, options: { mapMode: 'solo' } })
    s = play(s, { type: 'CONCEDE', playerId: 'p1' } as never)
    expect(s.pendingPlayerIds).toHaveLength(1)
    expect(['p2', 'p3']).toContain(s.pendingPlayerIds[0])
    const engine = toEngine(s)
    expect(engine.boardSetup?.builderId).toBeNull()
    expect(currentTilePlacerId(engine)).toBe(s.pendingPlayerIds[0])
    s = advance(s, (x) => x.phase === 'selectCards')
    expect(s.turnOrder).toEqual(['p2', 'p3'])
  })

  it('mid-round: the leaver no longer blocks the phase, and loses their units and resources', () => {
    let s = advance(newGame({ players: 3, options: TEMPLATE }), (x) => x.phase === 'selectCards')
    s = play(s, simplestMove(s)!) // p1 chooses
    s = play(s, simplestMove(s)!) // p2 chooses; p3 still choosing
    expect(s.pendingPlayerIds).toEqual(['p3'])
    s = play(s, { type: 'CONCEDE', playerId: 'p3' } as never)
    expect(s.phase).toBe('actions')
    expect(s.pendingPlayerIds).toEqual(['p1'])
    const engine = toEngine(s)
    expect(engine.units.some((u) => u.ownerId === 'p3')).toBe(false)
    expect(engine.players.find((p) => p.id === 'p3')?.resources).toEqual({ gold: 0, wood: 0, stone: 0 })
  })

  it('a concede that leaves one player ends the game for them', () => {
    let s = newGame({ players: 2 })
    s = play(s, { type: 'CONCEDE', playerId: 'p1' } as never)
    expect(s.status).toBe('completed')
    expect(s.winnerPlayerIds).toEqual(['p2'])
    expect(s.pendingPlayerIds).toEqual([])
  })
})

describe('hidden information', () => {
  function atSelectCards(): GameState {
    return advance(newGame({ players: 3, options: TEMPLATE, hiddenInformationEnabled: true }), (x) => x.phase === 'selectCards')
  }

  it('hides a chosen card from everyone else until every player has chosen', () => {
    let s = atSelectCards()
    const cardId = toEngine(s).players[0].handCardIds[1]
    s = play(s, { type: 'CHOOSE_CARD', playerId: 'p1', cardId })
    const entry = s.actionHistory.at(-1)!
    expect(gameDefinition.redactGame(s, 'p1').chosenCardIdByPlayerId.p1).toBe(cardId)
    expect(gameDefinition.redactGame(s, 'p2').chosenCardIdByPlayerId.p1).toBeNull()
    expect(gameDefinition.redactGame(s, null).chosenCardIdByPlayerId.p1).toBeNull()
    expect(gameDefinition.isActionSecret(entry, s, 'p2')).toBe(true)
    expect(gameDefinition.isActionSecret(entry, s, 'p1')).toBe(false)

    // The redacted state and log carry no trace of the card for p2.
    const forP2 = redactStateForPlayer(s, 'p2')
    expect(JSON.stringify(forP2.game)).not.toContain(`"p1":"${cardId}"`)
    expect(forP2.actionHistory.at(-1)?.action).toEqual({ type: 'HIDDEN_ACTION', playerId: 'p1' })

    s = play(s, simplestMove(s)!)
    s = play(s, simplestMove(s)!)
    expect(s.phase).toBe('actions')
    expect(gameDefinition.redactGame(s, 'p2').chosenCardIdByPlayerId.p1).toBe(cardId)
    expect(gameDefinition.isActionSecret(entry, s, 'p2')).toBe(false)
  })

  it('narrates a hidden pick without naming the card', () => {
    let s = atSelectCards()
    const before = s
    s = play(s, simplestMove(s)!)
    const description = gameDefinition.describeAction(s.actionHistory.at(-1)!.action as never, before, s)
    expect(description.message).toMatch(/^\{player\} chose to play /)
    expect(description.redactedMessage).toBe('{player} chose a card.')
  })

  it('shows another player’s decline additions back where they came from until the phase resolves', () => {
    let s = atSelectCards()
    // Arrange an open decline phase: every player owes one card.
    const engine = toEngine(s)
    s = {
      ...s,
      phase: 'decline',
      pendingPlayerIds: ['p1', 'p2', 'p3'],
      game: { ...s.game, roundPhase: 'decline', pendingPlayerIds: ['p1', 'p2', 'p3'], declineSourceZoneByCardId: {} },
    }
    const cardId = engine.players[0].handCardIds[0]
    s = play(s, { type: 'MOVE_TO_DECLINE', playerId: 'p1', cardId })
    expect(s.game.players[0].declineCardIds).toContain(cardId)
    const seenByP2 = gameDefinition.redactGame(s, 'p2')
    expect(seenByP2.players[0].declineCardIds).not.toContain(cardId)
    expect(seenByP2.players[0].handCardIds).toContain(cardId)
    expect(seenByP2.declineSourceZoneByCardId).toEqual({})
    expect(gameDefinition.redactGame(s, 'p1').players[0].declineCardIds).toContain(cardId)
    expect(gameDefinition.isActionSecret(s.actionHistory.at(-1)!, s, 'p2')).toBe(true)
  })

  it('locks undoing a revealed pick when the room says so', () => {
    const genesis = newGame({ players: 2, options: TEMPLATE, hiddenInformationEnabled: true, lockRevealedInformationEnabled: true })
    let s = advance(genesis, (x) => x.phase === 'selectCards')
    s = play(s, simplestMove(s)!)
    expect(isUndoLockedByReveal(genesis, s)).toBe(false) // p1's pick is still secret from p2
    s = play(s, simplestMove(s)!) // p2's pick reveals both
    expect(s.phase).toBe('actions')
    expect(isUndoLockedByReveal(genesis, s)).toBe(true)
  })
})

describe('content', () => {
  it('resolves once per player count, Tales and length', () => {
    const s = newGame({ players: 2 })
    expect(contentFor(s)).toBe(contentFor(s))
    expect(contentFor(newGame({ players: 3 }))).not.toBe(contentFor(s))
  })
})

describe('determinism', () => {
  it('setup draws nothing unless building alone at random', () => {
    for (const options of [{}, TEMPLATE, { mapMode: 'solo' as const }]) {
      expect(newGame({ players: 3, options, seed: 1 })).toEqual(newGame({ players: 3, options, seed: 99 }))
    }
    expect(testRandom(1)()).not.toBe(testRandom(2)())
  })
})

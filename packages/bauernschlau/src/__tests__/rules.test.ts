import { describe, expect, it } from 'vitest'
import { applyAction, isUndoLockedByReveal, type GameState as PlatformState } from '@game-platform/sdk'
import {
  CENTRE,
  emptyFields,
  FARMHOUSES,
  farmFields,
  fenceMoves,
  FIELDS,
  gameDefinition,
  GEESE,
  isEdgeVertex,
  junction,
  normalizeGameOptions,
  sheepCounters,
  vertexNeighbours,
  vertexRing,
  type GameState,
  type Sheep,
} from '../rules'
import { arrange, finishBorders, newGame, placeSheep, play, skipOpening } from '../testing'
import type { GameAction } from '../types'

const PLUS1: Sheep = { value: 1, black: false }
const BLACK: Sheep = { value: 0, black: true }

function reject(state: GameState, action: GameAction): string {
  const result = applyAction(state as PlatformState, action)
  if (result.ok) throw new Error(`${action.type} was accepted`)
  return result.error
}

/** Puts a sheep straight onto the board (no action logged). */
function withSheep(state: GameState, cell: number, sheep: Sheep, faceUp: boolean, placedBy = 'p2'): GameState {
  return arrange(state, (g) => (g.sheep[cell] = { sheep, faceUp, placedBy }))
}

describe('§3 setup', () => {
  it('R-SETUP-01..05: farms, fences, borders, the dog, the bag and a random start player', () => {
    const s = newGame({ players: 3, start: 1 })
    const g = s.game
    expect(g.seatOrder).toEqual(['p1', 'p2', 'p3'])
    expect(g.seatOrder.map((id) => g.farms[id].position)).toEqual([0, 2, 4])
    expect(g.seatOrder.map((id) => g.farms[id].fencesLeft)).toEqual([16, 16, 16])
    expect(g.farms.p1.borders).toEqual([2, 0])
    expect(g.borders.map((b) => b.between)).toEqual([
      ['p1', 'p2'],
      ['p2', 'p3'],
      ['p3', 'p1'],
    ])
    expect(g.borders[0].starts).toEqual([junction(0), junction(1)])
    expect(g.dog).toBeNull()
    expect(g.bag).toHaveLength(90)
    expect(s.turn).toBe(1)
    expect(s.pendingPlayerIds).toEqual(['p2'])
    expect(s.setupRandom).toHaveLength(1)
  })

  it('R-SETUP-03: fences by player count; six players have one start per border', () => {
    expect([2, 3, 4, 5, 6].map((n) => newGame({ players: n }).game.farms.p1.fencesLeft)).toEqual([16, 16, 12, 12, 10])
    const six = newGame({ players: 6 })
    expect(six.game.borders.every((b, i) => b.starts.length === 1 && b.starts[0] === junction(i))).toBe(true)
    expect(newGame({ players: 2 }).game.borders.map((b) => b.starts.length)).toEqual([3, 3])
  })

  it('normalizes options', () => {
    expect(normalizeGameOptions(undefined)).toEqual({ multiRoundScoring: false, firstEdition: true })
    expect(normalizeGameOptions({ multiRoundScoring: 'yes', firstEdition: 'no' })).toEqual({ multiRoundScoring: false, firstEdition: true })
    expect(normalizeGameOptions({ multiRoundScoring: true, firstEdition: false })).toEqual({ multiRoundScoring: true, firstEdition: false })
    expect(gameDefinition.describeOptions(normalizeGameOptions({}))).toBe('First edition')
    expect(gameDefinition.rulesVersion).toBe(2)
  })
})

describe('§4 turns and the opening round', () => {
  it('R-OPEN-01: the first round is one sheep each, then round 2 starts with the start player', () => {
    let s = newGame({ players: 3, start: 1 })
    expect(reject(s, { type: 'SHEEP_SPECIAL', playerId: 'p2' })).toMatch(/first round/)
    expect(reject(s, { type: 'BUILD_FENCE', playerId: 'p2', border: 0, from: junction(0), to: 'x' })).toMatch(/first round/)
    expect(reject(s, { type: 'DRAW_SHEEP', playerId: 'p1' })).toMatch(/isn't your turn/)
    s = play(s, { type: 'DRAW_SHEEP', playerId: 'p2' })
    expect(s.game.step).toBe('place')
    expect(s.game.hand).toHaveLength(1)
    expect(s.game.bag).toHaveLength(89)
    expect(s.pendingPlayerIds).toEqual(['p2'])
    expect(reject(s, { type: 'DRAW_SHEEP', playerId: 'p2' })).toMatch(/Place the sheep you drew first/)
    expect(reject(s, { type: 'PLACE_SHEEP', playerId: 'p2', cell: CENTRE, index: 0 })).toMatch(/field/)
    expect(reject(s, { type: 'PLACE_SHEEP', playerId: 'p2', cell: FARMHOUSES[0], index: 0 })).toMatch(/field/)
    expect(reject(s, { type: 'PLACE_SHEEP', playerId: 'p2', cell: FIELDS[0], index: 1 })).toMatch(/one of the sheep/)
    s = play(s, { type: 'PLACE_SHEEP', playerId: 'p2', cell: FIELDS[0], index: 0 })
    expect(s.game.sheep[FIELDS[0]]).toMatchObject({ faceUp: false, placedBy: 'p2' })
    expect(s.pendingPlayerIds).toEqual(['p3'])
    expect(reject(s, { type: 'PLACE_SHEEP', playerId: 'p3', cell: FIELDS[0], index: 0 })).toMatch(/no sheep to place/)
    s = placeSheep(s, FIELDS[1])
    expect(s.turn).toBe(1)
    expect(s.pendingPlayerIds).toEqual(['p1'])
    s = placeSheep(s, FIELDS[2])
    expect(s.turn).toBe(2)
    expect(s.pendingPlayerIds).toEqual(['p2'])
  })

  it('R-PLACE-01: an occupied field — by a sheep or the dog — is refused', () => {
    let s = skipOpening(newGame({ players: 2 }))
    s = arrange(s, (g) => (g.dog = FIELDS[10]))
    s = play(s, { type: 'DRAW_SHEEP', playerId: 'p1' })
    expect(reject(s, { type: 'PLACE_SHEEP', playerId: 'p1', cell: FIELDS[0], index: 0 })).toMatch(/occupied/)
    expect(reject(s, { type: 'PLACE_SHEEP', playerId: 'p1', cell: FIELDS[10], index: 0 })).toMatch(/occupied/)
  })
})

describe('§5 hidden information', () => {
  it('R-HIDE-01..03: face-down sheep only to their placer, the hand only to the drawer, all revealed at the end', () => {
    let s = newGame({ players: 2 })
    s = play(arrange(s, (g) => (g.bag = [{ value: 5, black: false }, PLUS1])), { type: 'DRAW_SHEEP', playerId: 'p1' }, 1)
    const drawn = s.game.hand[0]!
    expect(gameDefinition.redactGame(s, 'p1').hand).toEqual([drawn])
    expect(gameDefinition.redactGame(s, 'p2').hand).toEqual([null])
    expect(gameDefinition.redactGame(s, null).bag).toEqual([null])
    s = play(s, { type: 'PLACE_SHEEP', playerId: 'p1', cell: FIELDS[5], index: 0 })
    expect(gameDefinition.redactGame(s, 'p1').sheep[FIELDS[5]]!.sheep).toEqual(drawn)
    expect(gameDefinition.redactGame(s, 'p2').sheep[FIELDS[5]]).toEqual({ sheep: null, faceUp: false, placedBy: 'p1' })
    expect(gameDefinition.redactGame(s, null).sheep[FIELDS[5]]!.sheep).toBeNull()
    for (const entry of s.actionHistory) expect(gameDefinition.isActionSecret(entry, s, 'p2')).toBe(false)
    const conceded = applyAction(s as PlatformState, { type: 'CONCEDE', playerId: 'p2' })
    if (!conceded.ok) throw new Error(conceded.error)
    const ended = conceded.state as GameState
    expect(ended.status).toBe('completed')
    expect(gameDefinition.redactGame(ended, 'p2').sheep[FIELDS[5]]!.sheep).toEqual(drawn)
    expect(ended.winnerPlayerIds).toEqual(['p1'])
  })

  it('a draw locks undo in a room that locks revealed information; placing it does not', () => {
    const genesis = newGame({ players: 2, lockRevealedInformationEnabled: true })
    const drawn = play(genesis, { type: 'DRAW_SHEEP', playerId: 'p1' })
    expect(isUndoLockedByReveal(genesis as PlatformState, drawn as PlatformState)).toBe(true)
    const placed = play(drawn, { type: 'PLACE_SHEEP', playerId: 'p1', cell: FIELDS[0], index: 0 })
    expect(isUndoLockedByReveal(genesis as PlatformState, placed as PlatformState)).toBe(false)
  })
})

describe('§6 flipping and the sheepdog', () => {
  it('R-FLIP-01: turns over a face-down sheep and ends the turn', () => {
    let s = withSheep(skipOpening(newGame({ players: 2 })), FIELDS[20], { value: -3, black: false }, false)
    expect(reject(s, { type: 'FLIP_SHEEP', playerId: 'p1', cell: FIELDS[21] })).toMatch(/no face-down sheep/)
    s = play(s, { type: 'FLIP_SHEEP', playerId: 'p1', cell: FIELDS[20] })
    expect(s.game.sheep[FIELDS[20]]).toMatchObject({ faceUp: true, sheep: { value: -3 } })
    expect(s.pendingPlayerIds).toEqual(['p2'])
    expect(reject(s, { type: 'FLIP_SHEEP', playerId: 'p2', cell: FIELDS[20] })).toMatch(/no face-down sheep/)
    expect(gameDefinition.describeAction({ type: 'FLIP_SHEEP', playerId: 'p1', cell: FIELDS[20] }, s, s).message).toMatch(/−3/)
  })

  it('R-FLIP-02: a black sheep gives two extra actions', () => {
    let s = withSheep(skipOpening(newGame({ players: 2 })), FIELDS[20], BLACK, false)
    s = play(s, { type: 'FLIP_SHEEP', playerId: 'p1', cell: FIELDS[20] })
    expect(s.pendingPlayerIds).toEqual(['p1'])
    expect(s.game.actionsLeft).toBe(2)
    s = placeSheep(s, FIELDS[30])
    expect(s.pendingPlayerIds).toEqual(['p1'])
    s = placeSheep(s, FIELDS[31])
    expect(s.pendingPlayerIds).toEqual(['p2'])
    expect(s.game.actionsLeft).toBe(1)
  })

  it('R-DOG-01..04: the dog takes the sheep’s field and stays there; the sheep moves and is turned over', () => {
    const base = withSheep(skipOpening(newGame({ players: 2 })), FIELDS[40], { value: 2, black: false }, false)
    const [a, b] = emptyFields(base.game)
    let s = play(base, { type: 'HERD', playerId: 'p1', from: FIELDS[40], to: a })
    expect(s.game.sheep[FIELDS[40]]).toBeNull()
    expect(s.game.sheep[a]).toMatchObject({ faceUp: true, sheep: { value: 2 } })
    expect(s.game.dog).toBe(FIELDS[40])
    expect(s.pendingPlayerIds).toEqual(['p2'])
    expect(gameDefinition.describeAction({ type: 'HERD', playerId: 'p1', from: FIELDS[40], to: a }, base, s).message).not.toMatch(/dog (stays|goes)/)
    // Naming the dog's own field is fine; anywhere else is refused.
    expect(play(base, { type: 'HERD', playerId: 'p1', from: FIELDS[40], to: a, dog: FIELDS[40] }).game.dog).toBe(FIELDS[40])
    expect(reject(base, { type: 'HERD', playerId: 'p1', from: FIELDS[40], to: a, dog: null })).toMatch(/dog stays on/)
    expect(reject(base, { type: 'HERD', playerId: 'p1', from: FIELDS[40], to: a, dog: b })).toMatch(/dog stays on/)
    expect(reject(base, { type: 'HERD', playerId: 'p1', from: FIELDS[40], to: FIELDS[0] })).toMatch(/empty field/)
    expect(reject(base, { type: 'HERD', playerId: 'p1', from: a, to: b })).toMatch(/no face-down sheep/)
    // The dog's own field is free for the sheep once the dog leaves it.
    s = play(arrange(base, (g) => (g.dog = b)), { type: 'HERD', playerId: 'p1', from: FIELDS[40], to: b })
    expect(s.game.sheep[b]).toMatchObject({ faceUp: true })
    expect(s.game.dog).toBe(FIELDS[40])
  })

  it('R-DOG-03: under the first-edition rule (the default) a black sheep herded by the dog gives no extra actions', () => {
    const herd = (options: { firstEdition?: boolean }) =>
      play(withSheep(skipOpening(newGame({ players: 2, options })), FIELDS[40], BLACK, false), { type: 'HERD', playerId: 'p1', from: FIELDS[40], to: FIELDS[41] })
    const first = herd({})
    expect(first.pendingPlayerIds).toEqual(['p2'])
    expect(first.game.actionsLeft).toBe(1)
    expect(gameDefinition.describeAction({ type: 'HERD', playerId: 'p1', from: FIELDS[40], to: FIELDS[41] }, first, first).message).toMatch(/No extra actions with the dog/)
    const later = herd({ firstEdition: false })
    expect(later.pendingPlayerIds).toEqual(['p1'])
    expect(later.game.actionsLeft).toBe(2)
    // Flipping a black sheep still gives them either way.
    const flipped = play(withSheep(skipOpening(newGame({ players: 2 })), FIELDS[40], BLACK, false), { type: 'FLIP_SHEEP', playerId: 'p1', cell: FIELDS[40] })
    expect(flipped.game.actionsLeft).toBe(2)
  })
})

describe('§11 rules version 1', () => {
  it('the dog could stay, go home or move on after herding', () => {
    const base = withSheep(skipOpening(newGame({ players: 2, rulesVersion: 1 })), FIELDS[40], { value: 2, black: false }, false)
    expect(base.rulesVersion).toBe(1)
    const [a, b] = emptyFields(base.game)
    expect(play(base, { type: 'HERD', playerId: 'p1', from: FIELDS[40], to: a, dog: FIELDS[40] }).game.dog).toBe(FIELDS[40])
    expect(play(base, { type: 'HERD', playerId: 'p1', from: FIELDS[40], to: a, dog: null }).game.dog).toBeNull()
    expect(play(base, { type: 'HERD', playerId: 'p1', from: FIELDS[40], to: a, dog: b }).game.dog).toBe(b)
    expect(reject(base, { type: 'HERD', playerId: 'p1', from: FIELDS[40], to: a, dog: a })).toMatch(/dog can stay/)
  })

  it('a black sheep herded by the dog always gave extra actions, whatever the option says', () => {
    const s = play(withSheep(skipOpening(newGame({ players: 2, rulesVersion: 1 })), FIELDS[40], BLACK, false), { type: 'HERD', playerId: 'p1', from: FIELDS[40], to: FIELDS[41], dog: null })
    expect(s.options.firstEdition).toBe(true)
    expect(s.pendingPlayerIds).toEqual(['p1'])
    expect(s.game.actionsLeft).toBe(2)
  })
})

describe('§7 sheep special', () => {
  it('R-SPECIAL-01/02: only with no face-down sheep; one sheep per player, each placed in turn', () => {
    let s = skipOpening(newGame({ players: 3 }))
    expect(reject(s, { type: 'SHEEP_SPECIAL', playerId: 'p1' })).toMatch(/face up/)
    s = arrange(s, (g) => g.sheep.forEach((x) => x && (x.faceUp = true)))
    s = play(s, { type: 'SHEEP_SPECIAL', playerId: 'p1' })
    expect(s.game.hand).toHaveLength(3)
    expect(s.game.step).toBe('place')
    const [a, b, c] = emptyFields(s.game)
    s = play(s, { type: 'PLACE_SHEEP', playerId: 'p1', cell: a, index: 2 })
    s = play(s, { type: 'PLACE_SHEEP', playerId: 'p1', cell: b, index: 0 })
    expect(s.pendingPlayerIds).toEqual(['p1'])
    s = play(s, { type: 'PLACE_SHEEP', playerId: 'p1', cell: c, index: 0 })
    expect(s.pendingPlayerIds).toEqual(['p2'])
    expect([a, b, c].every((cell) => s.game.sheep[cell]?.placedBy === 'p1' && !s.game.sheep[cell]!.faceUp)).toBe(true)
  })

  it('takes no more than the bag holds', () => {
    let s = arrange(skipOpening(newGame({ players: 3 })), (g) => {
      g.sheep.forEach((x) => x && (x.faceUp = true))
      g.bag = [PLUS1]
    })
    s = play(s, { type: 'SHEEP_SPECIAL', playerId: 'p1' })
    expect(s.game.hand).toHaveLength(1)
  })
})

describe('§6 fences', () => {
  it('R-FENCE-01..02: the first fence leaves the junction between the farmhouses, on your own borders only', () => {
    let s = skipOpening(newGame({ players: 6 }))
    const moves = fenceMoves(s.game.borders, 0)
    expect(moves).toHaveLength(2)
    expect(moves.every((m) => m.from === junction(0))).toBe(true)
    expect(reject(s, { type: 'BUILD_FENCE', playerId: 'p1', ...fenceMoves(s.game.borders, 2)[0] })).toMatch(/own farm/)
    s = play(s, { type: 'BUILD_FENCE', playerId: 'p1', ...moves[0] })
    expect(s.game.borders[0]).toMatchObject({ path: [moves[0].from, moves[0].to], builtBy: ['p1'], finished: false })
    expect(s.game.farms.p1.fencesLeft).toBe(9)
    // p2 shares that border and may extend it.
    const next = fenceMoves(s.game.borders, 0)
    expect(next.every((m) => m.from === moves[0].to)).toBe(true)
    s = play(s, { type: 'BUILD_FENCE', playerId: 'p2', ...next[0] })
    expect(s.game.borders[0].builtBy).toEqual(['p1', 'p2'])
  })

  it('R-FENCE-03/04: never inward, never along a farmhouse after the first fence, never onto another line', () => {
    let s = skipOpening(newGame({ players: 6 }))
    const [first] = fenceMoves(s.game.borders, 0)
    s = play(s, { type: 'BUILD_FENCE', playerId: 'p1', ...first })
    const options = vertexNeighbours(first.to).filter((v) => v !== first.from)
    const legal = fenceMoves(s.game.borders, 0).map((m) => m.to)
    // From the first fence's end: one way out between two fields, one way along the farmhouse.
    expect(legal).toHaveLength(1)
    const alongFarmhouse = options.find((v) => !legal.includes(v))!
    expect(reject(s, { type: 'BUILD_FENCE', playerId: 'p2', border: 0, from: first.to, to: alongFarmhouse })).toMatch(/turn back/)
    expect(reject(s, { type: 'BUILD_FENCE', playerId: 'p2', border: 0, from: first.to, to: first.from })).toMatch(/turn back/)
    expect(reject(s, { type: 'BUILD_FENCE', playerId: 'p2', border: 0, from: first.from, to: first.to })).toMatch(/turn back/)
    // Every legal step keeps to its ring boundary or moves out.
    for (const m of fenceMoves(s.game.borders, 0)) expect(vertexRing(m.to)).toBeGreaterThanOrEqual(vertexRing(m.from))
  })

  it('R-FENCE-06: a border is finished at the edge; it takes at least eight fences', () => {
    const s = arrange(skipOpening(newGame({ players: 6 })), (g) => finishBorders(g, [0]))
    const border = s.game.borders[0]
    expect(border.finished).toBe(true)
    expect(isEdgeVertex(border.path[border.path.length - 1])).toBe(true)
    expect(border.builtBy).toHaveLength(8)
    expect(fenceMoves(s.game.borders, 0)).toEqual([])
    expect(reject(s, { type: 'BUILD_FENCE', playerId: 'p1', border: 0, from: border.path[8], to: border.path[7] })).toMatch(/already reaches the edge/)
  })

  it('R-FENCE-07: no fences left, no building', () => {
    const s = arrange(skipOpening(newGame({ players: 6 })), (g) => (g.farms.p1.fencesLeft = 0))
    expect(reject(s, { type: 'BUILD_FENCE', playerId: 'p1', ...fenceMoves(s.game.borders, 0)[0] })).toMatch(/no fences left/)
  })
})

describe('§8 the end and scoring', () => {
  it('R-END-01, R-SCORE-01..04: the game ends when an enclosed farm is full; face-up sheep score, geese double, face-down and spare fences cost', () => {
    let s = arrange(skipOpening(newGame({ players: 2 })), (g) => {
      g.sheep = g.sheep.map(() => null)
      finishBorders(g, [0, 1])
    })
    const mine = farmFields(s.game.borders, s.game.farms.p1.position)
    const theirs = farmFields(s.game.borders, s.game.farms.p2.position)
    expect(mine.length + theirs.length).toBe(84)
    const last = mine[mine.length - 1]
    const plain = theirs.find((c) => !GEESE.has(c))!
    s = arrange(s, (g) => {
      for (const cell of mine) if (cell !== last) g.sheep[cell] = { sheep: { value: 2, black: false }, faceUp: true, placedBy: 'p2' }
      g.sheep[plain] = { sheep: { value: -3, black: false }, faceUp: true, placedBy: 'p1' }
      g.sheep[theirs.find((c) => c !== plain)!] = { sheep: { value: 5, black: false }, faceUp: false, placedBy: 'p1' }
    })
    s = placeSheep(s, last, { value: 4, black: false })
    expect(s.status).toBe('completed')
    expect(s.game.endReason).toEqual({ kind: 'farmFull', playerId: 'p1' })
    const geese = mine.filter((c) => c !== last && GEESE.has(c)).length
    const expected = 2 * (mine.length - 1 - geese) + 4 * geese
    expect(s.game.finalScores!.p1).toEqual({ enclosed: true, farm: expected, fences: -(16 - s.game.borders[0].builtBy.length), total: expected - (16 - s.game.borders[0].builtBy.length) })
    expect(s.game.finalScores!.p2.farm).toBe(-3)
    expect(s.winnerPlayerIds).toEqual(['p1'])
    expect(s.pendingPlayerIds).toEqual([])
    expect(gameDefinition.describeAction({ type: 'PLACE_SHEEP', playerId: 'p1', cell: last, index: 0 }, s, s).message).toMatch(/Game over — Alice's farm is enclosed and full/)
  })

  it('R-SCORE-05: an unenclosed farm scores nothing — or, in the multi-round variant, 10 below the lowest enclosed farm', () => {
    for (const multiRoundScoring of [false, true]) {
      let s = arrange(skipOpening(newGame({ players: 3, options: { multiRoundScoring } })), (g) => {
        g.sheep = g.sheep.map(() => null)
        finishBorders(g, [2, 0])
      })
      const mine = farmFields(s.game.borders, s.game.farms.p1.position)
      s = arrange(s, (g) => {
        for (const cell of mine.slice(0, -1)) g.sheep[cell] = { sheep: { value: GEESE.has(cell) ? 0 : 1, black: false }, faceUp: true, placedBy: 'p2' }
      })
      s = placeSheep(s, mine[mine.length - 1])
      const farm = mine.slice(0, -1).filter((c) => !GEESE.has(c)).length
      expect(s.game.finalScores!.p1.farm).toBe(farm)
      expect(s.game.finalScores!.p2).toMatchObject({ enclosed: false, farm: multiRoundScoring ? farm - 10 : 0, fences: -16 })
    }
  })

  it('R-END-02: when nobody can do anything more, the game ends', () => {
    let s = arrange(skipOpening(newGame({ players: 2 })), (g) => {
      const spare = emptyFields(g)[0]
      for (const cell of FIELDS) if (cell !== spare) g.sheep[cell] = { sheep: PLUS1, faceUp: true, placedBy: 'p1' }
      g.bag = [PLUS1]
      g.farms.p1.fencesLeft = 0
      g.farms.p2.fencesLeft = 0
    })
    s = play(s, { type: 'DRAW_SHEEP', playerId: 'p1' })
    // One empty field and one sheep in hand: placed without asking (nextForcedAction).
    expect(s.pendingPlayerIds).toEqual(['p2'])
    // (The opening round took two entries per player.)
    expect(s.actionHistory).toHaveLength(2 * 2 + 1)
    s = play(s, { type: 'FLIP_SHEEP', playerId: 'p2', cell: FIELDS.find((c) => !s.game.sheep[c]!.faceUp)! })
    expect(s.status).toBe('completed')
    expect(s.game.endReason).toEqual({ kind: 'stalemate' })
  })
})

describe('§9 leaving', () => {
  it('R-LEAVE-01: a player who concedes mid-placement puts the drawn sheep back; the next player goes on', () => {
    let s = newGame({ players: 3 })
    s = play(s, { type: 'DRAW_SHEEP', playerId: 'p1' })
    const result = applyAction(s as PlatformState, { type: 'CONCEDE', playerId: 'p1' })
    if (!result.ok) throw new Error(result.error)
    s = result.state as GameState
    expect(s.game.bag).toHaveLength(sheepCounters().length)
    expect(s.game.hand).toEqual([])
    expect(s.pendingPlayerIds).toEqual(['p2'])
    expect(s.game.step).toBe('choose')
  })
})

// Randomised games: a bot proposes random (sometimes illegal) moves, the rules
// must reject the illegal ones cleanly (never throw), the legal ones must keep
// every invariant, and the whole log must replay to the same state.

import { describe, expect, it } from 'vitest'
import { applyAction, createRandom, replayActions, type GameState as PlatformState, type Random } from '@game-platform/sdk'
import {
  canStillFinish,
  emptyFields,
  faceDownCells,
  FENCES_BY_PLAYERS,
  fenceMovesFor,
  FIELDS,
  gameDefinition,
  isEdgeVertex,
  occupiedVertices,
  sheepCounters,
  type GameState,
} from '../rules'
import { newGame, simplestMove, testRandom } from '../testing'
import type { GameAction } from '../types'

function candidates(s: GameState, r: Random): GameAction[] {
  const g = s.game
  const actor = r.next() < 0.03 ? r.pick(g.seatOrder) : s.pendingPlayerIds[0]
  const out: GameAction[] = []
  if (r.next() < 0.05) out.push({ type: 'FLIP_SHEEP', playerId: actor, cell: r.int(-1, 95) })
  if (g.step === 'place') {
    const empty = emptyFields(g)
    out.push({ type: 'PLACE_SHEEP', playerId: actor, cell: r.pick(empty), index: r.int(0, g.hand.length - 1) })
    return out
  }
  const faceDown = faceDownCells(g)
  const roll = r.next()
  if (roll < 0.35) {
    const moves = fenceMovesFor(g, actor)
    if (moves.length > 0) out.push({ type: 'BUILD_FENCE', playerId: actor, ...r.pick(moves) })
  } else if (roll < 0.5 && faceDown.length > 0) {
    out.push({ type: 'FLIP_SHEEP', playerId: actor, cell: r.pick(faceDown) })
  } else if (roll < 0.62 && faceDown.length > 0 && (emptyFields(g).length > 0 || g.dog !== null)) {
    const from = r.pick(faceDown)
    const free = [...emptyFields(g), ...(g.dog !== null ? [g.dog] : [])]
    const to = r.pick(free)
    const dogChoices = [from, null, ...free.filter((c) => c !== to)]
    out.push({ type: 'HERD', playerId: actor, from, to, dog: r.pick(dogChoices) })
  }
  if (faceDown.length === 0) out.push({ type: 'SHEEP_SPECIAL', playerId: actor })
  out.push({ type: 'DRAW_SHEEP', playerId: actor })
  return out
}

function checkInvariants(s: GameState): void {
  const g = s.game
  const onBoard = g.sheep.filter((x) => x !== null)
  expect(g.bag.length + g.hand.length + onBoard.length).toBe(sheepCounters().length)
  g.sheep.forEach((x, cell) => {
    if (x) expect(FIELDS).toContain(cell)
  })
  if (g.dog !== null) {
    expect(FIELDS).toContain(g.dog)
    expect(g.sheep[g.dog]).toBeNull()
  }
  const vertices = g.borders.flatMap((b) => b.path)
  expect(new Set(vertices).size).toBe(vertices.length)
  const blocked = occupiedVertices(g.borders)
  for (const b of g.borders) {
    expect(b.builtBy.length).toBe(Math.max(0, b.path.length - 1))
    expect(b.finished).toBe(b.path.length > 0 && isEdgeVertex(b.path[b.path.length - 1]))
    expect(canStillFinish(b, blocked)).toBe(true)
  }
  for (const id of g.seatOrder) {
    const built = g.borders.reduce((n, b) => n + b.builtBy.filter((x) => x === id).length, 0)
    expect(g.farms[id].fencesLeft + built).toBe(FENCES_BY_PLAYERS[g.seatOrder.length])
  }
  if (s.status !== 'active') {
    expect(s.pendingPlayerIds).toEqual([])
    expect(g.hand).toEqual([])
    return
  }
  expect(s.pendingPlayerIds).toEqual([g.turnPlayerId])
  expect(s.activePlayerId).toBe(g.turnPlayerId)
  expect(s.players.find((p) => p.id === g.turnPlayerId)!.eliminated).toBe(false)
  expect(g.step === 'place').toBe(g.hand.length > 0)
  expect(g.actionsLeft).toBeGreaterThanOrEqual(1)
  // R-HIDE-01: every viewer sees exactly the face-down sheep they placed.
  for (const viewer of g.seatOrder) {
    const view = gameDefinition.redactGame(s, viewer)
    expect(view.bag.every((x) => x === null)).toBe(true)
    view.sheep.forEach((x, cell) => {
      if (x && !x.faceUp) expect(x.sheep === null).toBe(x.placedBy !== viewer)
      if (x?.faceUp) expect(x.sheep).toEqual(g.sheep[cell]!.sheep)
    })
    if (g.hand.length > 0) expect(view.hand.every((x) => x === null)).toBe(viewer !== g.turnPlayerId)
  }
}

/** What the games together reached — the last test checks the bot exercised the rarer paths. */
const everSeen = new Set<string>()

describe('random games', () => {
  for (const players of [2, 3, 4, 5, 6]) {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      it(`${players} players, seed ${seed}${seed === 4 && players > 2 ? ', with a concession' : ''}`, () => {
        const r = createRandom('bauernschlau-fuzz', players, seed)
        let s = newGame({ players, start: seed % players, options: { multiRoundScoring: seed === 5 } })
        const genesis = s
        const concedeAt = seed === 4 && players > 2 ? r.int(10, 150) : -1
        for (let step = 0; step < 3000 && s.status === 'active'; step++) {
          if (step === concedeAt) {
            const result = applyAction(s as PlatformState, { type: 'CONCEDE', playerId: r.pick(s.game.seatOrder) })
            if (!result.ok) throw new Error(`CONCEDE rejected: ${result.error}`)
            s = result.state as GameState
            checkInvariants(s)
            continue
          }
          let applied = false
          for (const action of candidates(s, r)) {
            const before = s.game.actionsLeft
            const result = applyAction(s as PlatformState, action, { random: testRandom(step + seed * 1000) })
            if (result.ok) {
              s = result.state as GameState
              everSeen.add(action.type)
              if (s.status === 'active' && s.game.turnPlayerId === action.playerId && s.game.actionsLeft > before) everSeen.add('blackSheepBonus')
              applied = true
              break
            }
          }
          if (!applied) {
            const result = applyAction(s as PlatformState, simplestMove(s), { random: testRandom(step) })
            if (!result.ok) throw new Error(`simplest move rejected in ${s.game.step}: ${result.error}`)
            s = result.state as GameState
          }
          checkInvariants(s)
        }
        expect(s.status).toBe('completed')
        expect(s.game.finalScores).not.toBeNull()
        expect(s.winnerPlayerIds.length).toBeGreaterThan(0)
        everSeen.add(`end:${s.game.endReason?.kind}`)
        if (process.env.FUZZ_STATS) console.log(players, seed, s.actionHistory.length, s.turn, JSON.stringify(s.game.endReason), JSON.stringify(s.game.finalScores))
        expect(replayActions(genesis as PlatformState, s.actionHistory)).toEqual(s)
      })
    }
  }

  it('between them, reached every action, the black-sheep bonus and a full farm', () => {
    expect([...everSeen]).toEqual(
      expect.arrayContaining(['DRAW_SHEEP', 'SHEEP_SPECIAL', 'PLACE_SHEEP', 'FLIP_SHEEP', 'HERD', 'BUILD_FENCE', 'blackSheepBonus', 'end:farmFull']),
    )
  })
})

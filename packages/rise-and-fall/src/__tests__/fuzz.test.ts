// Randomised games on the platform: a bot plays random legal moves — unit
// actions with random targets, declines, buy-backs, the odd retraction and
// concede — plus the occasional random (usually illegal) move, which the rules
// must reject cleanly. Every state keeps the envelope accurate and the
// redacted views free of the secrets they hide, and the whole log replays to
// the same state.

import { applyAction, buildGameLog, randomFrom, redactStateForPlayer, replayActions, type Random } from '@game-platform/sdk'
import { describe, expect, it } from 'vitest'
import type { GameState } from '../adapter.ts'
import { contentFor, toEngine } from '../rules.ts'
import { newGame, simplestMove, testRandom, withoutTimestamps } from '../testing.ts'
import type { GameAction, GameData, GameOptions } from '../types.ts'

function tryMove(state: GameState, action: GameAction): GameState | null {
  const result = applyAction(state, action)
  return result.ok ? (result.state as GameState) : null
}

/** A random legal unit action for the acting player, or null to pass. */
function randomUnitAction(state: GameState, playerId: string, r: Random): GameState | null {
  const engine = toEngine(state)
  const content = contentFor(state)
  const cardId = engine.chosenCardIdByPlayerId[playerId]
  const kind = cardId ? engine.cards[cardId]?.kind : undefined
  if (!kind) return null
  const kinds = [kind, ...(content.unitContent.companionKindsByCardKind[kind] ?? [])]
  const units = r.shuffle(engine.units.filter((u) => u.ownerId === playerId && kinds.includes(u.kind)))
  const coords = Object.values(engine.board.tiles).map((t) => t.coord)
  for (const unit of units) {
    for (const unitAction of r.shuffle(content.unitContent.actionsByKind[unit.kind] ?? [])) {
      const targets = [undefined, ...r.shuffle(coords)]
      for (const target of targets) {
        const next = tryMove(state, { type: 'RESOLVE_UNIT_ACTION', playerId, unitActions: [{ unitId: unit.id, actionId: unitAction.id, ...(target ? { target } : {}) }] })
        if (next) return next
      }
    }
  }
  return null
}

function step(state: GameState, r: Random, seen: Set<string>): GameState {
  if (r.next() < 0.02) {
    // A random, usually illegal, move from anyone: must be rejected without throwing (or accepted if it happens to be legal).
    const playerId = r.pick(state.players).id
    const junk: GameAction[] = [
      { type: 'PASS_ACTIONS', playerId },
      { type: 'PASS_PURCHASE', playerId },
      { type: 'CHOOSE_CARD', playerId, cardId: 'nope' },
      { type: 'PLACE_UNIT', playerId, unitKind: 'city', coord: { q: 99, r: 99 } },
      { type: 'RETRACT_CHOICE', playerId },
      { type: 'RETRACT_DECLINE', playerId },
    ]
    const next = tryMove(state, r.pick(junk))
    if (next) return next
  }
  if (state.players.filter((p) => !p.eliminated).length > 2 && r.next() < 0.002) {
    seen.add('concede')
    return tryMove(state, { type: 'CONCEDE', playerId: r.pick(state.turnOrder) } as never) ?? state
  }

  const engine = toEngine(state)
  const playerId = r.pick(state.pendingPlayerIds)
  const player = engine.players.find((p) => p.id === playerId)!
  switch (state.phase) {
    case 'selectCards': {
      if (engine.chosenCardIdByPlayerId[playerId] == null && r.next() < 0.05) break
      const next = tryMove(state, { type: 'CHOOSE_CARD', playerId, cardId: r.pick(player.handCardIds) })
      if (next && r.next() < 0.05) {
        const retracted = tryMove(next, { type: 'RETRACT_CHOICE', playerId })
        if (retracted) {
          seen.add('retractChoice')
          return retracted
        }
      }
      if (next) return next
      break
    }
    case 'actions': {
      if (r.next() < 0.85) {
        const next = randomUnitAction(state, playerId, r)
        if (next) {
          seen.add('unitAction')
          return next
        }
      }
      return tryMove(state, { type: 'PASS_ACTIONS', playerId })!
    }
    case 'decline': {
      seen.add('decline')
      const next = tryMove(state, { type: 'MOVE_TO_DECLINE', playerId, cardId: r.pick([...player.handCardIds, ...player.discardCardIds]) })
      if (next && r.next() < 0.1) {
        const retracted = tryMove(next, { type: 'RETRACT_DECLINE', playerId })
        if (retracted) {
          seen.add('retractDecline')
          return retracted
        }
      }
      if (next) return next
      break
    }
    case 'purchase': {
      seen.add('purchase')
      if (r.next() < 0.6 && player.declineCardIds.length > 0) {
        const next = tryMove(state, { type: 'PURCHASE_CARD', playerId, cardId: r.pick(player.declineCardIds) })
        if (next) {
          seen.add('buyBack')
          return next
        }
      }
      return tryMove(state, { type: 'PASS_PURCHASE', playerId })!
    }
  }
  const fallback = simplestMove(state)
  if (!fallback) throw new Error(`Wedged in phase ${state.phase}`)
  return tryMove(state, fallback)!
}

function checkInvariants(state: GameState): void {
  const engine = toEngine(state)
  expect(new Set(state.pendingPlayerIds).size).toBe(state.pendingPlayerIds.length)
  for (const id of state.pendingPlayerIds) expect(state.players.find((p) => p.id === id)?.eliminated).toBe(false)
  if (state.status === 'completed') {
    expect(state.pendingPlayerIds).toEqual([])
    expect(state.winnerPlayerIds.length).toBeGreaterThan(0)
  } else if (state.phase === 'actions' || state.phase === 'placeTiles' || state.phase === 'placeUnits') {
    expect(state.pendingPlayerIds).toEqual([state.activePlayerId])
  } else {
    expect(state.activePlayerId).toBeNull()
    expect(state.pendingPlayerIds).toEqual([...new Set(engine.pendingPlayerIds)])
  }
  // Resources are conserved between players and the bank.
  for (const resource of ['gold', 'wood', 'stone'] as const) {
    expect(engine.players.reduce((sum, p) => sum + p.resources[resource], engine.resourceBank[resource])).toBe(totalSupply(state, resource))
  }
  // Every card is in exactly one zone of its owner.
  for (const p of engine.players) {
    const zones = [...p.handCardIds, ...p.discardCardIds, ...p.supplyCardIds, ...p.declineCardIds, ...(p.currentlyPlayedCardId ? [p.currentlyPlayedCardId] : [])]
    expect(new Set(zones).size).toBe(zones.length)
  }
  // Redaction: another player's secret pick never reaches a viewer.
  if (state.phase === 'selectCards') {
    for (const viewer of state.players) {
      const view = redactStateForPlayer(state, viewer.id)
      for (const [id, cardId] of Object.entries(engine.chosenCardIdByPlayerId)) {
        if (id !== viewer.id && cardId) {
          expect((view.game as GameData).chosenCardIdByPlayerId[id]).toBeNull()
          expect(JSON.stringify(view.actionHistory.filter((e) => e.turn === state.turn))).not.toContain(`"cardId":"${cardId}"`)
        }
      }
    }
  }
}

const supplies = new Map<string, Record<string, number>>()
function totalSupply(state: GameState, resource: 'gold' | 'wood' | 'stone'): number {
  return supplies.get(state.gameId)![resource]
}

const everSeen = new Set<string>()

describe('random games', () => {
  const cases: { players: number; seed: number; options: Partial<GameOptions> }[] = [
    { players: 2, seed: 1, options: { gameLength: 1, mapMode: 'template', mapTemplateId: 'classic' } },
    { players: 3, seed: 2, options: { gameLength: 2, mapMode: 'template', mapTemplateId: 'classic' } },
    { players: 4, seed: 3, options: { gameLength: 2 } },
    { players: 3, seed: 4, options: { gameLength: 1, mapMode: 'solo', soloBuilder: 'random', soloBuilderUnitOrder: 'random' } },
    { players: 2, seed: 5, options: { gameLength: 2, activeTaleIds: ['the-ports', 'the-capital', 'the-banks'], mapMode: 'template', mapTemplateId: 'classic' } },
  ]
  for (const { players, seed, options } of cases) {
    it(`${players} players, seed ${seed}, ${JSON.stringify(options)}`, () => {
      const genesis = newGame({ players, options, hiddenInformationEnabled: true, seed })
      const engine = toEngine(genesis)
      supplies.set(genesis.gameId, { ...engine.resourceBank })
      const r = randomFrom(testRandom(seed * 7919))
      let state = genesis
      let moves = 0
      while (state.status === 'active' && moves < 1500) {
        state = step(state, r, everSeen)
        checkInvariants(state)
        moves++
      }
      if (state.status === 'completed') everSeen.add('completed')
      expect(withoutTimestamps(replayActions(genesis, state.actionHistory) as GameState)).toEqual(withoutTimestamps(state))
      expect(buildGameLog(genesis, state.actionHistory).length).toBeGreaterThanOrEqual(state.actionHistory.length)
    }, 120_000)
  }

  it('the bot reached the rarer paths', () => {
    expect([...everSeen].sort()).toEqual(expect.arrayContaining(['buyBack', 'completed', 'decline', 'purchase', 'retractChoice', 'unitAction']))
  })
})

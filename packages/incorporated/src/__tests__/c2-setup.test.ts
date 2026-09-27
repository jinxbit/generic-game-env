// C2 — setup and the phase machine (RULES.md §3, R-TURN).

import { describe, expect, it } from 'vitest'
import { createRandom, type LobbyState } from '@game-platform/sdk'
import { seatPlayers } from '@game-platform/sdk/testing'
import { initialState } from '../engine'
import { normalizeGameOptions } from '../rules'
import { growthPercent, interestValue } from '../sliders'
import { autoplay, corpPlayer, newGame, play } from '../testing'
import type { GameOptions } from '../types'

function lobby(players: number, options: Partial<GameOptions> = {}): LobbyState<GameOptions> {
  const seats = seatPlayers(players)
  return {
    gameId: 'g',
    gameType: 'incorporated',
    rulesVersion: 1,
    playMode: 'live',
    status: 'lobby',
    hiddenInformationEnabled: false,
    turn: 0,
    phase: null,
    activePlayerId: null,
    pendingPlayerIds: [],
    turnOrder: seats.map((s) => s.id),
    players: seats.map((s) => ({ ...s, eliminated: false })),
    winnerPlayerIds: [],
    options: normalizeGameOptions(options),
    actionHistory: [],
  }
}

describe('setup (R-SET)', () => {
  const table = initialState(lobby(4), createRandom('setup')).game

  it('R-SET-01: sets the sliders', () => {
    expect(growthPercent(table.sliders)).toBe(2)
    expect(interestValue(table.sliders)).toBe(20)
    expect(table.sliders.stress).toBe(1)
    expect(table.sliders.bop).toBe(3)
    expect(initialState(lobby(4, { threeRounds: true }), createRandom('setup')).game.sliders.bop).toBe(2)
  })

  it('R-SET-02: 2 executives each in a 4-player game, 3 for Old Money', () => {
    for (const p of Object.values(table.players)) expect(p.executiveCount).toBe(p.corp === 'OLD_MONEY' ? 3 : 2)
    for (const [count, each] of [
      [2, 4],
      [3, 3],
    ]) {
      const g = initialState(lobby(count), createRandom('x')).game
      for (const p of Object.values(g.players)) expect(p.executives).toBe(each)
    }
  })

  it('R-SET-03: R&D on the US ENERGY square — none with ACCUM_RD', () => {
    expect(table.rdSquare).toEqual({ country: 'US', square: 5 })
    expect(initialState(lobby(4, { accumRd: true }), createRandom('x')).game.rdSquare).toBeNull()
  })

  it('R-SET-04/05: 4 Outlook cards (3 with THREE_ROUNDS), 25 face-down payoffs', () => {
    expect(table.outlookDeck).toHaveLength(4)
    expect(table.outlookOut).toHaveLength(6)
    expect(table.totalRounds).toBe(4)
    const three = initialState(lobby(4, { threeRounds: true }), createRandom('x')).game
    expect(three.outlookDeck).toHaveLength(3)
    expect(three.totalRounds).toBe(3)
    expect(table.payoffDeck).toHaveLength(25)
    for (const industry of ['FIN', 'TECH', 'HEAVY', 'ENERGY', 'MINING']) expect(table.payoffDeck.filter((c) => c === industry)).toHaveLength(5)
    expect(table.payoffDiscard).toEqual([])
  })

  it('R-SET-06: locks the bottom 3 India squares and bottom 2 China squares', () => {
    expect(table.countries.INDIA.squares.map((s) => s.occupant === 'LOCK')).toEqual([false, false, true, true, true])
    expect(table.countries.CHINA.squares.map((s) => s.occupant === 'LOCK')).toEqual([false, false, false, false, false, true, true])
  })

  it('R-SET-07/10: the bank holds the rest of the 30 shares; corporations start with their shares, cubes and cash', () => {
    const held = Object.values(table.players).reduce((sum, p) => sum + Object.values(p.shares).reduce((a, b) => a + b, 0), 0)
    expect(Object.values(table.bank).reduce((a, b) => a + b, 0)).toBe(30 - held)
    for (const [id, p] of Object.entries(table.players)) {
      const onBoard = Object.values(table.countries).reduce((sum, c) => sum + c.squares.filter((s) => s.occupant === id).length, 0)
      expect(onBoard).toBeGreaterThan(0)
      expect(p.cash).toBe(25)
      expect(p.bonds).toBe(0)
    }
  })

  it('R-SET-08/09: corporations at random, play order FD, Giant Squid, Big Brother, Old Money', () => {
    expect(table.seatOrder.map((id) => table.players[id].corp)).toEqual(['FORTRESS_DERIVATIVES', 'GIANT_SQUID', 'BIG_BROTHER', 'OLD_MONEY'])
    const two = initialState(lobby(2), createRandom('two')).game
    expect(two.seatOrder).toHaveLength(2)
    const order = ['FORTRESS_DERIVATIVES', 'GIANT_SQUID', 'BIG_BROTHER', 'OLD_MONEY']
    const corps = two.seatOrder.map((id) => order.indexOf(two.players[id].corp))
    expect(corps[0]).toBeLessThan(corps[1])
  })

  it('starts the battlegrounds on the four starting battleground countries', () => {
    expect(table.battlegrounds).toEqual({ AMERICA: 'SOUTH_AMERICA', EUROPE: 'EASTERN_EUROPE', ASIA: 'SOUTH_SEA', THIRD_WORLD: 'IRAN' })
  })
})

describe('the phase machine (R-TURN)', () => {
  it('genesis plays the first Outlook card and waits on the first decision', () => {
    const s = newGame()
    expect(s.status).toBe('active')
    expect(s.turn).toBe(1)
    expect(s.game.outlookPlayed).toHaveLength(1)
    expect(s.pendingPlayerIds).toHaveLength(1)
  })

  it('the first investment turn goes to Fortress Derivatives', () => {
    const s = autoplay(newGame(), (x) => x.game.phase === 'investment')
    expect(s.game.prompt).toEqual({ kind: 'investTurn', playerId: corpPlayer(s, 'FORTRESS_DERIVATIVES') })
    expect(s.activePlayerId).toBe(corpPlayer(s, 'FORTRESS_DERIVATIVES'))
  })

  it('with every player passing, ends after 4 turns', () => {
    const s = autoplay(newGame())
    expect(s.status).toBe('completed')
    expect(s.game.round).toBe(4)
    expect(s.game.outlookPlayed).toHaveLength(4)
    expect(s.game.phase).toBe('ended')
    expect(s.pendingPlayerIds).toEqual([])
    expect(s.winnerPlayerIds.length).toBeGreaterThan(0)
  })

  it('with THREE_ROUNDS, ends after 3 turns', () => {
    const s = autoplay(newGame({ options: { threeRounds: true } }))
    expect(s.status).toBe('completed')
    expect(s.game.round).toBe(3)
  })

  it('runs the phases in order and returns executives after each (R-TURN-01/02)', () => {
    let s = autoplay(newGame(), (x) => x.game.phase === 'investment')
    const phases: string[] = [s.game.phase]
    for (let i = 0; i < 200 && s.game.round === 1; i++) {
      const before = s.game.phase
      s = autoplay(s, (x) => x.game.phase !== before || x.game.round !== 1)
      if (s.game.round !== 1) break
      phases.push(s.game.phase)
      for (const p of Object.values(s.game.players)) {
        // Executives are all back in the pool when a new phase starts.
        if (s.game.phase === 'competition' || s.game.phase === 'lobbying') expect(p.executives).toBe(p.executiveCount)
      }
    }
    expect(phases).toEqual(['investment', 'competition', 'lobbying', 'earnings'])
  })

  it('investment ends when every pool is empty', () => {
    let s = autoplay(newGame(), (x) => x.game.phase === 'investment')
    const turns = Object.values(s.game.players).reduce((sum, p) => sum + p.executives, 0)
    for (let i = 0; i < turns; i++) {
      expect(s.game.phase).toBe('investment')
      s = play(s, { type: 'INVEST_PASS', playerId: s.activePlayerId! })
    }
    expect(s.game.phase).toBe('competition')
  })
})

// Rules tests, one describe per RULES.md section. Default table: 3 players
// (p1 Alice, p2 Bob, p3 Carol), 1 000 chips, blinds 10/20 — so hand 1 has p1
// on the button, p2 in the small blind and p3 in the big blind, and p1 acts
// first.

import { describe, expect, it } from 'vitest'
import { applyAction, type GameState as PlatformState } from '@game-platform/sdk'
import { amountToCall, blindsFor, canRaise, DEFAULT_GAME_OPTIONS, gameDefinition, normalizeGameOptions, type GameState } from '../rules'
import { arrange, move, newGame, play, stacked, usedCards } from '../testing'
import type { GameAction, PlayerId } from '../types'

function rejected(state: GameState, action: GameAction): string {
  const result = applyAction(state as PlatformState, action, { random: () => 1 })
  if (result.ok) throw new Error(`${action.type} was accepted`)
  return result.error
}

function concede(state: GameState, playerId: PlayerId): GameState {
  const result = applyAction(state as PlatformState, { type: 'CONCEDE', playerId }, { random: () => 1 })
  if (!result.ok) throw new Error(result.error)
  return result.state as GameState
}

/** The river, with the given cards and chips, ready for its betting round. Players not in `holes` have folded. */
function river(
  state: GameState,
  spec: { board: string; holes: Record<PlayerId, string>; contributed: Record<PlayerId, number>; stacks: Record<PlayerId, number> },
): GameState {
  return arrange(state, (g) => {
    g.step = 'river'
    g.board = spec.board.split(' ')
    for (const id of g.seatOrder) {
      const p = g.players[id]
      p.hole = spec.holes[id]?.split(' ') ?? []
      p.status = spec.holes[id] ? 'in' : 'folded'
      p.contributed = spec.contributed[id] ?? 0
      p.stack = spec.stacks[id] ?? p.stack
      p.committed = 0
      p.actedAt = null
    }
    g.currentBet = 0
    g.lastFullBet = 0
    g.minRaise = g.blinds.big
    g.toActId = g.seatOrder.find((id, i) => i > 0 && g.players[id].status === 'in' && g.players[id].stack > 0) ?? g.seatOrder[0]
  })
}

/** Everyone to act checks until the hand (or the game) moves on. */
function checkAround(state: GameState): GameState {
  const hand = state.game.hand
  let s = state
  while (s.status === 'active' && s.game.hand === hand) s = move(s, 'CHECK')
  return s
}

describe('setup (§1)', () => {
  it('R-SETUP-01/03: everyone starts with the stack; the first seat has the button', () => {
    const s = newGame()
    expect(s.game.buttonId).toBe('p1')
    expect(s.game.hand).toBe(1)
    expect(s.turn).toBe(1)
    expect(s.phase).toBe('preflop')
    expect(s.game.players.p1).toMatchObject({ stack: 1000, committed: 0, status: 'in' })
  })

  it('R-HAND-01: deals two cards to each player, one at a time from after the button', () => {
    const s = newGame({ deal: ['Ah', 'Kh', 'Qh', 'Ad', 'Kd', 'Qd'] })
    expect(s.game.players.p2.hole).toEqual(['Ah', 'Ad'])
    expect(s.game.players.p3.hole).toEqual(['Kh', 'Kd'])
    expect(s.game.players.p1.hole).toEqual(['Qh', 'Qd'])
    expect(s.setupRandom).toHaveLength(6)
  })

  it('R-SETUP-02: never deals the same card twice', () => {
    const s = newGame({ players: 9, seed: 42 })
    const cards = s.game.seatOrder.flatMap((id) => s.game.players[id].hole)
    expect(new Set(cards).size).toBe(18)
  })
})

describe('blinds (§2)', () => {
  it('R-BLIND-02: the two players after the button post the blinds, and the next acts first', () => {
    const s = newGame()
    expect(s.game.smallBlindId).toBe('p2')
    expect(s.game.bigBlindId).toBe('p3')
    expect(s.game.players.p2).toMatchObject({ stack: 990, committed: 10 })
    expect(s.game.players.p3).toMatchObject({ stack: 980, committed: 20 })
    expect(s.pendingPlayerIds).toEqual(['p1'])
    expect(s.activePlayerId).toBe('p1')
  })

  it('R-BLIND-02 / R-HAND-03: heads-up, the button posts the small blind, acts first pre-flop and last after', () => {
    let s = newGame({ players: 2 })
    expect(s.game.smallBlindId).toBe('p1')
    expect(s.game.bigBlindId).toBe('p2')
    expect(s.game.toActId).toBe('p1')
    s = move(s, 'CALL')
    s = move(s, 'CHECK')
    expect(s.phase).toBe('flop')
    expect(s.game.toActId).toBe('p2')
  })

  it('R-BLIND-01: doubles the big blind every blindsDoubleEvery hands, or never', () => {
    expect(blindsFor(DEFAULT_GAME_OPTIONS, 10)).toEqual({ small: 10, big: 20 })
    expect(blindsFor(DEFAULT_GAME_OPTIONS, 11)).toEqual({ small: 20, big: 40 })
    expect(blindsFor(DEFAULT_GAME_OPTIONS, 21)).toEqual({ small: 40, big: 80 })
    expect(blindsFor({ ...DEFAULT_GAME_OPTIONS, blindsDoubleEvery: 0 }, 500)).toEqual({ small: 10, big: 20 })
  })

  it('R-BLIND-01/04: the next hand moves the button and the blinds, at the new level', () => {
    let s = newGame({ options: { blindsDoubleEvery: 1 } })
    s = move(s, 'FOLD')
    const before = s
    s = move(s, 'FOLD')
    expect(s.game.hand).toBe(2)
    expect(s.turn).toBe(2)
    expect(s.game.blinds).toEqual({ small: 20, big: 40 })
    expect([s.game.buttonId, s.game.smallBlindId, s.game.bigBlindId]).toEqual(['p2', 'p3', 'p1'])
    expect(s.game.toActId).toBe('p2')
    const lines = gameDefinition.describeAction({ type: 'FOLD', playerId: 'p2' }, before, s).extraLines!.map((l) => l.message)
    expect(lines).toContain('Hand 2: Bob has the button; blinds 20/40 (blinds up).')
  })

  it('R-BLIND-03 / R-BET-05: a short big blind is all in, and callers still owe the full big blind', () => {
    let s = arrange(newGame(), (g) => {
      g.players.p3 = { ...g.players.p3, stack: 0, committed: 5, contributed: 5 }
    })
    expect(amountToCall(s.game, 'p1')).toBe(20)
    s = move(s, 'CALL')
    expect(amountToCall(s.game, 'p2')).toBe(10)
    s = move(s, 'CALL')
    // The big blind is all in and both callers matched: on to the flop.
    expect(s.phase).toBe('flop')
    expect(s.game.toActId).toBe('p2')
  })

  it('R-BLIND-03: blinds bigger than the stacks put everyone all in, and the board runs out', () => {
    const s = newGame({ players: 2, options: { startingStack: 100, bigBlind: 300 } })
    // p1 posted 100 of a 150 small blind, p2 100 of the 300 big blind — both all in at genesis.
    expect(s.game.lastHand).toMatchObject({ hand: 1, showdown: true })
    expect(s.game.lastHand?.board).toHaveLength(5)
    expect(s.game.lastHand?.pots.reduce((n, p) => n + p.amount, 0)).toBe(200)
  })
})

describe('a hand (§3)', () => {
  it('R-HAND-02/03: streets deal 3, 1 and 1 board cards; the first player after the button opens each', () => {
    let s = newGame()
    s = move(s, 'CALL')
    s = move(s, 'CALL')
    const before = s
    s = move(s, 'CHECK')
    expect(s.phase).toBe('flop')
    expect(s.game.board).toHaveLength(3)
    expect(s.game.toActId).toBe('p2')
    expect(s.game.currentBet).toBe(0)
    const flop = gameDefinition.describeAction({ type: 'CHECK', playerId: 'p3' }, before, s)
    expect(flop.message).toBe('{player} checks.')
    expect(flop.extraLines?.[0].message).toMatch(/^Flop: \S+ \S+ \S+\.$/)
    s = move(move(move(s, 'CHECK'), 'CHECK'), 'CHECK')
    expect(s.phase).toBe('turn')
    expect(s.game.board).toHaveLength(4)
    s = move(move(move(s, 'CHECK'), 'CHECK'), 'CHECK')
    expect(s.phase).toBe('river')
    expect(s.game.board).toHaveLength(5)
    s = checkAround(s)
    expect(s.game.lastHand?.showdown).toBe(true)
    expect(s.game.hand).toBe(2)
  })

  it('R-HAND-04 / R-POT-01: when everyone folds, the last player wins uncontested and their uncalled bet comes back', () => {
    let s = newGame()
    s = move(s, 'FOLD')
    s = move(s, 'FOLD')
    expect(s.game.lastHand).toMatchObject({ hand: 1, showdown: false, shown: {}, won: { p3: 20 }, returned: { playerId: 'p3', amount: 10 } })
    // 980 behind + 10 returned + the 20 pot, then 10 posted as hand 2's small blind.
    expect(s.game.players.p3.stack).toBe(1000)
    expect(s.game.players.p3.committed).toBe(10)
  })

  it('R-HAND-05 / R-BET-07: once everyone else is all in, nobody may raise and the board runs out', () => {
    let s = newGame({ players: 2 })
    s = move(s, 'BET', 1000)
    expect(canRaise(s.game, 'p2')).toBe(false)
    expect(rejected(s, { type: 'BET', playerId: 'p2', amount: 1000 })).toBe('Everyone else is all in — call or fold.')
    s = move(s, 'CALL')
    expect(s.game.lastHand?.showdown).toBe(true)
    expect(s.game.lastHand?.board).toHaveLength(5)
  })
})

describe('betting (§4)', () => {
  it('R-BET-01: rejects moves out of turn, a check facing a bet, and a fold when checking is free', () => {
    let s = newGame()
    expect(rejected(s, { type: 'CALL', playerId: 'p2' })).toBe("It isn't your turn.")
    expect(rejected(s, { type: 'CHECK', playerId: 'p1' })).toBe('20 to call — call, raise or fold.')
    s = move(move(s, 'CALL'), 'CALL')
    // AMBIG-4.
    expect(rejected(s, { type: 'FOLD', playerId: 'p3' })).toBe('Nothing to call — check instead.')
    expect(rejected(s, { type: 'CALL', playerId: 'p3' })).toBe('Nothing to call — check instead.')
  })

  it('R-BET-02/03: a raise is at least the last raise, at most the stack, in whole chips', () => {
    let s = newGame()
    expect(rejected(s, { type: 'BET', playerId: 'p1', amount: 39 })).toBe('The smallest raise is to 40, or all in for 1,000.')
    expect(rejected(s, { type: 'BET', playerId: 'p1', amount: 1001 })).toBe('You can raise at most 1,000 (all in).')
    expect(rejected(s, { type: 'BET', playerId: 'p1', amount: 20 })).toBe('Raise to more than 20.')
    expect(rejected(s, { type: 'BET', playerId: 'p1', amount: 50.5 })).toBe('Bet a whole number of chips.')
    s = move(s, 'BET', 40)
    expect(s.game).toMatchObject({ currentBet: 40, minRaise: 20, lastFullBet: 40 })
    s = move(s, 'BET', 70)
    expect(s.game).toMatchObject({ currentBet: 70, minRaise: 30 })
    expect(rejected(s, { type: 'BET', playerId: 'p3', amount: 99 })).toBe('The smallest raise is to 100, or all in for 1,000.')
    s = move(s, 'BET', 100)
    expect(s.game.players.p3).toMatchObject({ stack: 900, committed: 100 })
  })

  it('R-BET-03: after the flop the smallest bet is the big blind', () => {
    let s = move(move(move(newGame(), 'CALL'), 'CALL'), 'CHECK')
    expect(rejected(s, { type: 'BET', playerId: 'p2', amount: 19 })).toBe('The smallest bet is to 20, or all in for 980.')
    s = move(s, 'BET', 20)
    expect(s.game.toActId).toBe('p3')
    const line = gameDefinition.describeAction({ type: 'BET', playerId: 'p2', amount: 20 }, move(move(move(newGame(), 'CALL'), 'CALL'), 'CHECK'), s)
    expect(line.message).toBe('{player} bets 20.')
  })

  it('R-BET-04: an all-in smaller than the minimum is allowed', () => {
    let s = arrange(newGame(), (g) => {
      g.players.p1.stack = 30
    })
    s = move(s, 'BET', 30)
    expect(s.game).toMatchObject({ currentBet: 30, lastFullBet: 20, minRaise: 20 })
  })

  it('R-BET-04: an incomplete all-in raise does not reopen the betting for those who already acted', () => {
    let s = arrange(newGame(), (g) => {
      g.players.p2.stack = 140
    })
    s = move(s, 'BET', 100)
    s = move(s, 'BET', 150) // Bob all in: +50, short of the 80 a full raise needs.
    expect(s.game).toMatchObject({ currentBet: 150, lastFullBet: 100, minRaise: 80 })
    // Carol hasn't acted yet, so she may still raise.
    expect(canRaise(s.game, 'p3')).toBe(true)
    s = move(s, 'CALL')
    expect(s.game.toActId).toBe('p1')
    expect(canRaise(s.game, 'p1')).toBe(false)
    expect(rejected(s, { type: 'BET', playerId: 'p1', amount: 400 })).toBe('Only an all-in smaller than a full raise came since you acted, so you may only call or fold.')
    expect(amountToCall(s.game, 'p1')).toBe(50)
    s = move(s, 'CALL')
    expect(s.phase).toBe('flop')
  })

  it('R-BET-04: a full raise reopens it', () => {
    let s = move(newGame(), 'BET', 60)
    s = move(s, 'CALL')
    s = move(s, 'BET', 200)
    expect(s.game.toActId).toBe('p1')
    expect(canRaise(s.game, 'p1')).toBe(true)
  })

  it('R-BET-05: the big blind may check or raise when nobody raised', () => {
    let s = move(move(newGame(), 'CALL'), 'CALL')
    expect(s.game.toActId).toBe('p3')
    expect(amountToCall(s.game, 'p3')).toBe(0)
    expect(canRaise(s.game, 'p3')).toBe(true)
    s = move(s, 'BET', 60)
    expect(s.phase).toBe('preflop')
    expect(s.game.toActId).toBe('p1')
  })

  it('narrates calls and all-ins', () => {
    const s = arrange(newGame(), (g) => {
      g.players.p1.stack = 15
    })
    expect(gameDefinition.describeAction({ type: 'CALL', playerId: 'p1' }, s, move(s, 'CALL')).message).toBe('{player} calls 15 and is all in.')
    const t = newGame()
    expect(gameDefinition.describeAction({ type: 'BET', playerId: 'p1', amount: 1000 }, t, move(t, 'BET', 1000)).message).toBe('{player} raises to 1,000 and is all in.')
  })
})

describe('pots and the showdown (§5, R-SHOW-01)', () => {
  it('R-POT-02: builds a side pot above a short all-in, and the best hand in each takes it', () => {
    let s = river(newGame(), {
      board: '2c 7d 9h Js 3c',
      holes: { p1: 'As Ad', p2: 'Ks Kd', p3: 'Qs Qd' },
      contributed: { p1: 100, p2: 300, p3: 300 },
      stacks: { p1: 0, p2: 100, p3: 700 },
    })
    expect(s.game.toActId).toBe('p2')
    const before = move(s, 'CHECK')
    s = move(before, 'CHECK')
    expect(s.game.lastHand?.pots).toEqual([
      { amount: 300, eligible: ['p1', 'p2', 'p3'], winners: ['p1'], handName: 'a pair of Aces' },
      { amount: 400, eligible: ['p2', 'p3'], winners: ['p2'], handName: 'a pair of Kings' },
    ])
    expect(s.game.lastHand?.won).toEqual({ p1: 300, p2: 400 })
    expect(Object.keys(s.game.lastHand!.shown).sort()).toEqual(['p1', 'p2', 'p3'])
    expect(s.game.lastHand?.shown.p3).toEqual({ hole: ['Qs', 'Qd'], best: ['Qs', 'Qd', 'Js', '9h', '7d'], handName: 'a pair of Queens' })
    const lines = gameDefinition.describeAction({ type: 'CHECK', playerId: 'p3' }, before, s).extraLines!.map((l) => l.message)
    expect(lines).toEqual(
      expect.arrayContaining([
        'Alice shows A♠ A♦ — a pair of Aces.',
        'Alice wins the main pot (300) with a pair of Aces.',
        'Bob wins side pot 1 (400) with a pair of Kings.',
      ]),
    )
  })

  it('R-POT-03: ties split the pot, odd chip to the first winner after the button', () => {
    let s = river(newGame(), {
      board: 'As Ks Qs Js 2d',
      holes: { p1: 'Td 3c', p2: 'Th 4c', p3: '5c 6c' },
      contributed: { p1: 41, p2: 41, p3: 41 },
      stacks: { p1: 959, p2: 959, p3: 959 },
    })
    s = checkAround(s)
    expect(s.game.lastHand?.pots).toEqual([{ amount: 123, eligible: ['p1', 'p2', 'p3'], winners: ['p2', 'p1'], handName: 'a straight, Ace high' }])
    expect(s.game.lastHand?.won).toEqual({ p2: 62, p1: 61 })
  })

  it('R-POT-01 / R-HAND-04: an uncalled river bet comes back, and nobody shows', () => {
    let s = river(newGame(), {
      board: 'As Ks Qs Js 2d',
      holes: { p1: 'Td 3c', p2: 'Th 4c', p3: '5c 6c' },
      contributed: { p1: 41, p2: 41, p3: 41 },
      stacks: { p1: 959, p2: 959, p3: 959 },
    })
    s = move(s, 'BET', 959)
    s = move(s, 'FOLD')
    s = move(s, 'FOLD')
    expect(s.game.lastHand).toMatchObject({ showdown: false, shown: {}, won: { p2: 123 }, returned: { playerId: 'p2', amount: 959 } })
  })

  it('folded players can only feed a pot, never win it', () => {
    const s = checkAround(
      river(newGame(), {
        board: '2c 7d 9h Js 3c',
        holes: { p2: '4s 5d', p3: '8s 8d' },
        contributed: { p1: 200, p2: 200, p3: 200 },
        stacks: { p1: 800, p2: 800, p3: 800 },
      }),
    )
    expect(s.game.lastHand?.pots).toEqual([{ amount: 600, eligible: ['p2', 'p3'], winners: ['p3'], handName: 'a pair of Eights' }])
    expect(s.game.lastHand?.shown.p1).toBeUndefined()
  })
})

describe('busting out and the end (§7)', () => {
  it('R-END-01/02: heads-up, losing an all-in ends the game', () => {
    let s = newGame({ players: 2, deal: ['7c', 'Ah', '2d', 'As'] })
    s = move(s, 'BET', 1000)
    s = play(s, { type: 'CALL', playerId: 'p2' }, stacked(['3h', '8s', '9d', 'Kc', '4c'], usedCards(s.game)))
    expect(s.status).toBe('completed')
    expect(s.winnerPlayerIds).toEqual(['p1'])
    expect(s.pendingPlayerIds).toEqual([])
    expect(s.game).toMatchObject({ step: 'ended', endReason: 'lastStanding', toActId: null })
    expect(s.game.lastHand?.busted).toEqual(['p2'])
    expect(s.players.find((p) => p.id === 'p2')).toMatchObject({ eliminated: true })
    expect(s.game.players.p1.stack).toBe(2000)
  })

  it('R-END-01 / R-BLIND-04: a busted player is out; the button and blinds go round the rest', () => {
    let s = newGame({ deal: ['Kc', '7c', 'Ah', 'Kd', '2d', 'As'] })
    s = move(s, 'BET', 1000)
    s = move(s, 'FOLD')
    s = play(s, { type: 'CALL', playerId: 'p3' }, stacked(['3h', '8s', '9d', 'Jc', '4c'], usedCards(s.game)))
    expect(s.status).toBe('active')
    expect(s.game.lastHand?.won).toEqual({ p1: 2010 })
    expect(s.game.players.p3.bustedInHand).toBe(1)
    expect(s.players.find((p) => p.id === 'p3')?.eliminated).toBe(true)
    expect(s.turnOrder).toEqual(['p1', 'p2'])
    // Hand 2 is heads-up: the button (Bob) posts the small blind.
    expect([s.game.buttonId, s.game.smallBlindId, s.game.bigBlindId]).toEqual(['p2', 'p2', 'p1'])
    expect(s.game.players.p3).toMatchObject({ status: 'out', hole: [] })
    expect(s.pendingPlayerIds).toEqual(['p2'])
  })

  it('R-END-03: the hand limit ends the game on chips', () => {
    let s = newGame({ options: { maxHands: 1 } })
    s = move(move(s, 'FOLD'), 'FOLD')
    expect(s.status).toBe('completed')
    expect(s.game.endReason).toBe('handLimit')
    expect(s.game.hand).toBe(1)
    expect(s.winnerPlayerIds).toEqual(['p3'])
  })

  it('R-END-03: equal chips at the hand limit share the win', () => {
    const s = checkAround(
      river(newGame({ players: 2, options: { maxHands: 1 } }), {
        board: 'As Ks Qs Js Ts',
        holes: { p1: '2c 3c', p2: '2d 3d' },
        contributed: { p1: 20, p2: 20 },
        stacks: { p1: 980, p2: 980 },
      }),
    )
    expect(s.status).toBe('completed')
    expect(s.winnerPlayerIds).toEqual(['p1', 'p2'])
  })

  it('R-LEAVE-01: a player who concedes on their turn folds, and the next player acts', () => {
    const s = concede(newGame(), 'p1')
    expect(s.game.players.p1).toMatchObject({ status: 'folded', stack: 0 })
    expect(s.pendingPlayerIds).toEqual(['p2'])
  })

  it("R-LEAVE-01: a player who concedes out of turn leaves their bets in as dead money", () => {
    let s = concede(newGame(), 'p3')
    expect(s.pendingPlayerIds).toEqual(['p1'])
    s = move(s, 'FOLD')
    expect(s.game.lastHand).toMatchObject({ won: { p2: 30 }, returned: null })
    expect(s.game.players.p3).toMatchObject({ stack: 0, status: 'out' })
    // Heads-up now.
    expect([s.game.buttonId, s.game.bigBlindId]).toEqual(['p2', 'p1'])
  })

  it('R-LEAVE-01: a concession that leaves one player ends the game', () => {
    const s = concede(newGame({ players: 2 }), 'p2')
    expect(s.status).toBe('completed')
    expect(s.winnerPlayerIds).toEqual(['p1'])
  })
})

describe('hidden information', () => {
  it('R-HAND-01: each player sees only their own hole cards', () => {
    const s = newGame({ deal: ['Ah', 'Kh', 'Qh', 'Ad', 'Kd', 'Qd'] })
    const mine = gameDefinition.redactGame(s, 'p2')
    expect(mine.players.p2.hole).toEqual(['Ah', 'Ad'])
    expect(mine.players.p1.hole).toEqual([null, null])
    expect(mine.players.p3.hole).toEqual([null, null])
    const spectator = gameDefinition.redactGame(s, null)
    expect(s.game.seatOrder.every((id) => spectator.players[id].hole.every((c) => c === null))).toBe(true)
  })

  it('R-SHOW-01: showdown cards stay public in the last hand', () => {
    const s = checkAround(
      river(newGame(), {
        board: '2c 7d 9h Js 3c',
        holes: { p1: 'As Ad', p2: 'Ks Kd', p3: 'Qs Qd' },
        contributed: { p1: 100, p2: 100, p3: 100 },
        stacks: { p1: 900, p2: 900, p3: 900 },
      }),
    )
    expect(gameDefinition.redactGame(s, 'p2').lastHand?.shown.p1.hole).toEqual(['As', 'Ad'])
  })

  it('no action is ever secret', () => {
    const s = move(newGame(), 'CALL')
    expect(gameDefinition.isActionSecret(s.actionHistory[0], s, 'p2')).toBe(false)
  })
})

describe('options (§8)', () => {
  it('fills in and clamps anything', () => {
    expect(normalizeGameOptions(undefined)).toEqual(DEFAULT_GAME_OPTIONS)
    expect(normalizeGameOptions({ startingStack: 5, bigBlind: 25, blindsDoubleEvery: -3, maxHands: 1e9 })).toEqual({ startingStack: 100, bigBlind: 26, blindsDoubleEvery: 0, maxHands: 1000 })
    expect(normalizeGameOptions({ startingStack: 'lots', bigBlind: NaN })).toEqual(DEFAULT_GAME_OPTIONS)
  })

  it('describes them', () => {
    expect(gameDefinition.describeOptions(DEFAULT_GAME_OPTIONS)).toBe('1,000 chips · blinds 10/20 · doubling every 10 hands')
    expect(gameDefinition.describeOptions({ startingStack: 5000, bigBlind: 100, blindsDoubleEvery: 0, maxHands: 30 })).toBe('5,000 chips · blinds 50/100 · fixed · max 30 hands')
  })
})

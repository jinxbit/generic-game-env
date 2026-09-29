// Rules tests, one describe per RULES.md section. Positions are set up with
// `arrange` rather than played to, and each test asserts its precondition.

import { describe, expect, it } from 'vitest'
import { applyAction, type GameState as PlatformState, type LoggedAction } from '@game-platform/sdk'
import {
  AFTER_IN,
  assetsOf,
  brownDeck,
  fameValue,
  FAME_START,
  gameDefinition,
  greyDeck,
  LOAN,
  NOTE_COST,
  OUT_PENALTY,
  PILE_PRICES,
  STARTING_CASH,
  TOP_STEP,
  type GameState,
} from '../rules'
import { arrange, draws, face, fateDie, handOf, newGame, play, redDice } from '../testing'
import type { Card, GameAction, GameData } from '../types'

const might = (id: number): Card => ({ id, kind: 'might' })
const work = (id: number, artist: 'krach' | 'boyz' | 'kali' | 'hering' | 'lightenstone'): Card => ({ id, kind: 'work', artist })

function reject(state: GameState, action: GameAction): string {
  const result = applyAction(state as PlatformState, action, { random: () => 0 })
  if (result.ok) throw new Error(`${action.type} was accepted`)
  return result.error
}

/** A position where p1 is about to place `face`; p2 and p3 have agents on step 3, p1 on steps 1 and 3. */
function placing(edit: (g: GameData) => void = () => {}, fate: GameData['fate'] = 'wild'): GameState {
  return arrange(newGame(), (g) => {
    g.step = 'place'
    g.fate = fate
    g.players.p1.agents = [1, 3, null]
    g.players.p2.agents = [3, null, null]
    g.players.p3.agents = [3, null, null]
    edit(g)
  })
}

/** A position where p1 is in the play step with `hand`. */
function playing(hand: Card[], edit: (g: GameData) => void = () => {}): GameState {
  return arrange(newGame(), (g) => {
    g.step = 'play'
    g.players.p1.hand = hand
    edit(g)
  })
}

describe('§2 setup', () => {
  it('deals three cards each, seven piles of seven, and sets the rest aside', () => {
    const s = newGame({ players: 4 })
    const g = s.game
    for (const id of g.seatOrder) {
      expect(g.players[id].hand).toHaveLength(3)
      expect(handOf(s, id).every((c) => c.kind === 'work')).toBe(false) // R-SETUP-04
      expect(g.players[id]).toMatchObject({ cash: STARTING_CASH, notes: 0, agents: [1, 2, null], shown: [] })
    }
    expect(g.piles.map((p) => p.length)).toEqual([7, 7, 7, 7, 7, 7, 7])
    expect(g.aside).toHaveLength(brownDeck().length - 4 * 3 - 49)
    expect(g.greyDeck).toHaveLength(greyDeck().length)
    for (const a of Object.values(g.artists)) expect(a).toEqual({ step: 1, counters: [], fame: FAME_START, out: false })
    expect(fameValue(FAME_START)).toBe(100_000)
    expect(s.pendingPlayerIds).toEqual(['p1'])
    expect(s.phase).toBe('fate')
  })

  it('redraws a hand of three works (AMBIG-6), across many seeds', () => {
    for (let seed = 1; seed < 60; seed++) {
      const s = newGame({ players: 5, seed })
      for (const id of s.game.seatOrder) expect(handOf(s, id).some((c) => c.kind !== 'work')).toBe(true)
    }
  })
})

describe('§5 fate counters', () => {
  it('R-FATE-02: a minus face allows criticism or scandal only', () => {
    let s = arrange(newGame(), () => {})
    s = play(s, { type: 'ROLL_FATE', playerId: 'p1' }, fateDie('minus'))
    expect(s.game.fate).toBe('minus')
    expect(reject(s, { type: 'PLACE_COUNTER', playerId: 'p1', artist: 'boyz', kind: 'purchase', value: 1 })).toMatch(/criticism or scandal/)
  })

  it('R-FATE-03: with the rolled kind used up, any kind that is left may be taken', () => {
    const s = placing((g) => {
      g.pool.purchase = g.pool.purchase.map(() => 0)
    }, 'purchase')
    const next = play(s, { type: 'PLACE_COUNTER', playerId: 'p1', artist: 'boyz', kind: 'scandal', value: 2 })
    expect(next.game.artists.boyz.counters).toEqual([{ kind: 'scandal', value: 2 }])
  })

  it('R-FATE-04/06: nobody else has influence, so the counter takes effect at once on the next step', () => {
    const s = placing()
    expect(s.game.artists.boyz.step).toBe(1)
    const next = play(s, { type: 'PLACE_COUNTER', playerId: 'p1', artist: 'boyz', kind: 'purchase', value: 3 })
    expect(next.game.artists.boyz.counters).toEqual([{ kind: 'purchase', value: 3 }])
    expect(next.game.artists.boyz.fame).toBe(FAME_START + 3)
    expect(next.game.pool.purchase[2]).toBe(1)
    expect(next.game.step).toBe('buy')
  })

  it('rejects an artist the player has no influence over, and a value that is gone', () => {
    const s = placing((g) => {
      g.artists.kali.step = 5
      g.pool.scandal[5] = 0
    })
    expect(reject(s, { type: 'PLACE_COUNTER', playerId: 'p1', artist: 'kali', kind: 'purchase', value: 1 })).toMatch(/no influence/)
    expect(reject(s, { type: 'PLACE_COUNTER', playerId: 'p1', artist: 'boyz', kind: 'scandal', value: 6 })).toMatch(/No scandal counter/)
  })

  it('R-TURN-01: a player with no influence skips straight to buying', () => {
    let s = arrange(newGame(), (g) => {
      g.step = 'play'
      g.players.p2.agents = [9, null, null]
    })
    s = play(s, { type: 'END_TURN', playerId: 'p1' })
    expect(s.game.turnPlayerId).toBe('p2')
    expect(s.game.step).toBe('buy')
  })
})

describe('§6 objections and the Trial of Strength', () => {
  const disputed = () =>
    play(
      placing((g) => {
        g.artists.boyz.step = 3
      }),
      { type: 'PLACE_COUNTER', playerId: 'p1', artist: 'boyz', kind: 'scandal', value: 6 },
    )

  it('R-OBJ-01/02: the others with influence answer together; all accepting lets it stand', () => {
    let s = disputed()
    expect(s.game.step).toBe('objections')
    expect(s.pendingPlayerIds).toEqual(['p2', 'p3'])
    expect(s.activePlayerId).toBeNull()
    s = play(s, { type: 'RESPOND', playerId: 'p3', value: null })
    expect(s.pendingPlayerIds).toEqual(['p2'])
    s = play(s, { type: 'RESPOND', playerId: 'p2', value: null })
    expect(s.game.artists.boyz.fame).toBe(FAME_START - 6)
    expect(s.game.step).toBe('buy')
  })

  it('R-OBJ-01: a proposal must be another available value of the same kind', () => {
    const s = disputed()
    expect(reject(s, { type: 'RESPOND', playerId: 'p2', value: 6 })).toMatch(/another scandal value/)
    expect(reject(s, { type: 'RESPOND', playerId: 'p2', value: 9 })).toMatch(/another scandal value/)
    expect(reject(s, { type: 'RESPOND', playerId: 'p1', value: null })).toMatch(/no say/)
  })

  it('R-OBJ-03: agreeing to a proposal swaps the counter (the rulebook’s −6 for −3)', () => {
    let s = disputed()
    s = play(s, { type: 'RESPOND', playerId: 'p2', value: 3 })
    s = play(s, { type: 'RESPOND', playerId: 'p3', value: null })
    expect(s.game.step).toBe('negotiate')
    expect(s.pendingPlayerIds).toEqual(['p1'])
    expect(reject(s, { type: 'NEGOTIATE', playerId: 'p1', value: 2 })).toMatch(/proposed values/)
    s = play(s, { type: 'NEGOTIATE', playerId: 'p1', value: 3 })
    expect(s.game.artists.boyz.counters).toEqual([{ kind: 'scandal', value: 3 }])
    expect(s.game.artists.boyz.fame).toBe(FAME_START - 3)
    expect(s.game.pool.scandal[5]).toBe(2)
    expect(s.game.pool.scandal[2]).toBe(1)
  })

  it('R-OBJ-04: after a refusal only objectors decide; nobody challenging lets it stand', () => {
    let s = disputed()
    s = play(s, { type: 'RESPOND', playerId: 'p2', value: 3 })
    s = play(s, { type: 'RESPOND', playerId: 'p3', value: null })
    s = play(s, { type: 'NEGOTIATE', playerId: 'p1', value: null })
    expect(s.game.step).toBe('challenge')
    expect(s.pendingPlayerIds).toEqual(['p2'])
    s = play(s, { type: 'CHALLENGE', playerId: 'p2', challenge: false })
    expect(s.game.artists.boyz.counters).toEqual([{ kind: 'scandal', value: 6 }])
  })

  function toTrial(edit: (g: GameData) => void = () => {}): GameState {
    let s = play(
      placing((g) => {
        g.artists.boyz.step = 3
        g.players.p1.hand = [might(90), might(91)]
        g.players.p2.hand = [might(92), might(93), work(0, 'boyz')]
        g.players.p3.hand = []
        edit(g)
      }),
      { type: 'PLACE_COUNTER', playerId: 'p1', artist: 'boyz', kind: 'scandal', value: 6 },
    )
    s = play(s, { type: 'RESPOND', playerId: 'p2', value: 1 })
    s = play(s, { type: 'RESPOND', playerId: 'p3', value: 2 })
    s = play(s, { type: 'NEGOTIATE', playerId: 'p1', value: null })
    s = play(s, { type: 'CHALLENGE', playerId: 'p2', challenge: true })
    s = play(s, { type: 'CHALLENGE', playerId: 'p3', challenge: true })
    return s
  }

  it('R-TRIAL-01: contras commit first, the pro player always answers last', () => {
    let s = toTrial()
    expect(s.game.step).toBe('trial')
    expect(s.pendingPlayerIds).toEqual(['p2', 'p3'])
    expect(reject(s, { type: 'COMMIT_MIGHT', playerId: 'p2', count: 3 })).toMatch(/only 2 might/)
    s = play(s, { type: 'COMMIT_MIGHT', playerId: 'p2', count: 1 })
    s = play(s, { type: 'COMMIT_MIGHT', playerId: 'p3', count: 0 })
    expect(s.pendingPlayerIds).toEqual(['p1'])
    expect(handOf(s, 'p2')).toHaveLength(2)
    s = play(s, { type: 'COMMIT_MIGHT', playerId: 'p1', count: 1 })
    // The pro player added a card: the contras get another round.
    expect(s.game.trial!.round).toBe(2)
    expect(s.pendingPlayerIds).toEqual(['p2', 'p3'])
    s = play(s, { type: 'COMMIT_MIGHT', playerId: 'p2', count: 1 })
    s = play(s, { type: 'COMMIT_MIGHT', playerId: 'p3', count: 0 })
    expect(s.pendingPlayerIds).toEqual(['p1'])
    // The pro player adds nothing more: the dice decide. p2 rolls 1+1+2, p3 1+1, p1 6+6+1.
    s = play(s, { type: 'COMMIT_MIGHT', playerId: 'p1', count: 0 }, redDice(1, 1, 1, 1, 6, 6))
    expect(s.game.lastTrial).toMatchObject({ winner: 'pro', pro: 'p1' })
    // R-TRIAL-03: the counter stays; both contras lose their agent on step 3.
    expect(s.game.artists.boyz.counters).toEqual([{ kind: 'scandal', value: 6 }])
    expect(s.game.players.p2.agents).toEqual([null, null, null])
    expect(s.game.players.p3.agents).toEqual([null, null, null])
    // R-TRIAL-05: might cards go home.
    expect(handOf(s, 'p1').filter((c) => c.kind === 'might')).toHaveLength(2)
    expect(handOf(s, 'p2').filter((c) => c.kind === 'might')).toHaveLength(2)
  })

  it('R-TRIAL-04: the contra side wins — the counter is removed and the placer loses their agent', () => {
    let s = toTrial()
    s = play(s, { type: 'COMMIT_MIGHT', playerId: 'p2', count: 2 })
    s = play(s, { type: 'COMMIT_MIGHT', playerId: 'p3', count: 0 })
    s = play(s, { type: 'COMMIT_MIGHT', playerId: 'p1', count: 0 }, redDice(3, 3, 1, 1, 3, 3))
    expect(s.game.lastTrial!.winner).toBe('contra')
    expect(s.game.artists.boyz.counters).toEqual([])
    expect(s.game.artists.boyz.fame).toBe(FAME_START)
    expect(s.game.pool.scandal[5]).toBe(2)
    expect(s.game.players.p1.agents).toEqual([1, null, null])
    expect(s.game.players.p2.agents).toEqual([3, null, null])
    expect(s.game.step).toBe('buy')
  })

  it('R-TRIAL-02: a tie with the pro player is rolled again', () => {
    let s = toTrial()
    s = play(s, { type: 'COMMIT_MIGHT', playerId: 'p2', count: 0 })
    s = play(s, { type: 'COMMIT_MIGHT', playerId: 'p3', count: 0 })
    // p2 4+4, p3 1+1, p1 4+4: tie — p2 and p1 roll again, p2 1+1, p1 2+2.
    s = play(s, { type: 'COMMIT_MIGHT', playerId: 'p1', count: 0 }, redDice(4, 4, 1, 1, 4, 4, 1, 1, 2, 2))
    const rolls = Object.fromEntries(s.game.lastTrial!.rolls.map((r) => [r.playerId, r.dice]))
    expect(rolls).toEqual({ p2: [[4, 4], [1, 1]], p3: [[1, 1]], p1: [[4, 4], [2, 2]] })
    expect(s.game.lastTrial!.winner).toBe('pro')
  })

  it('R-TRIAL-06: under the variant a total of 14+ discards one committed might card', () => {
    let s = toTrial()
    s = { ...s, options: { mightVariant: true } }
    s = play(s, { type: 'COMMIT_MIGHT', playerId: 'p2', count: 2 })
    s = play(s, { type: 'COMMIT_MIGHT', playerId: 'p3', count: 0 })
    s = play(s, { type: 'COMMIT_MIGHT', playerId: 'p1', count: 0 }, redDice(6, 6, 1, 1, 1, 1))
    expect(s.game.lastTrial!.discarded).toEqual(['p2'])
    expect(handOf(s, 'p2').filter((c) => c.kind === 'might')).toHaveLength(1)
  })
})

describe('§7 effects: feather, Vernissage, IN and OUT', () => {
  it('R-CRITIC-03: the rulebook’s example — scandal −6 on a feathered artist moves 11', () => {
    const s = placing((g) => {
      g.feather = 'boyz'
    })
    const next = play(s, { type: 'PLACE_COUNTER', playerId: 'p1', artist: 'boyz', kind: 'scandal', value: 6 })
    expect(next.game.artists.boyz.fame).toBe(FAME_START - 11)
  })

  it('R-VERN-01/02: all three kinds make the artist jump; first place is a Great Vernissage (+12)', () => {
    const s = placing((g) => {
      g.artists.boyz.counters = [
        { kind: 'purchase', value: 1 },
        { kind: 'criticism', value: 1 },
      ]
      g.pool.purchase[0] = 1
      g.pool.criticism[0] = 1
      g.artists.boyz.fame = 5
    })
    const next = play(s, { type: 'PLACE_COUNTER', playerId: 'p1', artist: 'boyz', kind: 'scandal', value: 1 })
    expect(next.game.artists.boyz).toMatchObject({ step: 5, counters: [], fame: 5 - 1 + 12 })
    expect(next.game.pool.purchase[0]).toBe(2)
    expect(next.game.pool.scandal[0]).toBe(2)
  })

  it('R-VERN-02: second place is a Small Vernissage (+6); lower places get nothing', () => {
    const base = (other: number) =>
      placing((g) => {
        g.artists.kali.step = other
        g.artists.hering.step = 7
        g.artists.boyz.counters = [
          { kind: 'purchase', value: 1 },
          { kind: 'criticism', value: 1 },
        ]
        g.pool.purchase[0] = 1
        g.pool.criticism[0] = 1
        g.artists.boyz.fame = 5
      })
    const place: GameAction = { type: 'PLACE_COUNTER', playerId: 'p1', artist: 'boyz', kind: 'scandal', value: 1 }
    expect(play(base(1), place).game.artists.boyz.fame).toBe(4 + 6)
    expect(play(base(6), place).game.artists.boyz.fame).toBe(4)
  })

  it('R-VERN-03: a feathered artist jumps but earns no bonus', () => {
    const s = placing((g) => {
      g.feather = 'boyz'
      g.artists.boyz.counters = [
        { kind: 'purchase', value: 1 },
        { kind: 'criticism', value: 1 },
      ]
      g.pool.purchase[0] = 1
      g.pool.criticism[0] = 1
      g.artists.boyz.fame = 10
    })
    const next = play(s, { type: 'PLACE_COUNTER', playerId: 'p1', artist: 'boyz', kind: 'scandal', value: 1 })
    expect(next.game.artists.boyz).toMatchObject({ step: 5, fame: 10 - 1 - 5 })
  })

  it('R-IN-01..03: an artist IN asks everyone, pays shown works and resets the marker', () => {
    let s = placing((g) => {
      g.artists.boyz.fame = 20
      g.players.p1.hand = [work(0, 'boyz'), work(1, 'boyz')]
      g.players.p2.hand = [work(2, 'boyz')]
      g.players.p3.shown = [work(3, 'boyz')]
    })
    s = play(s, { type: 'PLACE_COUNTER', playerId: 'p1', artist: 'boyz', kind: 'purchase', value: 5 })
    expect(s.game.step).toBe('display')
    expect(s.pendingPlayerIds).toEqual(['p1', 'p2', 'p3'])
    expect(s.game.display!.values).toEqual([fameValue(25)])
    expect(s.game.artists.boyz.fame).toBe(AFTER_IN)
    s = play(s, { type: 'DISPLAY', playerId: 'p1', count: 2 })
    s = play(s, { type: 'DISPLAY', playerId: 'p2', count: 0 })
    expect(reject(s, { type: 'DISPLAY', playerId: 'p3', count: 1 })).toMatch(/only 0 hidden/)
    s = play(s, { type: 'DISPLAY', playerId: 'p3', count: 0 })
    expect(s.game.players.p1.cash).toBe(STARTING_CASH + 2 * fameValue(25))
    expect(s.game.players.p2.cash).toBe(STARTING_CASH)
    expect(s.game.players.p3.cash).toBe(STARTING_CASH + fameValue(25))
    expect(s.game.players.p1.shown).toHaveLength(2)
    expect(s.game.step).toBe('buy')
  })

  it('R-OUT-01/03: an artist OUT leaves; the second one OUT ends the game', () => {
    let s = placing((g) => {
      g.artists.kali.out = true
      g.artists.kali.fame = 0
      g.artists.boyz.fame = 4
      g.artists.boyz.counters = [{ kind: 'purchase', value: 1 }]
      g.pool.purchase[0] = 1
      g.players.p1.hand = [work(0, 'boyz'), work(1, 'krach')]
    })
    s = play(s, { type: 'PLACE_COUNTER', playerId: 'p1', artist: 'boyz', kind: 'criticism', value: 5 })
    expect(s.game.artists.boyz).toMatchObject({ out: true, fame: 0, counters: [] })
    expect(s.game.pool.purchase[0]).toBe(2)
    expect(s.status).toBe('completed')
    expect(s.game.endReason).toBe('twoOut')
    // R-END-02: −100 000 for the OUT artist's work, the krach work at today's fame.
    expect(s.game.finalAssets!.p1).toBe(STARTING_CASH - OUT_PENALTY + fameValue(FAME_START))
  })
})

describe('§8 buying', () => {
  const buying = (edit: (g: GameData) => void = () => {}) =>
    arrange(newGame(), (g) => {
      g.step = 'buy'
      edit(g)
    })

  it('R-BUY-02: a pile is paid for, seen, and one card (or none) taken', () => {
    let s = buying()
    s = play(s, { type: 'BUY_PILE', playerId: 'p1', pile: 3 })
    expect(s.game.players.p1.cash).toBe(STARTING_CASH - PILE_PRICES[3])
    expect(s.game.step).toBe('choose')
    const card = s.game.piles[3][2]!
    expect(reject(s, { type: 'TAKE_CARD', playerId: 'p1', cardId: 999 })).toMatch(/not in the pile/)
    s = play(s, { type: 'TAKE_CARD', playerId: 'p1', cardId: card.id })
    expect(s.game.piles[3]).toHaveLength(6)
    expect(handOf(s, 'p1')).toContainEqual(card)
    expect(s.game.step).toBe('play')
  })

  it('R-BUY-04: short of cash, the player borrows against a promissory note', () => {
    let s = buying((g) => {
      g.players.p1.cash = 5_000
    })
    s = play(s, { type: 'BUY_PILE', playerId: 'p1', pile: 6 })
    expect(s.game.players.p1).toMatchObject({ cash: 5_000 + LOAN - PILE_PRICES[6], notes: 1 })
    const debtFree = { ...s.game, players: { ...s.game.players, p1: { ...s.game.players.p1, notes: 0 } } }
    expect(assetsOf(s.game, 'p1')).toBe(assetsOf(debtFree, 'p1') - NOTE_COST)
  })

  it('R-BUY-03: an empty grey deck is refilled from the discard', () => {
    let s = buying((g) => {
      g.greyDiscard = g.greyDeck.filter((c): c is Card => c !== null)
      g.greyDeck = []
    })
    s = play(s, { type: 'BUY_GREY', playerId: 'p1' })
    expect(s.game.greyDeck).toHaveLength(22)
    expect(s.game.greyDiscard).toEqual([])
    expect(handOf(s, 'p1').at(-1)!.kind).toBe('limited')
    expect(s.actionHistory.at(-1)!.random!.length).toBeGreaterThan(0)
  })

  it('R-BUY-05: with nothing to buy the step is skipped', () => {
    let s = arrange(newGame(), (g) => {
      g.step = 'play'
      g.piles = g.piles.map(() => [])
      g.greyDeck = []
      g.players.p2.agents = [9, null, null]
    })
    s = play(s, { type: 'END_TURN', playerId: 'p1' })
    expect(s.game.turnPlayerId).toBe('p2')
    expect(s.game.step).toBe('play')
  })
})

describe('§9 playing cards', () => {
  it('R-PLAY-02: an unlimited step change rearranges every agent, keeping them on the board', () => {
    const card: Card = { id: 80, kind: 'unlimited' }
    const s = playing([card, might(90)])
    expect(reject(s, { type: 'PLAY_UNLIMITED', playerId: 'p1', cardId: 80, agents: [null, 4, 5] })).toMatch(/stay on it/)
    expect(reject(s, { type: 'PLAY_UNLIMITED', playerId: 'p1', cardId: 80, agents: [4, 4, null] })).toMatch(/share a step/)
    const next = play(s, { type: 'PLAY_UNLIMITED', playerId: 'p1', cardId: 80, agents: [7, 4, 9] })
    expect(next.game.players.p1.agents).toEqual([7, 4, 9])
    expect(handOf(next, 'p1')).toEqual([might(90)])
    expect(reject(next, { type: 'PLAY_UNLIMITED', playerId: 'p1', cardId: 80, agents: [7, 4, 9] })).toMatch(/already played/)
  })

  it('R-PLAY-03: a limited step change moves one agent up to n steps, or brings one in no higher than n', () => {
    const card: Card = { id: 101, kind: 'limited', steps: 2 }
    const s = playing([card, might(90)])
    expect(reject(s, { type: 'PLAY_LIMITED', playerId: 'p1', cardId: 101, agent: 1, to: 5 })).toMatch(/1 to 2 steps/)
    expect(reject(s, { type: 'PLAY_LIMITED', playerId: 'p1', cardId: 101, agent: 2, to: 3 })).toMatch(/no higher than step 2/)
    expect(reject(s, { type: 'PLAY_LIMITED', playerId: 'p1', cardId: 101, agent: 2, to: 1 })).toMatch(/share a step/)
    const next = play(s, { type: 'PLAY_LIMITED', playerId: 'p1', cardId: 101, agent: 1, to: 4 })
    expect(next.game.players.p1.agents).toEqual([1, 4, null])
    expect(next.game.greyDiscard).toEqual([card])
  })

  it('R-CRITIC-01/02: a critic card moves the feather and costs 5 fame, ending the turn', () => {
    const card: Card = { id: 70, kind: 'critic' }
    let s = playing([card], (g) => {
      g.feather = 'kali'
    })
    const outOfReach = arrange(s, (g) => {
      g.players.p1.agents = [9, null, null]
    })
    expect(reject(outOfReach, { type: 'PLAY_CRITIC', playerId: 'p1', cardId: 70, artist: 'boyz' })).toMatch(/no influence/)
    s = play(s, { type: 'PLAY_CRITIC', playerId: 'p1', cardId: 70, artist: 'boyz' })
    expect(s.game.feather).toBe('boyz')
    expect(s.game.artists.boyz.fame).toBe(FAME_START - 5)
    expect(s.game.turnPlayerId).toBe('p2')
  })

  it('R-PLAY-01: a step change after a critic card is not possible — the critic ends the turn', () => {
    const s = playing([{ id: 70, kind: 'critic' }, { id: 80, kind: 'unlimited' }])
    const next = play(s, { type: 'PLAY_CRITIC', playerId: 'p1', cardId: 70, artist: 'boyz' })
    expect(next.game.turnPlayerId).toBe('p2')
  })
})

describe('§10 end of the game', () => {
  it('R-END-01: a counter that stays on the top step ends the game', () => {
    const s = placing((g) => {
      g.artists.boyz.step = TOP_STEP - 1
      g.players.p1.agents = [TOP_STEP - 1, null, null]
    })
    const next = play(s, { type: 'PLACE_COUNTER', playerId: 'p1', artist: 'boyz', kind: 'purchase', value: 1 })
    expect(next.status).toBe('completed')
    expect(next.game.endReason).toBe('topCounter')
    expect(next.pendingPlayerIds).toEqual([])
  })

  it('R-END-02/03: assets count cash, works at fame value, and notes; the richest wins', () => {
    const s = placing((g) => {
      g.artists.boyz.step = TOP_STEP - 1
      g.players.p1.agents = [TOP_STEP - 1, null, null]
      g.players.p1.hand = []
      g.players.p3.hand = []
      g.players.p2.hand = [work(0, 'kali'), work(1, 'kali')]
      g.players.p2.notes = 1
      g.players.p3.shown = [work(2, 'krach')]
    })
    const next = play(s, { type: 'PLACE_COUNTER', playerId: 'p1', artist: 'boyz', kind: 'purchase', value: 1 })
    expect(next.game.finalAssets).toEqual({
      p1: STARTING_CASH,
      p2: STARTING_CASH + 2 * fameValue(FAME_START) - NOTE_COST,
      p3: STARTING_CASH + fameValue(FAME_START),
    })
    expect(next.winnerPlayerIds).toEqual(['p3'])
  })
})

describe('hidden information', () => {
  it('hides other hands, face-down piles and decks; the buyer alone sees the pile they bought', () => {
    let s = arrange(newGame(), (g) => {
      g.step = 'buy'
    })
    s = play(s, { type: 'BUY_PILE', playerId: 'p1', pile: 0 })
    const forP1 = gameDefinition.redactGame(s, 'p1')
    const forP2 = gameDefinition.redactGame(s, 'p2')
    expect(forP1.piles[0].every((c) => c !== null)).toBe(true)
    expect(forP2.piles[0].every((c) => c === null)).toBe(true)
    expect(forP1.piles[1].every((c) => c === null)).toBe(true)
    expect(forP2.players.p1.hand.every((c) => c === null)).toBe(true)
    expect(forP2.players.p2.hand.every((c) => c !== null)).toBe(true)
    expect(forP2.greyDeck.every((c) => c === null)).toBe(true)
    expect(forP2.aside.every((c) => c === null)).toBe(true)
  })

  it('keeps TAKE_CARD secret from everyone but the taker, with a public redacted narration', () => {
    let s = arrange(newGame(), (g) => {
      g.step = 'buy'
    })
    s = play(s, { type: 'BUY_PILE', playerId: 'p1', pile: 0 })
    const before = s
    const action: GameAction = { type: 'TAKE_CARD', playerId: 'p1', cardId: s.game.piles[0][0]!.id }
    s = play(s, action)
    const entry = s.actionHistory.at(-1) as LoggedAction
    expect(gameDefinition.isActionSecret(entry, s, 'p2')).toBe(true)
    expect(gameDefinition.isActionSecret(entry, s, 'p1')).toBe(false)
    const described = gameDefinition.describeAction(action, before, s)
    expect(described.message).toMatch(/takes (a|an) .* from pile 1/)
    expect(described.redactedMessage).toMatch(/makes their choice from pile 1/)
  })
})

describe('§11 leaving the game', () => {
  it('R-LEAVE-02: the turn player leaving mid-dispute returns the counter and passes the turn', () => {
    let s = play(
      placing((g) => {
        g.artists.boyz.step = 3
      }),
      { type: 'PLACE_COUNTER', playerId: 'p1', artist: 'boyz', kind: 'scandal', value: 6 },
    )
    s = play(s, { type: 'CONCEDE', playerId: 'p1' } as unknown as GameAction)
    expect(s.game.dispute).toBeNull()
    expect(s.game.pool.scandal[5]).toBe(2)
    expect(s.game.turnPlayerId).toBe('p2')
    expect(s.game.players.p1.agents).toEqual([null, null, null])
  })

  it('R-LEAVE-01: an objector leaving is dropped from the answers', () => {
    let s = play(
      placing((g) => {
        g.artists.boyz.step = 3
      }),
      { type: 'PLACE_COUNTER', playerId: 'p1', artist: 'boyz', kind: 'scandal', value: 6 },
    )
    s = play(s, { type: 'RESPOND', playerId: 'p2', value: null })
    s = play(s, { type: 'CONCEDE', playerId: 'p3' } as unknown as GameAction)
    expect(s.game.artists.boyz.counters).toEqual([{ kind: 'scandal', value: 6 }])
    expect(s.game.step).toBe('buy')
  })
})

describe('fate die draws', () => {
  it('lands on each face', () => {
    for (const f of ['purchase', 'criticism', 'scandal', 'wild', 'minus'] as const) {
      const s = play(newGame(), { type: 'ROLL_FATE', playerId: 'p1' }, fateDie(f))
      expect(s.game.fate).toBe(f)
    }
    expect(face(0, 6)).toBeGreaterThan(0)
    expect(draws(1)()).toBe(1)
  })
})

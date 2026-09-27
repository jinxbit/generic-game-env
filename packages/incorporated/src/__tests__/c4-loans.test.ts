// C4 — loans (RULES.md §6).

import { describe, expect, it } from 'vitest'
import { borrowingCapacity, loanProceeds } from '../loans'
import { interestIndexOf } from '../sliders'
import { arrange, autoplay, corpPlayer, newGame, play, withGame } from '../testing'
import type { GameState } from '../types'

const atInvestment = (options = {}): GameState => autoplay(newGame({ options }), (s) => s.game.phase === 'investment')

describe('R-LOAN-02: proceeds', () => {
  it('$17 with 3 bonds outstanding gives $14', () => {
    const g = withGame(newGame(), (game) => {
      game.sliders.interest = interestIndexOf(17)
    }).game
    expect(loanProceeds(g, newGame().options, 3)).toBe(14)
  })

  it('never goes below $1 ([AMBIG-9])', () => {
    const g = withGame(newGame(), (game) => {
      game.sliders.interest = interestIndexOf(11)
    }).game
    expect(loanProceeds(g, newGame().options, 20)).toBe(1)
  })

  it('LESS_CRUEL_LOANS drops the penalty', () => {
    const s = newGame({ options: { lessCruelLoans: true } })
    const g = withGame(s, (game) => {
      game.sliders.interest = interestIndexOf(17)
    }).game
    expect(loanProceeds(g, s.options, 3)).toBe(17)
  })
})

describe('TAKE_LOAN', () => {
  it('adds proceeds and a bond, any time in Investment — even off-turn', () => {
    const s = withGame(atInvestment(), (g) => {
      g.sliders.interest = 0
    })
    const om = corpPlayer(s, 'OLD_MONEY')
    const after = play(s, { type: 'TAKE_LOAN', playerId: om })
    expect(after.game.players[om].bonds).toBe(1)
    expect(after.game.players[om].cash).toBe((s.game.players[om].cash ?? 0) + 20)
    const second = play(after, { type: 'TAKE_LOAN', playerId: om })
    expect(second.game.players[om].cash).toBe((after.game.players[om].cash ?? 0) + 19)
    // Nobody's turn changed.
    expect(second.game.prompt).toEqual(s.game.prompt)
  })

  it('is refused outside Investment and Competition', () => {
    const s = autoplay(newGame(), (x) => x.game.phase === 'lobbying')
    expect(() => play(s, { type: 'TAKE_LOAN', playerId: s.game.seatOrder[0] })).toThrow('Loans can only be taken during Investment and Competition.')
  })

  it('is refused once all 25 bonds are out ([AMBIG-9])', () => {
    const s = withGame(atInvestment(), (g) => {
      g.players[g.seatOrder[1]].bonds = 25
    })
    expect(() => play(s, { type: 'TAKE_LOAN', playerId: s.game.seatOrder[0] })).toThrow('No bonds are left to issue.')
    expect(borrowingCapacity(s.game, s.options, s.game.seatOrder[0])).toBe(s.game.players[s.game.seatOrder[0]].cash)
  })
})

describe('R-LOAN-01: forced loans', () => {
  it('cover a winning bid larger than cash', () => {
    let s = withGame(atInvestment(), (g) => {
      g.sliders.interest = 0
      for (const id of g.seatOrder) g.players[id].cash = 10
    })
    const fd = corpPlayer(s, 'FORTRESS_DERIVATIVES')
    s = play(s, { type: 'START_AUCTION', playerId: fd, country: 'US', bid: 22 })
    while (s.game.prompt?.kind === 'auction' && s.game.prompt.mode === 'public') s = play(s, { type: 'PASS_BID', playerId: s.game.prompt.current })
    // One $20 loan: 10 + 20 − 22.
    expect(s.game.players[fd].bonds).toBe(1)
    expect(s.game.players[fd].cash).toBe(8)
  })

  it('refuse a bid that could never be paid, even with every bond', () => {
    const s = withGame(atInvestment(), (g) => {
      g.players[g.seatOrder[1]].bonds = 25
    })
    expect(() => play(s, { type: 'START_AUCTION', playerId: s.game.seatOrder[0], country: 'US', bid: 1000 })).toThrow("You can't raise $1000")
  })
})

describe('R-LOAN-03/04: interest and repayment', () => {
  it('interest is $1 per bond; short of cash the player is bailed out to $0 and keeps the bonds', () => {
    const s = arrange(atInvestment(), (g) => {
      g.prompt = null
      g.revealed = []
      const [a, b] = g.seatOrder
      g.players[a].bonds = 3
      g.players[a].cash = 10
      g.players[b].bonds = 5
      g.players[b].cash = 2
      g.queue = [{ t: 'interest' }]
    })
    const [a, b] = s.game.seatOrder
    expect(s.game.players[a].cash).toBe(7)
    expect(s.game.players[b].cash).toBe(0)
    expect(s.game.players[b].bonds).toBe(5)
  })

  it('repayment costs the current interest value; Big Brother decides after the others', () => {
    let s = arrange(atInvestment(), (g) => {
      g.prompt = null
      g.sliders.interest = interestIndexOf(12)
      for (const id of g.seatOrder) {
        g.players[id].bonds = 2
        g.players[id].cash = 30
      }
      g.queue = [{ t: 'repayment', stage: 'all' }]
    })
    const bb = corpPlayer(s, 'BIG_BROTHER')
    const prompt = s.game.prompt
    if (prompt?.kind !== 'repayment') throw new Error('expected repayment')
    expect(prompt.waiting).not.toContain(bb)
    expect(s.pendingPlayerIds.sort()).toEqual(s.game.seatOrder.filter((id) => id !== bb).sort())
    expect(s.activePlayerId).toBeNull()
    const fd = corpPlayer(s, 'FORTRESS_DERIVATIVES')
    expect(() => play(s, { type: 'REPAY', playerId: fd, promptId: prompt.promptId, count: 3 })).toThrow('at most 2')
    for (const id of prompt.waiting) s = play(s, { type: 'REPAY', playerId: id, promptId: prompt.promptId, count: id === fd ? 2 : 0 })
    expect(s.game.players[fd].bonds).toBe(0)
    expect(s.game.players[fd].cash).toBe(6)
    expect(s.game.prompt).toMatchObject({ kind: 'repayment', waiting: [bb] })
  })
})

// C8 — Phase 5: Earnings (RULES.md §9).

import { describe, expect, it } from 'vitest'
import { growthIndexOf, growthPercent, interestIndexOf, interestValue } from '../sliders'
import { arrange, autoplay, corpPlayer, dice, newGame, play } from '../testing'
import type { GameState } from '../types'

/** Lobbying done: arrange the table, then run from the start of Earnings. */
function earnings(edit: (g: GameState['game'], ids: string[]) => void, random: Parameters<typeof arrange>[2] = 5, players = 4): GameState {
  const base = autoplay(newGame({ players }), (x) => x.game.phase === 'lobbying')
  return arrange(
    base,
    (g) => {
      g.prompt = null
      g.queue = [{ t: 'endPhase' }, { t: 'startEarnings' }]
      g.revealed = []
      for (const c of Object.values(g.countries)) for (const sq of c.squares) if (sq.occupant !== 'LOCK') sq.occupant = null
      for (const id of g.seatOrder) g.players[id].cash = 0
      edit(g, g.seatOrder)
    },
    random,
  )
}

describe('Crisis (R-EARN-01..03) — the rulebook example', () => {
  it('Growth 5% + Stress +1 = 6; a roll of 4 is intensity 2', () => {
    let s = earnings(
      (g) => {
        g.sliders.growth = growthIndexOf(5)
        g.sliders.stress = 1
        g.sliders.interest = interestIndexOf(16)
        g.revealed = ['FIN', 'TECH', 'HEAVY']
      },
      dice([4, 12]),
    )
    const squid = corpPlayer(s, 'GIANT_SQUID')
    expect(s.game.lastCrisis).toEqual({ round: 1, difficulty: 6, roll: 4, intensity: 2 })
    // Giant Squid picks the 2 discards.
    expect(s.game.prompt).toEqual({ kind: 'crisisDiscard', playerId: squid, count: 2 })
    expect(() => play(s, { type: 'CRISIS_DISCARD', playerId: squid, indices: [0, 0] })).toThrow('2 different')
    s = play(s, { type: 'CRISIS_DISCARD', playerId: squid, indices: [0, 2] })
    expect(growthPercent(s.game.sliders)).toBe(3)
    expect(interestValue(s.game.sliders)).toBe(18)
    expect(s.game.sliders.stress).toBe(0)
    expect(s.game.crisisOccurred).toBe(true)
  })

  it('no crisis when the roll reaches the difficulty; Stress stays', () => {
    const s = earnings(
      (g) => {
        g.sliders.growth = growthIndexOf(5)
        g.sliders.stress = 1
      },
      dice([6, 12]),
    )
    expect(s.game.lastCrisis?.intensity).toBe(0)
    expect(s.game.sliders.stress).toBe(1)
  })

  it('discards at random without Giant Squid ([AMBIG-6])', () => {
    let seed = 0
    let base = newGame({ players: 2, seed })
    while (Object.values(base.game.players).some((p) => p.corp === 'GIANT_SQUID')) base = newGame({ players: 2, seed: ++seed })
    const lobbying = autoplay(base, (x) => x.game.phase === 'lobbying')
    const s = arrange(
      lobbying,
      (g) => {
        g.prompt = null
        g.queue = [{ t: 'endPhase' }, { t: 'startEarnings' }]
        g.sliders.growth = growthIndexOf(5)
        g.sliders.stress = 1
        g.revealed = ['FIN', 'TECH', 'HEAVY']
      },
      (() => {
        const d = dice([4, 12])
        let first = true
        return () => {
          if (first) {
            first = false
            return d()
          }
          return 123456789
        }
      })(),
    )
    expect(s.game.lastCrisis?.intensity).toBe(2)
    expect(s.game.prompt?.kind).not.toBe('crisisDiscard')
  })
})

describe('Payoff (R-EARN-04..06)', () => {
  it('Heavy with 2 cards: 2 squares → $4, 3 → $6, 4 → $8 + $2 for the leader', () => {
    const s = earnings(
      (g, [a, b, c]) => {
        g.revealed = ['HEAVY', 'HEAVY']
        g.sliders.growth = growthIndexOf(-3)
        g.sliders.stress = -2
        g.rdSquare = null
        const heavy: [string, number][] = [
          ['EUROZONE', 4],
          ['EUROZONE', 5],
          ['JAPAN', 2],
          ['JAPAN', 3],
          ['CHINA', 3],
          ['CHINA', 4],
          ['EASTERN_EUROPE', 0],
          ['INDIA', 1],
          ['US', 6],
        ]
        const owners = [a, a, b, b, b, c, c, c, c]
        heavy.forEach(([country, i], n) => (g.countries[country].squares[i].occupant = owners[n]))
      },
      dice([12, 12]),
    )
    const [a, b, c, d] = s.game.seatOrder
    expect(s.game.lastEarnings?.payoff).toEqual({ [a]: 4, [b]: 6, [c]: 10, [d]: 0 })
    expect(s.game.lastEarnings?.leaders).toEqual({ HEAVY: c })
    // R-EARN-06: resolved cards go to the discard.
    expect(s.game.revealed).toEqual([])
  })

  it('the R&D square counts double; a tie gives no leader', () => {
    const s = earnings(
      (g, [a, b]) => {
        g.revealed = ['ENERGY']
        g.sliders.growth = growthIndexOf(-3)
        g.sliders.stress = -2
        g.rdSquare = { country: 'US', square: 5 }
        g.countries.US.squares[5].occupant = a
        g.countries.RUSSIA.squares[0].occupant = b
        g.countries.RUSSIA.squares[1].occupant = b
      },
      dice([12, 12]),
    )
    const [a, b] = s.game.seatOrder
    expect(s.game.lastEarnings?.payoff[a]).toBe(2)
    expect(s.game.lastEarnings?.payoff[b]).toBe(2)
    expect(s.game.lastEarnings?.leaders).toEqual({})
  })

  it('the leader bonus is $1 in a 2-player game', () => {
    const s = earnings(
      (g, [a]) => {
        g.revealed = ['FIN']
        g.sliders.growth = growthIndexOf(-3)
        g.sliders.stress = -2
        g.countries.UK.squares[0].occupant = a
      },
      dice([12, 12]),
      2,
    )
    expect(s.game.lastEarnings?.payoff[s.game.seatOrder[0]]).toBe(2)
  })

  it('no leader bonus for an industry with no revealed cards', () => {
    const s = earnings(
      (g, [a]) => {
        g.revealed = ['FIN']
        g.sliders.growth = growthIndexOf(-3)
        g.sliders.stress = -2
        g.countries.UK.squares[0].occupant = a
        g.countries.RUSSIA.squares[0].occupant = a
      },
      dice([12, 12]),
    )
    const [a] = s.game.seatOrder
    expect(s.game.lastEarnings?.payoff[a]).toBe(3)
    expect(s.game.lastEarnings?.leaders).toEqual({ FIN: a })
  })

  it('pays interest after the payoff, then offers repayment', () => {
    const s = earnings(
      (g, [a]) => {
        g.revealed = ['FIN']
        g.sliders.growth = growthIndexOf(-3)
        g.sliders.stress = -2
        g.countries.UK.squares[0].occupant = a
        g.players[a].bonds = 2
        g.players[a].cash = 30
      },
      dice([12, 12]),
    )
    const [a] = s.game.seatOrder
    // 30 + 1 + 2 (leader) − 2 interest
    expect(s.game.players[a].cash).toBe(31)
    expect(s.game.prompt).toMatchObject({ kind: 'repayment', waiting: [a] })
  })
})

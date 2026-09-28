// C6 — Phase 3: Competition (RULES.md §7).

import { describe, expect, it } from 'vitest'
import { arrange, autoplay, newGame, play, withGame } from '../testing'
import type { GameState } from '../types'

/** Competition turn 1, Fortress Derivatives to act, income placed, then `edit`. */
function atCompetition(edit: (g: GameState['game'], ids: string[]) => void = () => {}, options = {}): GameState {
  const s = autoplay(newGame({ options }), (x) => x.game.phase === 'competition')
  return withGame(s, (g) => {
    for (const c of Object.values(g.countries)) c.loose = {}
    for (const id of g.seatOrder) g.players[id].cash = 30
    edit(g, g.seatOrder)
  })
}

describe('R-COMP-01: income', () => {
  it('adds one loose cube per share in that share’s country', () => {
    const s = autoplay(newGame(), (x) => x.game.phase === 'competition')
    for (const id of s.game.seatOrder) {
      for (const [country, n] of Object.entries(s.game.players[id].shares)) expect(s.game.countries[country].loose[id] ?? 0).toBe(n)
    }
    expect(s.game.prompt).toEqual({ kind: 'competitionTurn', playerId: s.game.seatOrder[0] })
  })

  it('short of cubes, the owner chooses where they go ([AMBIG-10])', () => {
    const base = autoplay(newGame(), (x) => x.game.phase === 'lobbying')
    const fd = base.game.seatOrder[0]
    let s = arrange(base, (g) => {
      g.players[fd].shares = { ...g.players[fd].shares, US: 2, CHINA: 2 }
      g.players[fd].supply = 3
      g.prompt = null
      g.queue = [{ t: 'startCompetition' }]
    })
    expect(s.game.prompt).toEqual({ kind: 'income', playerId: fd, available: 3 })
    expect(() => play(s, { type: 'ALLOCATE_INCOME', playerId: fd, allocation: { US: 3 } })).toThrow('only 2 share')
    expect(() => play(s, { type: 'ALLOCATE_INCOME', playerId: fd, allocation: { US: 1 } })).toThrow('exactly 3')
    s = play(s, { type: 'ALLOCATE_INCOME', playerId: fd, allocation: { US: 1, CHINA: 2 } })
    expect(s.game.countries.US.loose[fd]).toBe(1)
    expect(s.game.countries.CHINA.loose[fd]).toBe(2)
    expect(s.game.players[fd].supply).toBe(0)
  })
})

describe('Fight (R-COMP-03..06)', () => {
  it("can't kill an occupying cube while its owner has loose cubes or defenders there", () => {
    const s = atCompetition((g, [fd, gs]) => {
      g.countries.RUSSIA.squares[0].occupant = gs
      g.countries.RUSSIA.loose = { [fd]: 2, [gs]: 1 }
    })
    const [fd, gs] = s.game.seatOrder
    expect(() => play(s, { type: 'FIGHT', playerId: fd, attacks: [{ kind: 'kill', country: 'RUSSIA', target: { kind: 'square', square: 0 } }] })).toThrow('protected')
    // Kill the loose cube first, then the occupying one is fair game.
    const after = play(s, {
      type: 'FIGHT',
      playerId: fd,
      attacks: [
        { kind: 'kill', country: 'RUSSIA', target: { kind: 'loose', playerId: gs } },
        { kind: 'kill', country: 'RUSSIA', target: { kind: 'square', square: 0 } },
      ],
    })
    expect(after.game.countries.RUSSIA.squares[0].occupant).toBeNull()
    expect(after.game.countries.RUSSIA.loose).toEqual({})
  })

  it('a defending executive protects too, and can itself be killed — off to Tax Havens', () => {
    const s = atCompetition((g, [fd, gs]) => {
      g.countries.RUSSIA.squares[0].occupant = gs
      g.countries.RUSSIA.loose = { [fd]: 2 }
      g.countries.RUSSIA.defenders = { [gs]: 1 }
      g.players[gs].executives -= 1
    })
    const [fd, gs] = s.game.seatOrder
    expect(() => play(s, { type: 'FIGHT', playerId: fd, attacks: [{ kind: 'kill', country: 'RUSSIA', target: { kind: 'square', square: 0 } }] })).toThrow('protected')
    const after = play(s, { type: 'FIGHT', playerId: fd, attacks: [{ kind: 'kill', country: 'RUSSIA', target: { kind: 'defender', playerId: gs } }] })
    expect(after.game.countries.RUSSIA.defenders).toEqual({})
    expect(after.game.players[gs].parkedExecutives).toBe(1)
  })

  it('R-COMP-06: kill an occupying cube, then grab the freed square, in one Fight', () => {
    const s = atCompetition((g, [fd, gs]) => {
      g.countries.RUSSIA.squares[0].occupant = gs
      g.countries.RUSSIA.loose = { [fd]: 2 }
    })
    const [fd, gs] = s.game.seatOrder
    const supply = s.game.players[gs].supply
    const after = play(s, {
      type: 'FIGHT',
      playerId: fd,
      attacks: [
        { kind: 'kill', country: 'RUSSIA', target: { kind: 'square', square: 0 } },
        { kind: 'grab', country: 'RUSSIA', square: 0 },
      ],
    })
    expect(after.game.countries.RUSSIA.squares[0].occupant).toBe(fd)
    expect(after.game.players[gs].supply).toBe(supply + 1)
    expect(after.game.prompt).toEqual({ kind: 'competitionTurn', playerId: gs })
  })

  it('grabs only empty, unlocked squares, and never attacks in Tax Havens beyond its square', () => {
    const s = atCompetition((g, [fd, gs]) => {
      g.countries.INDIA.loose = { [fd]: 1 }
      g.countries.TAX_HAVENS.loose = { [fd]: 1, [gs]: 1 }
    })
    const fd = s.game.seatOrder[0]
    const gs = s.game.seatOrder[1]
    expect(() => play(s, { type: 'FIGHT', playerId: fd, attacks: [{ kind: 'grab', country: 'INDIA', square: 4 }] })).toThrow('not empty')
    expect(() => play(s, { type: 'FIGHT', playerId: fd, attacks: [{ kind: 'kill', country: 'TAX_HAVENS', target: { kind: 'loose', playerId: gs } }] })).toThrow('Tax Havens')
    const after = play(s, { type: 'FIGHT', playerId: fd, attacks: [{ kind: 'grab', country: 'TAX_HAVENS', square: 0 }] })
    expect(after.game.countries.TAX_HAVENS.squares[0].occupant).toBe(fd)
  })

  it('needs a loose cube in the country', () => {
    const s = atCompetition()
    expect(() => play(s, { type: 'FIGHT', playerId: s.game.seatOrder[0], attacks: [{ kind: 'grab', country: 'RUSSIA', square: 0 }] })).toThrow('no loose cube')
  })
})

describe('Expand (R-COMP-08..10)', () => {
  it('rejects NATO → SCO', () => {
    const s = atCompetition((g, [fd]) => {
      g.countries.SCANDINAVIA.loose = { [fd]: 1 }
    })
    expect(() => play(s, { type: 'EXPAND', playerId: s.game.seatOrder[0], moves: [{ from: 'SCANDINAVIA', to: 'RUSSIA' }] })).toThrow("can't move")
  })

  it('rejects moving out of a battleground', () => {
    const s = atCompetition((g, [fd]) => {
      g.countries.IRAN.loose = { [fd]: 1 }
    })
    expect(() => play(s, { type: 'EXPAND', playerId: s.game.seatOrder[0], moves: [{ from: 'IRAN', to: 'CENTRAL_ASIA' }] })).toThrow("can't move")
  })

  it('allows NATO → battleground and same-camp moves, for $1', () => {
    const s = atCompetition((g, [fd]) => {
      g.countries.GULF_STATES.loose = { [fd]: 1 }
      g.countries.EUROZONE.loose = { [fd]: 1 }
    })
    const fd = s.game.seatOrder[0]
    const after = play(s, {
      type: 'EXPAND',
      playerId: fd,
      moves: [
        { from: 'GULF_STATES', to: 'IRAN' },
        { from: 'EUROZONE', to: 'UK' },
      ],
    })
    expect(after.game.countries.IRAN.loose[fd]).toBe(1)
    expect(after.game.countries.UK.loose[fd]).toBe(1)
    expect(after.game.players[fd].cash).toBe(29)
  })

  it('lets one cube move twice', () => {
    const s = atCompetition((g, [fd]) => {
      g.countries.EUROZONE.loose = { [fd]: 1 }
    })
    const fd = s.game.seatOrder[0]
    const after = play(s, {
      type: 'EXPAND',
      playerId: fd,
      moves: [
        { from: 'EUROZONE', to: 'UK' },
        { from: 'UK', to: 'CANADA' },
      ],
    })
    expect(after.game.countries.CANADA.loose[fd]).toBe(1)
    // R-COMP-10: Expand never occupies.
    expect(after.game.countries.CANADA.squares[0].occupant).toBeNull()
  })

  it('allows Tax Havens → anywhere, and nothing into Tax Havens', () => {
    const s = atCompetition((g, [fd]) => {
      g.countries.TAX_HAVENS.loose = { [fd]: 1 }
      g.countries.UK.loose = { [fd]: 1 }
    })
    const fd = s.game.seatOrder[0]
    expect(play(s, { type: 'EXPAND', playerId: fd, moves: [{ from: 'TAX_HAVENS', to: 'CHINA' }] }).game.countries.CHINA.loose[fd]).toBe(1)
    expect(() => play(s, { type: 'EXPAND', playerId: fd, moves: [{ from: 'UK', to: 'TAX_HAVENS' }] })).toThrow("can't move")
  })

  it('takes a forced loan for the $1 when broke', () => {
    const s = atCompetition((g, [fd]) => {
      g.countries.EUROZONE.loose = { [fd]: 1 }
      g.players[fd].cash = 0
    })
    const fd = s.game.seatOrder[0]
    const after = play(s, { type: 'EXPAND', playerId: fd, moves: [{ from: 'EUROZONE', to: 'UK' }] })
    expect(after.game.players[fd].bonds).toBe(1)
  })
})

describe('Defend, Pass and cleanup (R-COMP-07, 11, 12)', () => {
  it('Defend places an executive; Pass places the rest and is final', () => {
    let s = atCompetition()
    const [fd, gs, bb, om] = s.game.seatOrder
    s = play(s, { type: 'DEFEND', playerId: fd, country: 'US' })
    expect(s.game.countries.US.defenders[fd]).toBe(1)
    expect(() => play(s, { type: 'COMPETITION_PASS', playerId: gs, defenders: [] })).toThrow('Place all 2')
    s = play(s, { type: 'COMPETITION_PASS', playerId: gs, defenders: ['EUROZONE', 'CHINA'] })
    expect(s.game.players[gs].executives).toBe(0)
    s = play(s, { type: 'COMPETITION_PASS', playerId: bb, defenders: ['CHINA', 'CHINA'] })
    s = play(s, { type: 'COMPETITION_PASS', playerId: om, defenders: ['JAPAN', 'JAPAN', 'JAPAN'] })
    // Giant Squid, Big Brother and Old Money are out; Fortress Derivatives goes again.
    expect(s.game.prompt).toEqual({ kind: 'competitionTurn', playerId: fd })
    expect(() => play(s, { type: 'DEFEND', playerId: fd, country: 'TAX_HAVENS' })).toThrow('not Tax Havens')
  })

  it('cleanup removes every loose cube, Tax Havens included, and returns executives', () => {
    let s = atCompetition((g, [fd, gs]) => {
      g.countries.TAX_HAVENS.loose = { [gs]: 2 }
      g.countries.US.loose = { [fd]: 3 }
    })
    const supplyBefore = s.game.players[s.game.seatOrder[1]].supply
    for (const id of s.game.seatOrder) s = play(s, { type: 'COMPETITION_PASS', playerId: id, defenders: Array.from({ length: s.game.players[id].executives }, () => 'US') })
    expect(s.game.phase).toBe('lobbying')
    for (const c of Object.values(s.game.countries)) {
      expect(c.loose).toEqual({})
      expect(c.defenders).toEqual({})
    }
    expect(s.game.players[s.game.seatOrder[1]].supply).toBe(supplyBefore + 2)
    for (const p of Object.values(s.game.players)) expect(p.executives).toBe(p.executiveCount)
  })
})

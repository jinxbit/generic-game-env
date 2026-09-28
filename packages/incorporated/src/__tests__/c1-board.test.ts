// C1 — state model and board data (RULES.md §1, §2).

import { describe, expect, it } from 'vitest'
import { arrowExists, countryDef, moveAllowed } from '../board'
import { ARROWS, COUNTRIES, INVESTMENT_CARDS, SETUP_LOCKS, RD_START, TAX_HAVENS, ZONES } from '../data/board'
import { CORPORATIONS } from '../data/corporations'
import { OUTLOOK_CARDS } from '../data/outlookCards'
import { GROWTH_TRACK, growthIndexOf, INTEREST_TRACK, interestIndexOf, moveSlider, payoffsToReveal } from '../sliders'
import { newGame } from '../testing'

describe('board data', () => {
  it('loads every country with a known zone, squares and stability', () => {
    expect(COUNTRIES).toHaveLength(24)
    for (const c of COUNTRIES) {
      expect(c.squares.length).toBeGreaterThan(0)
      if (c.id === TAX_HAVENS) continue
      expect(ZONES).toContain(c.zone)
      expect(c.stability).toBeGreaterThanOrEqual(3)
      expect(c.stability).toBeLessThanOrEqual(5)
      if (c.isMajor) expect(c.startingCamp).toBeDefined()
    }
  })

  it('has seven majors and one starting battleground per zone', () => {
    expect(COUNTRIES.filter((c) => c.isMajor).map((c) => c.id).sort()).toEqual(['BRAZIL', 'CHINA', 'EUROZONE', 'INDIA', 'JAPAN', 'RUSSIA', 'US'])
    for (const zone of ZONES) expect(COUNTRIES.filter((c) => c.zone === zone && c.startAffiliation === 'BATTLEGROUND')).toHaveLength(1)
  })

  it('has every arrow endpoint on the board', () => {
    for (const [from, to] of ARROWS) {
      expect(() => countryDef(from)).not.toThrow()
      expect(() => countryDef(to)).not.toThrow()
    }
  })

  it('leads out of Tax Havens to every country and never into it', () => {
    for (const c of COUNTRIES) {
      if (c.id === TAX_HAVENS) continue
      expect(arrowExists(TAX_HAVENS, c.id)).toBe(true)
      expect(arrowExists(c.id, TAX_HAVENS)).toBe(false)
    }
  })

  it('points setup data at real squares', () => {
    expect(countryDef(RD_START.country).squares[RD_START.square]).toBe('ENERGY')
    for (const lock of SETUP_LOCKS) expect(countryDef(lock.country).squares.length).toBeGreaterThanOrEqual(lock.count)
    for (const corp of CORPORATIONS) {
      for (const setup of Object.values(corp.setup)) {
        for (const cube of setup.cubes) expect(countryDef(cube.country).squares).toContain(cube.industry)
        for (const country of Object.keys(setup.shares)) expect(countryDef(country).isMajor).toBe(true)
      }
    }
    for (const card of OUTLOOK_CARDS) {
      for (const effect of card.effects) if ('country' in effect) expect(() => countryDef(effect.country)).not.toThrow()
    }
  })

  it('has ten Outlook cards with unique ids, and flags the placeholders', () => {
    expect(OUTLOOK_CARDS).toHaveLength(10)
    expect(new Set(OUTLOOK_CARDS.map((c) => c.id)).size).toBe(10)
    expect(OUTLOOK_CARDS.find((c) => c.id === 'INDIA_EMERGING')?.placeholder).toBe(false)
  })
})

describe('sliders (§1.2)', () => {
  it('round-trips the Growth and Interest tables', () => {
    GROWTH_TRACK.forEach((percent, index) => expect(growthIndexOf(percent)).toBe(index))
    INTEREST_TRACK.forEach((value, index) => expect(interestIndexOf(value)).toBe(index))
    expect(INTEREST_TRACK[0]).toBe(20)
    expect(INTEREST_TRACK[9]).toBe(11)
  })

  it('reveals index + 1 payoffs — the three points the rulebook confirms', () => {
    const at = (percent: number) => payoffsToReveal({ growth: growthIndexOf(percent), interest: 0, stress: 0, bop: 0 })
    expect(at(2)).toBe(5)
    expect(at(5)).toBe(8)
    expect(at(6)).toBe(9)
    // [AMBIG-1]: no 0% position.
    expect(GROWTH_TRACK).not.toContain(0)
  })

  it('clamps at the track ends and reports the overflow', () => {
    const start = { growth: 0, interest: 8, stress: 2, bop: -4 }
    expect(moveSlider(start, 'interest', 3)).toEqual({ sliders: { ...start, interest: 9 }, overflow: 2 })
    expect(moveSlider(start, 'growth', -1).sliders.growth).toBe(0)
    expect(moveSlider(start, 'stress', 1).sliders.stress).toBe(2)
    expect(moveSlider(start, 'bop', -1).sliders.bop).toBe(-4)
  })
})

describe('components (§1.3)', () => {
  it('has 30 shares in total', () => {
    expect(Object.values(INVESTMENT_CARDS).reduce((a, b) => a + b, 0)).toBe(30)
    for (const players of [2, 3, 4]) {
      const g = newGame({ players }).game
      const held = Object.values(g.players).reduce((sum, p) => sum + Object.values(p.shares).reduce((a, b) => a + b, 0), 0)
      const banked = Object.values(g.bank).reduce((a, b) => a + b, 0)
      expect(held + banked).toBe(30)
    }
  })

  it('knows movement needs matching camps', () => {
    const g = newGame().game
    expect(moveAllowed(g, 'EUROZONE', 'UK')).toBe(true)
    expect(moveAllowed(g, 'UK', 'EUROZONE')).toBe(false)
  })
})

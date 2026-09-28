// ⚑ DONT_STALL (RULES.md §11, [AMBIG-20]).

import { describe, expect, it } from 'vitest'
import { play } from '../../testing'
import { at } from './helpers'

describe('DONT_STALL', () => {
  it('a Fight must make 2 attacks, and an Expand 2 moves, while you have 2+ loose cubes', () => {
    const s = at('competition', { dontStall: true }, (g, [fd]) => {
      for (const c of Object.values(g.countries)) c.loose = {}
      g.countries.RUSSIA.loose = { [fd]: 2 }
      g.countries.EUROZONE.loose = { [fd]: 1 }
    })
    const fd = s.game.seatOrder[0]
    expect(() => play(s, { type: 'FIGHT', playerId: fd, attacks: [{ kind: 'grab', country: 'RUSSIA', square: 0 }] })).toThrow("Don't stall")
    expect(() => play(s, { type: 'EXPAND', playerId: fd, moves: [{ from: 'EUROZONE', to: 'UK' }] })).toThrow("Don't stall")
    const ok = play(s, {
      type: 'FIGHT',
      playerId: fd,
      attacks: [
        { kind: 'grab', country: 'RUSSIA', square: 0 },
        { kind: 'grab', country: 'RUSSIA', square: 1 },
      ],
    })
    expect(ok.game.countries.RUSSIA.squares.map((q) => q.occupant)).toEqual([fd, fd])
  })

  it('allows 1 when only 1 cube is left', () => {
    const s = at('competition', { dontStall: true }, (g, [fd]) => {
      for (const c of Object.values(g.countries)) c.loose = {}
      g.countries.RUSSIA.loose = { [fd]: 1 }
    })
    expect(play(s, { type: 'FIGHT', playerId: s.game.seatOrder[0], attacks: [{ kind: 'grab', country: 'RUSSIA', square: 0 }] }).game.countries.RUSSIA.squares[0].occupant).toBe(s.game.seatOrder[0])
  })

  it('once every other player has passed, each action costs $1 more', () => {
    let s = at('competition', { dontStall: true }, (g) => {
      for (const c of Object.values(g.countries)) c.loose = {}
    })
    const [fd, gs, bb, om] = s.game.seatOrder
    s = play(s, { type: 'DEFEND', playerId: fd, country: 'US' })
    for (const id of [gs, bb, om]) s = play(s, { type: 'COMPETITION_PASS', playerId: id, defenders: Array.from({ length: s.game.players[id].executives }, () => 'US') })
    s = play(s, { type: 'DEFEND', playerId: fd, country: 'US' })
    expect(s.game.players[fd].cash).toBe(29)
  })
})

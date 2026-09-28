// ⚑ ACCUM_RD (RULES.md §11).

import { describe, expect, it } from 'vitest'
import { industrySquares } from '../../board'
import { play } from '../../testing'
import { at } from './helpers'

describe('ACCUM_RD', () => {
  it('has no R&D marker; the R&D event fortifies a square you hold in a stability-5 country', () => {
    const s = at('lobbying', { accumRd: true })
    expect(s.game.rdSquare).toBeNull()
    const fd = s.game.seatOrder[0]
    // Fortress Derivatives starts on the US FIN square.
    expect(() => play(s, { type: 'LOBBY', playerId: fd, event: { kind: 'rd', country: 'US', square: 3 } })).toThrow('square you occupy')
    const after = play(s, { type: 'LOBBY', playerId: fd, event: { kind: 'rd', country: 'US', square: 0 } })
    expect(after.game.countries.US.squares[0].fortified).toBe(true)
    expect(after.game.players[fd].supply).toBe(s.game.players[fd].supply - 1)
    expect(industrySquares(after.game, fd, 'FIN')).toBe(2)
  })

  it('fortified squares cannot be killed, replaced or locked', () => {
    const s = at('competition', { accumRd: true }, (g, [fd, gs]) => {
      for (const c of Object.values(g.countries)) c.loose = {}
      g.countries.RUSSIA.squares[0].occupant = gs
      g.countries.RUSSIA.squares[0].fortified = true
      g.countries.RUSSIA.loose = { [fd]: 1 }
    })
    expect(() => play(s, { type: 'FIGHT', playerId: s.game.seatOrder[0], attacks: [{ kind: 'kill', country: 'RUSSIA', target: { kind: 'square', square: 0 } }] })).toThrow('Fortified')
  })
})

// C7 — Phase 4: Lobbying (RULES.md §8).

import { describe, expect, it } from 'vitest'
import { interestValue } from '../sliders'
import { autoplay, dice, newGame, play, withGame } from '../testing'
import type { GameAction, GameState, LobbyEvent } from '../types'

/** Lobbying turn 1, Fortress Derivatives to act, then `edit`. */
function atLobbying(edit: (g: GameState['game'], ids: string[]) => void = () => {}): GameState {
  const s = autoplay(newGame(), (x) => x.game.phase === 'lobbying')
  return withGame(s, (g) => edit(g, g.seatOrder))
}

const lobby = (playerId: string, event: LobbyEvent): GameAction => ({ type: 'LOBBY', playerId, event })
const d6 = (value: number) => dice([value, 6])

describe('Power Play — the rulebook example (R-LOB-03..05)', () => {
  const start = () =>
    atLobbying((g) => {
      g.sliders.bop = 2
    })

  it('BoP +2 NATO against Eastern Europe’s +1 SCO: a 3 wins for NATO and the marker moves to Russia', () => {
    const s0 = start()
    const fd = s0.game.seatOrder[0]
    const s = play(s0, lobby(fd, { kind: 'powerPlay', zone: 'EUROPE', camp: 'NATO' }), d6(3))
    expect(s.game.lastPowerPlay).toMatchObject({ roll: 3, modified: 4, target: 4, success: true })
    expect(s.game.countries.EASTERN_EUROPE.affiliation).toBe('NATO')
    expect(s.game.countries.EASTERN_EUROPE.squares[0].occupant).toBe(fd)
    expect(s.game.battlegrounds.EUROPE).toBe('RUSSIA')
    expect(s.game.countries.RUSSIA.affiliation).toBe('BATTLEGROUND')
  })

  it('a 2 fails for NATO; SCO needs a 5', () => {
    const s0 = start()
    const fd = s0.game.seatOrder[0]
    expect(play(s0, lobby(fd, { kind: 'powerPlay', zone: 'EUROPE', camp: 'NATO' }), d6(2)).game.lastPowerPlay?.success).toBe(false)
    expect(play(s0, lobby(fd, { kind: 'powerPlay', zone: 'EUROPE', camp: 'SCO' }), d6(4)).game.lastPowerPlay).toMatchObject({ modified: 3, success: false })
    const won = play(s0, lobby(fd, { kind: 'powerPlay', zone: 'EUROPE', camp: 'SCO' }), d6(5))
    expect(won.game.lastPowerPlay?.success).toBe(true)
    // SCO won a minor: the marker goes to a NATO minor — the player picks.
    expect(won.game.prompt).toEqual({ kind: 'moveMarker', playerId: fd, zone: 'EUROPE', options: ['UK', 'SCANDINAVIA'] })
    const moved = play(won, { type: 'MOVE_MARKER', playerId: fd, country: 'UK' })
    expect(moved.game.battlegrounds.EUROPE).toBe('UK')
  })

  it('R-LOB-04: a natural 1 always fails and a natural 6 always wins', () => {
    const s0 = atLobbying((g) => {
      g.sliders.bop = 4
    })
    const fd = s0.game.seatOrder[0]
    expect(play(s0, lobby(fd, { kind: 'powerPlay', zone: 'EUROPE', camp: 'NATO' }), d6(1)).game.lastPowerPlay?.success).toBe(false)
    const low = atLobbying((g) => {
      g.sliders.bop = 4
    })
    expect(play(low, lobby(fd, { kind: 'powerPlay', zone: 'EUROPE', camp: 'SCO' }), d6(6)).game.lastPowerPlay?.success).toBe(true)
  })
})

describe('Majors (R-LOB-07/08/09)', () => {
  const russiaBattleground = () =>
    atLobbying((g, [, gs]) => {
      g.countries.EASTERN_EUROPE.affiliation = 'NATO'
      g.countries.RUSSIA.affiliation = 'BATTLEGROUND'
      g.battlegrounds.EUROPE = 'RUSSIA'
      g.countries.RUSSIA.squares[0].occupant = gs
      g.players[gs].shares.RUSSIA = 1
      g.bank.RUSSIA = 1
      g.sliders.bop = 0
    })

  it('R-LOB-08: a major lost by its starting camp is wiped, its shares discarded, BoP moves and the zone is resolved', () => {
    const s0 = russiaBattleground()
    const [fd, gs] = s0.game.seatOrder
    const supply = s0.game.players[gs].supply
    const s = play(s0, lobby(fd, { kind: 'powerPlay', zone: 'EUROPE', camp: 'NATO' }), d6(6))
    expect(s.game.countries.RUSSIA.affiliation).toBe('NATO')
    expect(s.game.countries.RUSSIA.squares.every((q) => q.occupant === null)).toBe(true)
    expect(s.game.players[gs].supply).toBe(supply + 1)
    expect(s.game.players[gs].shares.RUSSIA).toBe(0)
    // [AMBIG-13]: the bank's shares go too.
    expect(s.game.bank.RUSSIA).toBe(0)
    expect(s.game.retiredMajors).toEqual(['RUSSIA'])
    expect(s.game.sliders.bop).toBe(1)
    expect(s.game.battlegrounds.EUROPE).toBeNull()
    // Resolved: no more Power Plays in Europe.
    const gsTurn = s.game.prompt
    expect(gsTurn).toMatchObject({ kind: 'lobbyTurn', playerId: gs })
    expect(() => play(s, lobby(gs, { kind: 'powerPlay', zone: 'EUROPE', camp: 'SCO' }))).toThrow('already taken')
    expect(() => play(s, { type: 'START_AUCTION', playerId: gs, country: 'RUSSIA', bid: 3 })).toThrow()
  })

  it('R-LOB-07: the starting camp winning a major moves the marker to a minor of the losing camp', () => {
    const s0 = russiaBattleground()
    const fd = s0.game.seatOrder[0]
    const s = play(s0, lobby(fd, { kind: 'powerPlay', zone: 'EUROPE', camp: 'SCO' }), d6(6))
    expect(s.game.countries.RUSSIA.affiliation).toBe('SCO')
    expect(s.game.prompt).toMatchObject({ kind: 'moveMarker', options: ['UK', 'SCANDINAVIA', 'EASTERN_EUROPE'] })
  })

  it('R-LOB-09: the US always wins for NATO and China for SCO, with no roll', () => {
    const us = atLobbying((g) => {
      g.countries.US.affiliation = 'BATTLEGROUND'
      g.countries.SOUTH_AMERICA.affiliation = 'SCO'
      g.battlegrounds.AMERICA = 'US'
    })
    const fd = us.game.seatOrder[0]
    // dice() with nothing queued: any draw would throw.
    const s = play(us, lobby(fd, { kind: 'powerPlay', zone: 'AMERICA', camp: 'NATO' }), dice())
    expect(s.game.lastPowerPlay).toMatchObject({ roll: null, success: true })
    expect(s.game.countries.US.affiliation).toBe('NATO')
    expect(s.game.battlegrounds.AMERICA).toBe('SOUTH_AMERICA')

    const china = atLobbying((g) => {
      g.countries.CHINA.affiliation = 'BATTLEGROUND'
      g.countries.SOUTH_SEA.affiliation = 'NATO'
      g.battlegrounds.ASIA = 'CHINA'
    })
    const won = play(china, lobby(fd, { kind: 'powerPlay', zone: 'ASIA', camp: 'SCO' }), dice())
    expect(won.game.countries.CHINA.affiliation).toBe('SCO')
    expect(won.game.prompt).toMatchObject({ kind: 'moveMarker', options: ['KOREA', 'SOUTH_SEA', 'AUSTRALIA'] })
  })
})

describe('R-LOB-06: zone resolution', () => {
  it('removes the marker and moves BoP when the losing camp has nothing left in the zone', () => {
    const s0 = atLobbying((g) => {
      g.countries.CENTRAL_ASIA.affiliation = 'NATO'
      g.sliders.bop = 0
    })
    const fd = s0.game.seatOrder[0]
    const s = play(s0, lobby(fd, { kind: 'powerPlay', zone: 'THIRD_WORLD', camp: 'NATO' }), d6(6))
    expect(s.game.battlegrounds.THIRD_WORLD).toBeNull()
    expect(s.game.sliders.bop).toBe(1)
  })
})

describe('R-LOB-02: event availability', () => {
  it('each event once per turn, Power Play once per zone, Tax Havens unlimited', () => {
    let s = atLobbying()
    const [fd, gs, bb] = s.game.seatOrder
    s = play(s, lobby(fd, { kind: 'centralBanks', slider: 'interest', direction: 1 }))
    expect(() => play(s, lobby(gs, { kind: 'centralBanks', slider: 'stress', direction: -1 }))).toThrow('already taken')
    s = play(s, lobby(gs, { kind: 'taxHavens' }))
    s = play(s, lobby(bb, { kind: 'taxHavens' }))
    expect(s.game.countries.TAX_HAVENS.loose).toEqual({ [gs]: 1, [bb]: 1 })
    const om = s.game.seatOrder[3]
    s = play(s, lobby(om, { kind: 'powerPlay', zone: 'ASIA', camp: 'NATO' }), d6(1))
    expect(() => play(s, lobby(fd, { kind: 'powerPlay', zone: 'ASIA', camp: 'NATO' }))).toThrow('already taken')
    s = play(s, lobby(fd, { kind: 'powerPlay', zone: 'AMERICA', camp: 'NATO' }), d6(1))
    expect(s.game.lobbyUsed['POWER_PLAY:AMERICA']).toEqual([fd])
  })

  it('placement continues until every pool is empty, then Earnings', () => {
    let s = atLobbying()
    const total = Object.values(s.game.players).reduce((sum, p) => sum + p.executives, 0)
    for (let i = 0; i < total; i++) {
      expect(s.game.phase).toBe('lobbying')
      s = play(s, lobby(s.activePlayerId!, { kind: 'taxHavens' }))
    }
    expect(s.game.phase).not.toBe('lobbying')
  })
})

describe('other events (R-LOB-10..14)', () => {
  it('Central Banks moves Interest or Stress exactly 2, clamped ([AMBIG-14])', () => {
    const s0 = atLobbying((g) => {
      g.sliders.interest = 1
      g.sliders.stress = 1
    })
    const fd = s0.game.seatOrder[0]
    expect(interestValue(play(s0, lobby(fd, { kind: 'centralBanks', slider: 'interest', direction: -1 })).game.sliders)).toBe(20)
    expect(play(s0, lobby(fd, { kind: 'centralBanks', slider: 'stress', direction: 1 })).game.sliders.stress).toBe(2)
  })

  it('Budget: Austerity discards a chosen revealed card; Stimulus reveals one more', () => {
    const s0 = atLobbying((g) => {
      g.revealed = ['FIN', 'TECH']
      g.sliders.growth = 4
    })
    const fd = s0.game.seatOrder[0]
    expect(() => play(s0, lobby(fd, { kind: 'budget', mode: 'austerity' }))).toThrow('Choose a revealed payoff card')
    const austerity = play(s0, lobby(fd, { kind: 'budget', mode: 'austerity', discardIndex: 1 }))
    expect(austerity.game.revealed).toEqual(['FIN'])
    expect(austerity.game.sliders.growth).toBe(3)
    expect(austerity.game.payoffDiscard.at(-1)).toBe('TECH')
    const stimulus = play(s0, lobby(fd, { kind: 'budget', mode: 'stimulus' }))
    expect(stimulus.game.revealed).toHaveLength(3)
    expect(stimulus.game.sliders.growth).toBe(5)
  })

  it('R&D moves the marker to a square in a stability-5 country', () => {
    const s0 = atLobbying()
    const fd = s0.game.seatOrder[0]
    expect(play(s0, lobby(fd, { kind: 'rd', country: 'JAPAN', square: 2 })).game.rdSquare).toEqual({ country: 'JAPAN', square: 2 })
    expect(() => play(s0, lobby(fd, { kind: 'rd', country: 'RUSSIA', square: 0 }))).toThrow('stability-5')
  })

  it('Subsidies: look at 3, swap one with a revealed card, discard the rest ([AMBIG-21])', () => {
    const s0 = atLobbying((g) => {
      g.revealed = ['FIN']
      g.payoffDeck = ['TECH', 'HEAVY', 'MINING', ...g.payoffDeck]
    })
    const fd = s0.game.seatOrder[0]
    let s = play(s0, lobby(fd, { kind: 'subsidies' }))
    expect(s.game.prompt).toEqual({ kind: 'subsidies', playerId: fd, peek: ['TECH', 'HEAVY', 'MINING'] })
    const discards = s.game.payoffDiscard.length
    s = play(s, { type: 'SUBSIDIES_SWAP', playerId: fd, peekIndex: 1, revealedIndex: 0 })
    expect(s.game.revealed).toEqual(['HEAVY'])
    expect(s.game.payoffDiscard.slice(discards)).toEqual(['FIN', 'TECH', 'MINING'])
  })
})

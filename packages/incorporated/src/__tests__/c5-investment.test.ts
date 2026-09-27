// C5 — Phase 2: Investment (RULES.md §5).

import { describe, expect, it } from 'vitest'
import { autoplay, corpPlayer, newGame, play, withGame } from '../testing'
import type { GameAction, GameState } from '../types'

/** Investment turn 1, Fortress Derivatives to act, everyone on $30, interest at $20. */
function atInvestment(edit: (g: GameState['game']) => void = () => {}): GameState {
  const s = autoplay(newGame(), (x) => x.game.phase === 'investment')
  return withGame(s, (g) => {
    g.sliders.interest = 0
    for (const id of g.seatOrder) g.players[id].cash = 30
    edit(g)
  })
}

function run(state: GameState, actions: GameAction[]): GameState {
  return actions.reduce((s, a) => play(s, a), state)
}

describe('Public auction — the rulebook example (R-INV-02..06)', () => {
  it('Green buys the US share at $22; Blue sells one back for $19', () => {
    let s = atInvestment((g) => {
      const [, gs, bb] = g.seatOrder
      g.players[gs].shares.US = 1
      g.players[bb].shares.US = 1
      g.countries.US.squares[1].occupant = gs
      g.countries.US.squares[2].occupant = bb
    })
    const [green, blue, red, yellow] = s.game.seatOrder
    expect(s.game.players[green].corp).toBe('FORTRESS_DERIVATIVES')
    const bankBefore = s.game.bank.US

    s = run(s, [
      { type: 'START_AUCTION', playerId: green, country: 'US', bid: 3 },
      { type: 'BID', playerId: blue, amount: 4 },
      { type: 'BID', playerId: red, amount: 7 },
      { type: 'BID', playerId: yellow, amount: 11 },
      { type: 'BID', playerId: green, amount: 22 },
      { type: 'PASS_BID', playerId: blue },
      { type: 'PASS_BID', playerId: red },
      { type: 'PASS_BID', playerId: yellow },
    ])
    // R-INV-04: an empty unlocked square, the winner's choice.
    expect(s.game.prompt).toMatchObject({ kind: 'chooseSquare', playerId: green, options: [3, 4, 5, 6] })
    s = play(s, { type: 'CHOOSE_SQUARE', playerId: green, square: 3 })
    expect(s.game.players[green].cash).toBe(8)
    expect(s.game.players[green].shares.US).toBe(2)
    expect(s.game.countries.US.squares[3].occupant).toBe(green)

    // R-INV-05: reverse auction clockwise from the buyer, shareholders only (Yellow has none).
    expect(s.game.prompt).toMatchObject({ kind: 'auction', mode: 'reverse', current: blue, active: [blue, red], limit: 22 })
    s = run(s, [
      { type: 'BID', playerId: blue, amount: 21 },
      { type: 'BID', playerId: red, amount: 20 },
      { type: 'BID', playerId: blue, amount: 19 },
      { type: 'PASS_BID', playerId: red },
    ])
    expect(s.game.players[blue].cash).toBe(49)
    expect(s.game.players[blue].shares.US).toBe(0)
    expect(s.game.countries.US.squares[1].occupant).toBeNull()
    expect(s.game.bank.US).toBe(bankBefore)
    // R-INV-06: one share per reverse auction, then the next investor.
    expect(s.game.prompt).toEqual({ kind: 'investTurn', playerId: blue })
  })

  it('a reverse auction nobody lowers sells nothing', () => {
    let s = atInvestment((g) => {
      g.players[g.seatOrder[1]].shares.US = 1
    })
    const [green, blue, red, yellow] = s.game.seatOrder
    s = run(s, [
      { type: 'START_AUCTION', playerId: green, country: 'US', bid: 5 },
      { type: 'PASS_BID', playerId: blue },
      { type: 'PASS_BID', playerId: red },
      { type: 'PASS_BID', playerId: yellow },
      { type: 'CHOOSE_SQUARE', playerId: green, square: 1 },
      { type: 'PASS_BID', playerId: blue },
    ])
    expect(s.game.players[blue].shares.US).toBe(1)
    expect(s.game.prompt).toEqual({ kind: 'investTurn', playerId: blue })
  })

  it('validates bids', () => {
    const s = atInvestment()
    const [green, blue] = s.game.seatOrder
    expect(() => play(s, { type: 'START_AUCTION', playerId: green, country: 'US', bid: 2 })).toThrow('at least 3')
    expect(() => play(s, { type: 'START_AUCTION', playerId: green, country: 'UK', bid: 5 })).toThrow('major countries')
    expect(() => play(s, { type: 'START_AUCTION', playerId: blue, country: 'US', bid: 5 })).toThrow("It isn't your turn.")
    const opened = play(s, { type: 'START_AUCTION', playerId: green, country: 'US', bid: 5 })
    expect(() => play(opened, { type: 'BID', playerId: blue, amount: 5 })).toThrow('more than $5')
    expect(opened.game.players[green].executives).toBe(s.game.players[green].executives - 1)
  })

  it('R-INV-01: a country with no bank stock cannot be auctioned', () => {
    const s = atInvestment((g) => {
      g.bank.RUSSIA = 0
    })
    expect(() => play(s, { type: 'START_AUCTION', playerId: s.game.seatOrder[0], country: 'RUSSIA', bid: 5 })).toThrow('no Russia shares')
  })

  it('R-INV-04: a full country replaces an opponent cube (winner picks); all-mine places nothing', () => {
    const full = atInvestment((g) => {
      const [, gs, bb] = g.seatOrder
      g.countries.RUSSIA.squares[0].occupant = gs
      g.countries.RUSSIA.squares[1].occupant = bb
    })
    const [green, blue, red, yellow] = full.game.seatOrder
    let s = run(full, [
      { type: 'START_AUCTION', playerId: green, country: 'RUSSIA', bid: 3 },
      { type: 'PASS_BID', playerId: blue },
      { type: 'PASS_BID', playerId: red },
      { type: 'PASS_BID', playerId: yellow },
    ])
    expect(s.game.prompt).toMatchObject({ kind: 'chooseSquare', options: [0, 1] })
    const redSupply = s.game.players[red].supply
    s = play(s, { type: 'CHOOSE_SQUARE', playerId: green, square: 1 })
    expect(s.game.countries.RUSSIA.squares[1].occupant).toBe(green)
    expect(s.game.players[red].supply).toBe(redSupply + 1)

    const mine = atInvestment((g) => {
      g.countries.RUSSIA.squares[0].occupant = g.seatOrder[0]
      g.countries.RUSSIA.squares[1].occupant = g.seatOrder[0]
    })
    const supply = mine.game.players[green].supply
    s = run(mine, [
      { type: 'START_AUCTION', playerId: green, country: 'RUSSIA', bid: 3 },
      { type: 'PASS_BID', playerId: blue },
      { type: 'PASS_BID', playerId: red },
      { type: 'PASS_BID', playerId: yellow },
    ])
    expect(s.game.players[green].supply).toBe(supply)
    expect(s.game.prompt).toEqual({ kind: 'investTurn', playerId: blue })
  })
})

describe('Private sale (R-INV-07..09)', () => {
  it('the highest bidder pays the seller, takes the share and replaces a seller cube', () => {
    let s = atInvestment()
    const [green, blue, red, yellow] = s.game.seatOrder
    s = run(s, [
      { type: 'START_PRIVATE_SALE', playerId: green, country: 'US', minPrice: 5 },
      // [AMBIG-22]: the first bid may equal the minimum.
      { type: 'BID', playerId: blue, amount: 5 },
      { type: 'BID', playerId: red, amount: 6 },
      { type: 'PASS_BID', playerId: yellow },
      { type: 'BID', playerId: blue, amount: 8 },
      { type: 'PASS_BID', playerId: red },
    ])
    expect(s.game.players[green].cash).toBe(38)
    expect(s.game.players[blue].cash).toBe(22)
    expect(s.game.players[green].shares.US).toBe(0)
    expect(s.game.players[blue].shares.US).toBe(1)
    expect(s.game.countries.US.squares[0].occupant).toBe(blue)
    // No reverse auction follows a private sale.
    expect(s.game.prompt).toEqual({ kind: 'investTurn', playerId: blue })
  })

  it('with no bids the action is consumed with no effect', () => {
    let s = atInvestment()
    const [green, blue, red, yellow] = s.game.seatOrder
    s = run(s, [
      { type: 'START_PRIVATE_SALE', playerId: green, country: 'US', minPrice: 50 },
      { type: 'PASS_BID', playerId: blue },
      { type: 'PASS_BID', playerId: red },
      { type: 'PASS_BID', playerId: yellow },
    ])
    expect(s.game.players[green].shares.US).toBe(1)
    expect(s.game.players[green].cash).toBe(30)
    expect(s.game.players[green].executives).toBe(1)
    expect(s.game.prompt).toEqual({ kind: 'investTurn', playerId: blue })
  })

  it('rejects a first bid under the minimum, selling a share you lack, and a seller bidding', () => {
    const s = atInvestment()
    const [green, blue] = s.game.seatOrder
    expect(() => play(s, { type: 'START_PRIVATE_SALE', playerId: green, country: 'CHINA', minPrice: 5 })).toThrow('a share you own')
    const open = play(s, { type: 'START_PRIVATE_SALE', playerId: green, country: 'US', minPrice: 5 })
    expect(() => play(open, { type: 'BID', playerId: blue, amount: 4 })).toThrow('at least $5')
    expect(() => play(open, { type: 'BID', playerId: green, amount: 9 })).toThrow("It isn't your turn.")
  })
})

describe('Pass (R-INV-10)', () => {
  it('uses an executive and nothing else; the player can still act later', () => {
    const s = atInvestment()
    const green = s.game.seatOrder[0]
    const after = play(s, { type: 'INVEST_PASS', playerId: green })
    expect(after.game.players[green].executives).toBe(s.game.players[green].executives - 1)
    expect(after.game.players[green].cash).toBe(30)
  })
})

describe('forced moves need no answer', () => {
  it('the phase skips players with an empty pool', () => {
    let s = atInvestment((g) => {
      g.players[g.seatOrder[1]].executives = 0
    })
    const [green, , red] = s.game.seatOrder
    s = play(s, { type: 'INVEST_PASS', playerId: green })
    expect(s.game.prompt).toEqual({ kind: 'investTurn', playerId: red })
    expect(corpPlayer(s, 'BIG_BROTHER')).toBe(red)
  })
})

// The turn, trading, the money a placement moves, forced sales, the end and
// leaving — RULES.md §3 and §5–§8, with the rulebook's worked examples.

import { describe, expect, it } from 'vitest'
import { applyAction, type GameState as PlatformState } from '@game-platform/sdk'
import { cellOf, gameDefinition, type GameState } from '../rules'
import { arrange, dice, newGame, play, roll } from '../testing'
import type { Colour, GameData } from '../types'

function put(game: GameData, row: number, col: number, colour: Colour): void {
  game.board[cellOf(row, col)] = colour
}

/**
 * A new game with nobody holding shares (as rules version 1 started), so a
 * scenario's dividends and falls come only from the holdings it sets up.
 */
function emptyHanded(params: Parameters<typeof newGame>[0] = {}): GameState {
  return arrange(newGame(params), (g) => {
    for (const id of g.seatOrder) g.players[id].shares = { blue: 0, green: 0, red: 0, yellow: 0 }
    g.bank = { blue: 40, green: 40, red: 40, yellow: 40 }
  })
}

function reject(state: GameState, action: Parameters<typeof play>[1], random = dice('red', 1)): string {
  const result = applyAction(state as PlatformState, action, { random })
  if (result.ok) throw new Error(`${action.type} was accepted`)
  return result.error
}

describe('R-SETUP: genesis', () => {
  it('R-SETUP-01/02: no cash, one share of each colour per player, prices at 0, full supply; seat 1 to act', () => {
    const s = newGame({ players: 4 })
    expect(s.rulesVersion).toBe(2)
    expect(s.status).toBe('active')
    expect(s.phase).toBe('preTrade')
    expect(s.activePlayerId).toBe('p1')
    expect(s.pendingPlayerIds).toEqual(['p1'])
    for (const id of ['p1', 'p2', 'p3', 'p4']) expect(s.game.players[id]).toEqual({ cash: 0, shares: { blue: 1, green: 1, red: 1, yellow: 1 } })
    expect(s.game.prices).toEqual({ blue: 0, green: 0, red: 0, yellow: 0 })
    expect(s.game.supply.red).toBe(20)
    expect(s.game.bank).toEqual({ blue: 36, green: 36, red: 36, yellow: 36 })
    expect(gameDefinition.minPlayers).toBe(3)
    expect(gameDefinition.maxPlayers).toBe(6)
  })

  it('rules version 1 still starts with empty hands and a full bank', () => {
    const s = newGame({ rulesVersion: 1 })
    expect(s.rulesVersion).toBe(1)
    expect(s.game.players.p2).toEqual({ cash: 0, shares: { blue: 0, green: 0, red: 0, yellow: 0 } })
    expect(s.game.bank.red).toBe(40)
  })

  it('the starting shares earn dividends on the first rise', () => {
    let s = roll(newGame(), 'red', 4)
    s = play(s, { type: 'PLACE', playerId: 'p1', cell: cellOf(5, 0), colour: 'red' })
    // Red 0 → 1: p1 takes the new price plus 1 000 on their one share; the others 1 000 each.
    expect([s.game.players.p1.cash, s.game.players.p2.cash, s.game.players.p3.cash]).toEqual([2000, 1000, 1000])
  })

  it('the starting-cash house rule is clamped to whole thousands', () => {
    expect(gameDefinition.normalizeOptions({ startingCash: 12_345 })).toEqual({ startingCash: 12_000 })
    expect(gameDefinition.normalizeOptions({ startingCash: -5 })).toEqual({ startingCash: 0 })
    expect(gameDefinition.normalizeOptions('junk')).toEqual({ startingCash: 0 })
    expect(emptyHanded({ options: { startingCash: 10_000 } }).game.players.p3.cash).toBe(10_000)
  })
})

describe('§5: a turn', () => {
  it('R-TURN-02/03: roll, place an isolated first marker (1 000 F.T., price 1), then trade and end the turn', () => {
    let s = emptyHanded()
    s = roll(s, 'red', 4)
    expect(s.phase).toBe('place')
    expect(s.game.roll).toEqual({ colour: 'red', zone: 4 })
    expect(s.actionHistory.at(-1)!.random).toHaveLength(2)
    s = play(s, { type: 'PLACE', playerId: 'p1', cell: cellOf(5, 0), colour: 'red' })
    expect(s.game.prices.red).toBe(1)
    expect(s.game.players.p1.cash).toBe(1000)
    expect(s.game.supply.red).toBe(19)
    expect(s.phase).toBe('postTrade')
    s = play(s, { type: 'BUY', playerId: 'p1', colour: 'red', count: 1 })
    expect(s.game.players.p1).toEqual({ cash: 0, shares: { blue: 0, green: 0, red: 1, yellow: 0 } })
    s = play(s, { type: 'END_TURN', playerId: 'p1' })
    expect(s.pendingPlayerIds).toEqual(['p2'])
    expect(s.phase).toBe('preTrade')
    expect(s.turn).toBe(2)
  })

  it('refuses the wrong zone, the wrong colour, acting out of turn and placing before rolling', () => {
    let s = emptyHanded()
    expect(reject(s, { type: 'PLACE', playerId: 'p1', cell: 0, colour: 'red' })).toMatch(/can't do that now/)
    expect(reject(s, { type: 'ROLL', playerId: 'p2' })).toMatch(/isn't your turn/)
    s = roll(s, 'red', 1)
    expect(reject(s, { type: 'PLACE', playerId: 'p1', cell: cellOf(9, 11), colour: 'red' })).toMatch(/zone 1/)
    expect(reject(s, { type: 'PLACE', playerId: 'p1', cell: 0, colour: 'blue' })).toMatch(/die says red/)
    expect(reject(s, { type: 'BUY', playerId: 'p1', colour: 'red', count: 1 })).toMatch(/can't do that now/)
  })

  it('R-TURN-02: a white face lets the player choose the colour', () => {
    let s = roll(emptyHanded(), 'white', 2)
    s = play(s, { type: 'PLACE', playerId: 'p1', cell: cellOf(0, 4), colour: 'yellow' })
    expect(s.game.board[cellOf(0, 4)]).toBe('yellow')
  })

  it('R-TURN-03 (AMBIG-2): with nowhere legal to place, the turn is missed at once', () => {
    let s = arrange(emptyHanded(), (g) => {
      for (let row = 0; row < 5; row++) for (let col = 0; col < 4; col++) put(g, row, col, 'blue')
    })
    s = roll(s, 'red', 1)
    expect(s.game.lastRoll).toEqual({ playerId: 'p1', colour: 'red', zone: 1, missed: true })
    expect(s.pendingPlayerIds).toEqual(['p2'])
    expect(s.phase).toBe('preTrade')
    expect(s.actionHistory.at(-1)!.action.type).toBe('ROLL')
  })

  it('ends the turn by itself when there is nothing left to trade', () => {
    // Blue is priced 1, p1 has 1 000 but has already bought 5 this turn and holds nothing sellable.
    let s = arrange(emptyHanded(), (g) => {
      g.boughtThisTurn = 5
    })
    s = roll(s, 'red', 6)
    s = play(s, { type: 'PLACE', playerId: 'p1', cell: cellOf(9, 11), colour: 'red' })
    expect(s.pendingPlayerIds).toEqual(['p2'])
    expect(s.actionHistory).toHaveLength(2)
  })
})

describe('R-SHARE: trading', () => {
  const rich = (s: GameState) =>
    arrange(s, (g) => {
      put(g, 0, 0, 'red')
      put(g, 0, 1, 'red')
      g.players.p1.cash = 50_000
    })

  it('R-SHARE-02 (AMBIG-7): at most 5 bought per turn, across both trade steps', () => {
    let s = play(rich(emptyHanded()), { type: 'BUY', playerId: 'p1', colour: 'red', count: 3 })
    expect(s.game.players.p1.cash).toBe(44_000)
    s = roll(s, 'green', 6)
    s = play(s, { type: 'PLACE', playerId: 'p1', cell: cellOf(9, 11), colour: 'green' })
    expect(reject(s, { type: 'BUY', playerId: 'p1', colour: 'red', count: 3 })).toMatch(/buy 2 more/)
    s = play(s, { type: 'BUY', playerId: 'p1', colour: 'green', count: 2 })
    // Selling is unlimited, and a sale is at the current price.
    s = play(s, { type: 'SELL', playerId: 'p1', colour: 'red', count: 3 })
    expect(s.game.players.p1.shares.red).toBe(0)
    expect(s.game.bank.red).toBe(40)
  })

  it('R-SHARE-03: shares of a colour priced 0 can be bought and sold for nothing, within the 5-share cap', () => {
    let s = newGame()
    s = play(s, { type: 'BUY', playerId: 'p1', colour: 'blue', count: 3 })
    expect(s.game.players.p1).toEqual({ cash: 0, shares: { blue: 4, green: 1, red: 1, yellow: 1 } })
    expect(s.game.bank.blue).toBe(40 - 3 - 3)
    expect(s.actionHistory.at(-1)!.action.type).toBe('BUY')
    s = play(s, { type: 'SELL', playerId: 'p1', colour: 'green', count: 1 })
    expect(s.game.players.p1.shares.green).toBe(0)
    expect(s.game.players.p1.cash).toBe(0)
    expect(reject(s, { type: 'BUY', playerId: 'p1', colour: 'yellow', count: 3 })).toMatch(/buy 2 more/)
  })

  it('R-SHARE-03: no buying beyond your cash or beyond the bank; no selling what you do not hold', () => {
    const s = rich(emptyHanded())
    expect(reject(arrange(s, (g) => (g.players.p1.cash = 3000)), { type: 'BUY', playerId: 'p1', colour: 'red', count: 2 })).toMatch(/costs 4 000 F.T./)
    expect(reject(arrange(s, (g) => (g.bank.red = 1)), { type: 'BUY', playerId: 'p1', colour: 'red', count: 2 })).toMatch(/only 1 red/)
    expect(reject(s, { type: 'SELL', playerId: 'p1', colour: 'red', count: 1 })).toMatch(/hold only 0/)
    expect(reject(s, { type: 'BUY', playerId: 'p1', colour: 'red', count: 0 })).toMatch(/at least 1/)
  })

  it('rules version 1 (AMBIG-3) still refuses trading a colour priced 0', () => {
    const s = newGame({ rulesVersion: 1 })
    expect(reject(s, { type: 'BUY', playerId: 'p1', colour: 'blue', count: 1 })).toMatch(/no price/)
    const holding = arrange(s, (g) => {
      g.players.p1.shares.blue = 1
      g.bank.blue = 39
    })
    expect(reject(holding, { type: 'SELL', playerId: 'p1', colour: 'blue', count: 1 })).toMatch(/worth nothing/)
  })
})

describe('R-PAY: money from a placement', () => {
  it('§6.2 worked example: red 7 → 9 pays A 19 000, B 4 000, C 2 000 and D 14 000', () => {
    let s = arrange(emptyHanded({ players: 4 }), (g) => {
      // A red group of 3, an isolated red one box away, and a red group of 4 elsewhere: price 7.
      for (const col of [0, 1, 2]) put(g, 0, col, 'red')
      put(g, 0, 4, 'red')
      for (const col of [8, 9, 10, 11]) put(g, 9, col, 'red')
      g.players.p1.shares.red = 5
      g.players.p2.shares.red = 2
      g.players.p3.shares.red = 1
      g.players.p4.shares.red = 7
    })
    expect(s.game.prices.red).toBe(7)
    s = roll(s, 'red', 1)
    s = play(s, { type: 'PLACE', playerId: 'p1', cell: cellOf(0, 3), colour: 'red' })
    expect(s.game.prices.red).toBe(9)
    expect(s.game.lastPlacement!.groupSize).toBe(5)
    expect([s.game.players.p1.cash, s.game.players.p2.cash, s.game.players.p3.cash, s.game.players.p4.cash]).toEqual([19_000, 4_000, 2_000, 14_000])
  })

  it('§6.1 example: a new group of 2 elsewhere lifts 3 to 5, and the placer takes 5 000', () => {
    let s = arrange(emptyHanded(), (g) => {
      for (const col of [0, 1, 2]) put(g, 0, col, 'green')
      put(g, 9, 11, 'green')
    })
    s = roll(s, 'green', 6)
    s = play(s, { type: 'PLACE', playerId: 'p1', cell: cellOf(9, 10), colour: 'green' })
    expect(s.game.prices.green).toBe(5)
    expect(s.game.players.p1.cash).toBe(5000)
  })

  it('R-PAY-01 (AMBIG-4): growing a group already at 7 moves nothing and pays the 1 000 bonus', () => {
    let s = arrange(emptyHanded(), (g) => {
      for (let col = 0; col < 7; col++) put(g, 5, col, 'blue')
      g.players.p2.shares.blue = 3
    })
    s = roll(s, 'blue', 4)
    s = play(s, { type: 'PLACE', playerId: 'p1', cell: cellOf(6, 0), colour: 'blue' })
    expect(s.game.prices.blue).toBe(7)
    expect(s.game.players.p1.cash).toBe(1000)
    expect(s.game.players.p2.cash).toBe(0)
  })

  it('R-PAY-03 / §6.2 important point 1: eliminating a group of 4 leaves an isolated marker at 1; holders but not the placer pay the fall', () => {
    let s = arrange(emptyHanded(), (g) => {
      // Yellow: a group of 4 in column 0 of zone 4, plus an isolated marker. Price 4.
      for (const row of [5, 6, 7, 8]) put(g, row, 0, 'yellow')
      put(g, 0, 11, 'yellow')
      // Blue: a group of 4 in column 1, one row lower; placing at (9, 0) touches both and makes blue 5.
      for (const row of [6, 7, 8, 9]) put(g, row, 1, 'blue')
      g.players.p1.shares.yellow = 3
      g.players.p2.shares.yellow = 2
      g.players.p2.cash = 10_000
    })
    expect(s.game.prices).toMatchObject({ yellow: 4, blue: 4 })
    s = roll(s, 'blue', 4)
    s = play(s, { type: 'PLACE', playerId: 'p1', cell: cellOf(9, 0), colour: 'blue' })
    expect(s.game.lastPlacement!.eliminated).toHaveLength(4)
    expect(s.game.prices).toMatchObject({ yellow: 1, blue: 5 })
    expect(s.game.players.p1.cash).toBe(5000)
    expect(s.game.players.p2.cash).toBe(10_000 - 3 * 2 * 1000)
    expect(s.game.supply.yellow).toBe(20)
  })

  it('R-PAY-03 (AMBIG-5): joining two capped groups lowers the price, and other holders pay', () => {
    let s = arrange(emptyHanded(), (g) => {
      for (let col = 0; col < 5; col++) put(g, 5, col, 'red')
      for (let col = 6; col < 11; col++) put(g, 5, col, 'red')
      g.players.p2.shares.red = 1
      g.players.p2.cash = 5000
    })
    expect(s.game.prices.red).toBe(10)
    s = roll(s, 'red', 5)
    s = play(s, { type: 'PLACE', playerId: 'p1', cell: cellOf(5, 5), colour: 'red' })
    expect(s.game.prices.red).toBe(7)
    expect(s.game.players.p1.cash).toBe(1000)
    expect(s.game.players.p2.cash).toBe(2000)
  })
})

describe('R-DEBT: forced sales', () => {
  function fallWith(edit: (g: GameData) => void): GameState {
    let s = arrange(emptyHanded(), (g) => {
      for (const row of [5, 6]) put(g, row, 0, 'yellow')
      for (const row of [7, 8]) put(g, row, 1, 'blue')
      put(g, 9, 11, 'green')
      put(g, 9, 10, 'green')
      edit(g)
    })
    s = roll(s, 'blue', 4)
    // Blue grows to 3 and eliminates the yellow pair: yellow falls 2 → 0.
    return play(s, { type: 'PLACE', playerId: 'p1', cell: cellOf(7, 0), colour: 'blue' })
  }

  it('R-DEBT-02: a debtor with a choice is asked, alone, and may not sell more than the debt needs', () => {
    let s = fallWith((g) => {
      g.players.p2.shares = { blue: 2, green: 2, red: 0, yellow: 3 }
    })
    // p2 owes 6 000; blue (now 3) sells for 1 500, green (2) for 1 000.
    expect(s.game.players.p2.cash).toBe(-6000 + 2 * 1000)
    expect(s.phase).toBe('debts')
    expect(s.activePlayerId).toBeNull()
    expect(s.pendingPlayerIds).toEqual(['p2'])
    expect(reject(s, { type: 'END_TURN', playerId: 'p1' })).toMatch(/can't do that now/)
    expect(reject(s, { type: 'FORCED_SELL', playerId: 'p2', colour: 'red', count: 1 })).toMatch(/no red/)
    expect(reject(s, { type: 'FORCED_SELL', playerId: 'p2', colour: 'blue', count: 3 })).toMatch(/hold only 2/)
    expect(reject(arrange(s, (g) => (g.players.p2.cash = -1000)), { type: 'FORCED_SELL', playerId: 'p2', colour: 'blue', count: 2 })).toMatch(/1 blue share already covers/)
    s = play(s, { type: 'FORCED_SELL', playerId: 'p2', colour: 'blue', count: 2 })
    // 1 000 still owed and only green left to sell: one green is sold automatically,
    // then it's back to p1's second trade step.
    expect(s.game.players.p2).toEqual({ cash: 0, shares: { blue: 0, green: 1, red: 0, yellow: 3 } })
    expect(s.game.autoSales).toEqual([{ playerId: 'p2', colour: 'green', count: 1, proceeds: 1000 }])
    expect(s.pendingPlayerIds).toEqual(['p1'])
    expect(s.phase).toBe('postTrade')
  })

  it('R-DEBT-03: one sellable colour is sold automatically, just enough to cover', () => {
    const s = fallWith((g) => {
      g.players.p3.shares = { blue: 4, green: 0, red: 0, yellow: 3 }
    })
    // Pays 6 000 for yellow, gains 4 000 of blue dividends: owes 2 000; blue sells at 1 500 → 2 shares.
    expect(s.game.players.p3).toEqual({ cash: 1000, shares: { blue: 2, green: 0, red: 0, yellow: 3 } })
    expect(s.phase).toBe('postTrade')
    expect(s.actionHistory.at(-1)!.action.type).toBe('PLACE')
  })

  it('R-DEBT-03 (AMBIG-6): what the shares cannot cover is written off', () => {
    const s = fallWith((g) => {
      g.players.p3.shares = { blue: 1, green: 0, red: 0, yellow: 5 }
    })
    expect(s.game.players.p3).toEqual({ cash: 0, shares: { blue: 0, green: 0, red: 0, yellow: 5 } })
    // Owes 10 000 − 1 000 of dividends; the one blue share fetches 1 500.
    expect(s.game.writeOffs.p3).toBe(9000 - 1500)
  })
})

describe('R-END: the end of the game', () => {
  it('R-END-01/02/03: a price reaching 15 ends the game; shares count at the current price', () => {
    let s = arrange(emptyHanded(), (g) => {
      for (let col = 0; col < 7; col++) put(g, 0, col, 'green')
      for (let col = 0; col < 7; col++) put(g, 9, col, 'green')
      put(g, 4, 11, 'green')
      g.players.p2.shares.green = 1
      g.players.p3.cash = 20_000
    })
    expect(s.game.prices.green).toBe(14)
    s = roll(s, 'green', 3)
    s = play(s, { type: 'PLACE', playerId: 'p1', cell: cellOf(3, 11), colour: 'green' })
    expect(s.status).toBe('completed')
    expect(s.pendingPlayerIds).toEqual([])
    expect(s.game.endReason).toEqual({ kind: 'priceCap', colour: 'green' })
    expect(s.game.finalWealth).toEqual({ p1: 15_000, p2: 1000 + 15_000, p3: 20_000 })
    expect(s.winnerPlayerIds).toEqual(['p3'])
  })

  it('R-END-01: placing the last marker of a colour ends the game; a tie shares the win', () => {
    let s = arrange(emptyHanded(), (g) => {
      g.supply.red = 1
      g.players.p2.cash = 1000
    })
    s = roll(s, 'red', 1)
    s = play(s, { type: 'PLACE', playerId: 'p1', cell: 0, colour: 'red' })
    expect(s.game.endReason).toEqual({ kind: 'markersExhausted', colour: 'red' })
    expect(s.winnerPlayerIds).toEqual(['p1', 'p2'])
    expect(applyAction(s as PlatformState, { type: 'ROLL', playerId: 'p2' }).ok).toBe(false)
  })
})

describe('R-LEAVE: conceding', () => {
  it('the turn player leaving passes the turn on and returns their shares', () => {
    let s = arrange(emptyHanded({ players: 4 }), (g) => {
      g.players.p1.shares.red = 4
      g.bank.red = 36
    })
    s = play(s, { type: 'CONCEDE', playerId: 'p1' } as never)
    expect(s.pendingPlayerIds).toEqual(['p2'])
    expect(s.game.bank.red).toBe(40)
    expect(s.game.players.p1.shares.red).toBe(0)
    // p2 → p3 → p4 → back to p2, skipping p1.
    const cells: Record<string, number> = { p2: cellOf(9, 11), p3: cellOf(9, 9), p4: cellOf(7, 11) }
    for (const id of ['p2', 'p3', 'p4']) {
      s = roll(s, 'red', 6)
      s = play(s, { type: 'PLACE', playerId: id, cell: cells[id], colour: 'red' })
      if (s.phase === 'postTrade') s = play(s, { type: 'END_TURN', playerId: id })
    }
    expect(s.pendingPlayerIds).toEqual(['p2'])
  })

  it('a debtor leaving drops their forced sale', () => {
    let s = arrange(emptyHanded({ players: 4 }), (g) => {
      for (const row of [5, 6]) put(g, row, 0, 'yellow')
      for (const row of [7, 8]) put(g, row, 1, 'blue')
      put(g, 9, 11, 'green')
      put(g, 9, 10, 'green')
      g.players.p2.shares = { blue: 2, green: 2, red: 0, yellow: 3 }
    })
    s = roll(s, 'blue', 4)
    s = play(s, { type: 'PLACE', playerId: 'p1', cell: cellOf(7, 0), colour: 'blue' })
    expect(s.pendingPlayerIds).toEqual(['p2'])
    s = play(s, { type: 'CONCEDE', playerId: 'p2' } as never)
    expect(s.pendingPlayerIds).toEqual(['p1'])
    expect(s.phase).toBe('postTrade')
  })
})

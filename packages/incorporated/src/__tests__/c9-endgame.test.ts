// C9 — End of Game (RULES.md §10).

import { describe, expect, it } from 'vitest'
import { interestIndexOf } from '../sliders'
import { arrange, autoplay, newGame } from '../testing'
import type { GameState } from '../types'

function scoreNow(edit: (g: GameState['game'], ids: string[]) => void, options = {}, players = 4): GameState {
  const base = autoplay(newGame({ options, players }), (x) => x.game.phase === 'investment')
  return arrange(base, (g) => {
    g.prompt = null
    g.queue = [{ t: 'endGame' }]
    g.rdSquare = null
    for (const c of Object.values(g.countries)) for (const sq of c.squares) if (sq.occupant !== 'LOCK') sq.occupant = null
    for (const id of g.seatOrder) {
      g.players[id].cash = 0
      g.players[id].bonds = 0
    }
    edit(g, g.seatOrder)
  })
}

describe('end-game scoring (R-END-01..04)', () => {
  it('the FIN example: Green 4 squares and leader $30, Blue 2 → $10, Red 3 → $15', () => {
    const s = scoreNow((g, [green, blue, red]) => {
      for (const [country, i] of [
        ['US', 0],
        ['US', 1],
        ['US', 2],
        ['EUROZONE', 0],
      ] as const)
        g.countries[country].squares[i].occupant = green
      g.countries.EUROZONE.squares[1].occupant = blue
      g.countries.CHINA.squares[0].occupant = blue
      for (const country of ['JAPAN', 'UK', 'KOREA']) g.countries[country].squares[0].occupant = red
    })
    const [green, blue, red, yellow] = s.game.seatOrder
    const scores = s.game.finalScores!
    expect(scores[green]).toMatchObject({ industryCash: 20, leaderBonus: 10, total: 30 })
    expect(scores[blue].total).toBe(10)
    expect(scores[red].total).toBe(15)
    expect(scores[yellow].total).toBe(0)
    expect(s.status).toBe('completed')
    expect(s.winnerPlayerIds).toEqual([green])
    expect(s.game.players[green].cash).toBe(30)
  })

  it('R-END-03: each unpaid bond costs $20 — cash may go negative', () => {
    const s = scoreNow((g, [a]) => {
      g.players[a].bonds = 3
      g.players[a].cash = 10
    })
    expect(s.game.finalScores![s.game.seatOrder[0]]).toMatchObject({ bondPenalty: 60, total: -50 })
  })

  it('LESS_CRUEL_LOANS: bonds cost the current interest value', () => {
    const s = scoreNow(
      (g, [a]) => {
        g.players[a].bonds = 3
        g.sliders.interest = interestIndexOf(13)
      },
      { lessCruelLoans: true },
    )
    expect(s.game.finalScores![s.game.seatOrder[0]].bondPenalty).toBe(39)
  })

  it('R-END-04: tied players share the win', () => {
    const s = scoreNow((g, [a, b]) => {
      g.players[a].cash = 40
      g.players[b].cash = 40
    })
    expect(s.winnerPlayerIds).toEqual(s.game.seatOrder.slice(0, 2))
  })

  it('counts R&D double, gives no leader on a tie ([AMBIG-15]), and $5 leader bonus with 2 players', () => {
    const tie = scoreNow((g, [a, b]) => {
      g.countries.UK.squares[0].occupant = a
      g.countries.KOREA.squares[0].occupant = b
    })
    expect(tie.game.finalScores![tie.game.seatOrder[0]].leaderBonus).toBe(0)

    const rd = scoreNow((g, [a, b]) => {
      g.rdSquare = { country: 'UK', square: 0 }
      g.countries.UK.squares[0].occupant = a
      g.countries.KOREA.squares[0].occupant = b
    })
    expect(rd.game.finalScores![rd.game.seatOrder[0]]).toMatchObject({ industryCash: 10, leaderBonus: 10 })

    const two = scoreNow(
      (g, [a]) => {
        g.countries.UK.squares[0].occupant = a
      },
      {},
      2,
    )
    expect(two.game.finalScores![two.game.seatOrder[0]].leaderBonus).toBe(5)
  })

  it('a whole passive game ends with scoring after the last Earnings', () => {
    const s = autoplay(newGame())
    expect(s.game.finalScores).not.toBeNull()
    expect(s.game.lastEarnings?.round).toBe(4)
  })
})

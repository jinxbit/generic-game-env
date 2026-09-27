// C3 — Phase 1: Global Outlook and the effect DSL (RULES.md §4).

import { describe, expect, it } from 'vitest'
import { createRandom, type LobbyState } from '@game-platform/sdk'
import { seatPlayers } from '@game-platform/sdk/testing'
import { initialState } from '../engine'
import { normalizeGameOptions } from '../rules'
import { growthPercent, interestValue } from '../sliders'
import { arrange, corpPlayer, newGame, play, withGame } from '../testing'
import type { GameOptions, GameState } from '../types'

function table(players = 4, options: Partial<GameOptions> = {}, seed = 'outlook'): GameState {
  const seats = seatPlayers(players)
  const lobby: LobbyState<GameOptions> = {
    gameId: 'g',
    gameType: 'incorporated',
    rulesVersion: 1,
    playMode: 'live',
    status: 'lobby',
    hiddenInformationEnabled: false,
    turn: 0,
    phase: null,
    activePlayerId: null,
    pendingPlayerIds: [],
    turnOrder: seats.map((s) => s.id),
    players: seats.map((s) => ({ ...s, eliminated: false })),
    winnerPlayerIds: [],
    options: normalizeGameOptions(options),
    actionHistory: [],
  }
  newGame() // registers the game
  return initialState(lobby, createRandom(seed)) as GameState
}

/** The set-up table with `cards` on top of the Outlook pile, run up to the first decision. */
function withOutlook(state: GameState, cards: string[]): GameState {
  return arrange(state, (g) => {
    const rest = [...g.outlookDeck, ...g.outlookOut].filter((c) => c !== null && !cards.includes(c)) as string[]
    g.outlookDeck = [...cards, ...rest.slice(0, g.totalRounds - cards.length)]
    g.outlookOut = rest.slice(g.totalRounds - cards.length)
  })
}

describe('R-OUT-02: the India card from setup', () => {
  it('gives Growth 6%, $16, Stress +2, BoP +2 NATO and reveals 9 payoffs', () => {
    let s = withOutlook(table(), ['INDIA_EMERGING'])
    const bigBrother = corpPlayer(s, 'BIG_BROTHER')

    // unlockSquare(India): Big Brother picks which of the 3 locks.
    expect(s.game.prompt).toMatchObject({ kind: 'outlookChoice', playerId: bigBrother, options: [2, 3, 4] })
    expect(s.pendingPlayerIds).toEqual([bigBrother])
    s = play(s, { type: 'OUTLOOK_CHOICE', playerId: bigBrother, choice: 2 })
    expect(s.game.countries.INDIA.squares[2].occupant).toBeNull()

    // flipAffiliation: a NATO minor in the 3rd World goes SCO.
    expect(s.game.prompt).toMatchObject({ kind: 'outlookChoice', options: ['AFPAK', 'GULF_STATES', 'NORTH_AFRICA', 'SOUTH_AFRICA'] })
    s = play(s, { type: 'OUTLOOK_CHOICE', playerId: bigBrother, choice: 'NORTH_AFRICA' })
    expect(s.game.countries.NORTH_AFRICA.affiliation).toBe('SCO')

    expect(growthPercent(s.game.sliders)).toBe(6)
    expect(interestValue(s.game.sliders)).toBe(16)
    expect(s.game.sliders.stress).toBe(2)
    expect(s.game.sliders.bop).toBe(2)
    expect(s.game.revealed).toHaveLength(9)
    expect(s.game.payoffDeck).toHaveLength(16)
    expect(s.game.phase).toBe('investment')
  })

  it('rejects a choice from anyone but the chooser, or off the list', () => {
    const s = withOutlook(table(), ['INDIA_EMERGING'])
    const bigBrother = corpPlayer(s, 'BIG_BROTHER')
    const other = s.game.seatOrder.find((id) => id !== bigBrother)!
    expect(() => play(s, { type: 'OUTLOOK_CHOICE', playerId: other, choice: 2 })).toThrow("It isn't your turn.")
    expect(() => play(s, { type: 'OUTLOOK_CHOICE', playerId: bigBrother, choice: 0 })).toThrow('Pick one of the offered options.')
  })

  it('goes to the first player when Big Brother is not in the game ([AMBIG-6])', () => {
    let seed = 0
    let s = table(2, {}, `s${seed}`)
    while (Object.values(s.game.players).some((p) => p.corp === 'BIG_BROTHER')) s = table(2, {}, `s${++seed}`)
    s = withOutlook(s, ['INDIA_EMERGING'])
    expect(s.game.prompt).toMatchObject({ kind: 'outlookChoice', playerId: s.game.seatOrder[0] })
  })
})

describe('R-OUT-03: revealing payoffs', () => {
  it('draws from the deck without touching the discard while the deck lasts', () => {
    const s = arrange(table(), (g) => {
      g.outlookDeck = ['PLACEHOLDER_TECH_BOOM']
      g.payoffDiscard = g.payoffDeck.splice(0, 10)
    })
    // Tech Boom: Growth +2 → 4% → 7 payoffs.
    expect(s.game.revealed).toHaveLength(7)
    expect(s.game.payoffDiscard).toHaveLength(10)
    expect(s.game.payoffDeck).toHaveLength(8)
  })

  it('reshuffles the discard pile only when a draw is impossible', () => {
    const s = arrange(table(), (g) => {
      g.outlookDeck = ['PLACEHOLDER_TECH_BOOM']
      g.payoffDiscard = g.payoffDeck.splice(0, 23)
    })
    expect(s.game.revealed).toHaveLength(7)
    expect(s.game.payoffDiscard).toHaveLength(0)
    expect(s.game.payoffDeck).toHaveLength(18)
  })
})

describe('Outlook effect primitives (§4.3)', () => {
  it('lockSquare locks an empty square, the chooser picking', () => {
    let s = withOutlook(table(), ['PLACEHOLDER_SANCTIONS'])
    expect(s.game.prompt).toMatchObject({ kind: 'outlookChoice', options: [0, 1] })
    s = play(s, { type: 'OUTLOOK_CHOICE', playerId: corpPlayer(s, 'BIG_BROTHER'), choice: 1 })
    expect(s.game.countries.RUSSIA.squares[1].occupant).toBe('LOCK')
  })

  it('lockSquare displaces a player cube when no square is empty; the owner keeps the share', () => {
    const base = table()
    const fd = corpPlayer(base, 'FORTRESS_DERIVATIVES')
    const s = withOutlook(
      withGame(base, (g) => {
        g.countries.RUSSIA.squares[0].occupant = 'LOCK'
        g.countries.RUSSIA.squares[1].occupant = fd
        g.players[fd].supply -= 1
        g.players[fd].shares.RUSSIA = 1
      }),
      ['PLACEHOLDER_SANCTIONS'],
    )
    expect(s.game.countries.RUSSIA.squares[1].occupant).toBe('LOCK')
    expect(s.game.players[fd].shares.RUSSIA).toBe(1)
    expect(s.game.players[fd].supply).toBe(base.game.players[fd].supply)
  })

  it('campGainsPower does nothing for a battleground, and moves toward the camp otherwise', () => {
    const s = withOutlook(table(), ['PLACEHOLDER_TRADE_WAR'])
    // campGainsPower(US): BoP +3 → +4 (the NATO end-cap, [AMBIG-2]).
    expect(s.game.sliders.bop).toBe(4)
  })

  it('flipAffiliation with nothing matching does nothing', () => {
    // Regime Change flips an SCO 3rd World minor to NATO: Central Asia is the only one.
    const s = withOutlook(table(), ['PLACEHOLDER_ARAB_SPRING'])
    expect(s.game.countries.CENTRAL_ASIA.affiliation).toBe('NATO')
    const again = arrange(s, (g) => {
      g.queue = [{ t: 'effect', effect: { op: 'flipAffiliation', filter: { zone: 'THIRD_WORLD', major: false }, from: 'SCO', to: 'NATO' }, remaining: 1 }]
      g.prompt = null
    })
    expect(again.game.prompt).toBeNull()
  })

  it('the played card leaves the game; the game ends once the pile is empty', () => {
    const s = withOutlook(table(), ['PLACEHOLDER_TECH_BOOM'])
    expect(s.game.outlookPlayed).toEqual(['PLACEHOLDER_TECH_BOOM'])
    expect(s.game.outlookDeck).toHaveLength(3)
  })
})

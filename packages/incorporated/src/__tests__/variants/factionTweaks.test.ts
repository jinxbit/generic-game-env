// ⚑ FACTION_TWEAKS (RULES.md §11).

import { describe, expect, it } from 'vitest'
import { growthIndexOf, interestValue } from '../../sliders'
import { arrange, autoplay, corpPlayer, dice, newGame, play, withGame } from '../../testing'
import { repaymentCostFor } from '../helpers'
import { at } from './helpers'

const tweaks = { factionTweaks: true }

/** Lobbying with Old Money's act-first offer declined. */
function lobbying(edit: Parameters<typeof at>[2]) {
  const s = at('lobbying', tweaks, edit)
  const om = corpPlayer(s, 'OLD_MONEY')
  expect(s.game.prompt).toEqual({ kind: 'useAbility', playerId: om, ability: 'omLobbyFirst' })
  return play(s, { type: 'USE_ABILITY', playerId: om, use: false })
}

describe('Giant Squid', () => {
  const crisis = (random: Parameters<typeof arrange>[2]) =>
    arrange(
      at('lobbying', tweaks),
      (g) => {
        g.prompt = null
        g.queue = [{ t: 'endPhase' }, { t: 'startEarnings' }]
        g.sliders.growth = growthIndexOf(7)
        g.sliders.stress = 2
        g.revealed = []
      },
      random,
    )

  it('may declare no crisis once per game', () => {
    let s = crisis(dice([2, 12]))
    const squid = corpPlayer(s, 'GIANT_SQUID')
    expect(s.game.prompt).toEqual({ kind: 'crisisDecision', playerId: squid, roll: 2, difficulty: 9 })
    s = play(s, { type: 'CRISIS_DECISION', playerId: squid, decision: 'noCrisis' })
    expect(s.game.lastCrisis).toMatchObject({ intensity: 0, ability: 'noCrisis' })
    expect(s.game.sliders.stress).toBe(2)
    expect(s.game.players[squid].abilitiesUsed.gsCrisis).toBe(true)
  })

  it('or reroll, with the intensity capped at 3', () => {
    let s = crisis(dice([2, 12]))
    const squid = corpPlayer(s, 'GIANT_SQUID')
    s = play(s, { type: 'CRISIS_DECISION', playerId: squid, decision: 'reroll' }, dice([1, 12]))
    expect(s.game.lastCrisis).toMatchObject({ roll: 1, intensity: 3, ability: 'reroll' })
  })

  it('with no crisis all game, repays for $2 less per bond in the final round', () => {
    const s = at('earnings', tweaks, (g) => {
      g.round = g.totalRounds
    })
    const squid = corpPlayer(s, 'GIANT_SQUID')
    expect(repaymentCostFor(s, squid)).toBe(interestValue(s.game.sliders) - 2)
    expect(repaymentCostFor(s, corpPlayer(s, 'BIG_BROTHER'))).toBe(interestValue(s.game.sliders))
  })
})

describe('Big Brother', () => {
  it('may once replace the Outlook draw: discard it, draw 2 from out of the game, play 1', () => {
    let s = newGame({ options: tweaks })
    const bb = corpPlayer(s, 'BIG_BROTHER')
    expect(s.game.prompt).toEqual({ kind: 'useAbility', playerId: bb, ability: 'bbOutlook' })
    const top = s.game.outlookDeck[0]
    s = play(s, { type: 'USE_ABILITY', playerId: bb, use: true })
    const prompt = s.game.prompt
    if (prompt?.kind !== 'pickOutlook') throw new Error('expected pickOutlook')
    expect(prompt.drawn).toHaveLength(2)
    expect(prompt.drawn).not.toContain(top)
    const chosen = prompt.drawn[1] as string
    s = play(s, { type: 'PICK_OUTLOOK', playerId: bb, index: 1 })
    expect(s.game.outlookPlayed).toEqual([chosen])
    expect(s.game.outlookOut).toContain(top)
    expect(s.game.outlookOut).toContain(prompt.drawn[0])
    expect(s.game.outlookDeck).toHaveLength(3)
  })

  it('may take a square an event unlocked, for free', () => {
    let s = newGame({ options: tweaks })
    const bb = corpPlayer(s, 'BIG_BROTHER')
    s = withGame(s, (g) => {
      g.outlookDeck[0] = 'ASIA_INFRASTRUCTURE_BANK'
      g.outlookOut = g.outlookOut.filter((c) => c !== 'ASIA_INFRASTRUCTURE_BANK')
    })
    s = play(s, { type: 'USE_ABILITY', playerId: bb, use: false })
    expect(s.game.prompt).toMatchObject({ kind: 'outlookChoice', playerId: bb, options: [5, 6] })
    s = play(s, { type: 'OUTLOOK_CHOICE', playerId: bb, choice: 6 })
    expect(s.game.prompt).toEqual({ kind: 'chooseSquare', playerId: bb, reason: 'takeUnlocked', country: 'CHINA', options: [6], optional: true })
    s = play(s, { type: 'CHOOSE_SQUARE', playerId: bb, square: 6 })
    expect(s.game.countries.CHINA.squares[6].occupant).toBe(bb)
  })
})

describe('Old Money', () => {
  it('may once act first in Lobbying, with a Power Play', () => {
    let s = autoplay(newGame({ options: tweaks }), (x) => x.game.phase === 'lobbying' || x.game.prompt?.kind === 'useAbility' && x.game.prompt.ability === 'omLobbyFirst')
    const om = corpPlayer(s, 'OLD_MONEY')
    expect(s.game.prompt).toEqual({ kind: 'useAbility', playerId: om, ability: 'omLobbyFirst' })
    s = play(s, { type: 'USE_ABILITY', playerId: om, use: true })
    expect(s.game.prompt).toEqual({ kind: 'lobbyTurn', playerId: om, mustPowerPlay: true, canDefer: false })
    expect(() => play(s, { type: 'LOBBY', playerId: om, event: { kind: 'taxHavens' } })).toThrow('must be a Power Play')
    s = play(s, { type: 'LOBBY', playerId: om, event: { kind: 'powerPlay', zone: 'ASIA', camp: 'NATO' } }, dice([1, 6]))
    // Then the normal order, from the first player.
    expect(s.game.prompt).toMatchObject({ kind: 'lobbyTurn', playerId: s.game.seatOrder[0] })
  })
})

describe('Fortress Derivatives', () => {
  it("may hold back its last executive and use an event someone else took", () => {
    let s = lobbying((g, [fd]) => {
      g.players[fd].executives = 1
    })
    const [fd, gs, bb, om] = s.game.seatOrder
    expect(s.game.prompt).toEqual({ kind: 'lobbyTurn', playerId: fd, mustPowerPlay: false, canDefer: true })
    s = play(s, { type: 'DEFER_EXECUTIVE', playerId: fd })
    s = play(s, { type: 'LOBBY', playerId: gs, event: { kind: 'centralBanks', slider: 'stress', direction: -1 } })
    for (let i = 0; i < 20 && s.game.prompt?.kind === 'lobbyTurn' && s.game.prompt.playerId !== fd; i++) {
      s = play(s, { type: 'LOBBY', playerId: s.game.prompt.playerId, event: { kind: 'taxHavens' } })
    }
    expect(s.game.prompt).toEqual({ kind: 'lobbyTurn', playerId: fd, mustPowerPlay: false, canDefer: false })
    s = play(s, { type: 'LOBBY', playerId: fd, event: { kind: 'centralBanks', slider: 'stress', direction: 1 } })
    expect(s.game.lobbyUsed.CENTRAL_BANKS).toEqual([gs, fd])
    expect(s.game.phase).not.toBe('lobbying')
    void bb
    void om
  })
})

describe('Budget', () => {
  it('Stimulus draws 2 payoffs and keeps 1', () => {
    let s = lobbying((g) => {
      g.revealed = []
      g.payoffDeck = ['TECH', 'MINING', ...g.payoffDeck]
    })
    const fd = s.game.seatOrder[0]
    s = play(s, { type: 'LOBBY', playerId: fd, event: { kind: 'budget', mode: 'stimulus' } })
    expect(s.game.prompt).toEqual({ kind: 'stimulus', playerId: fd, drawn: ['TECH', 'MINING'] })
    const discards = s.game.payoffDiscard.length
    s = play(s, { type: 'STIMULUS_KEEP', playerId: fd, index: 1 })
    expect(s.game.revealed).toEqual(['MINING'])
    expect(s.game.payoffDiscard.slice(discards)).toEqual(['TECH'])
  })
})

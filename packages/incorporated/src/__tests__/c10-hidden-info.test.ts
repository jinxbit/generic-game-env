// C10 — hidden information (RULES.md §1.1, R-EARN-07, ⚑ CLOSED_AUCTION_SCO).

import { describe, expect, it } from 'vitest'
import { redactStateForPlayer, replayActions, type GameState as PlatformState } from '@game-platform/sdk'
import { gameDefinition } from '../rules'
import { autoplay, corpPlayer, newGame, play, simplestMove, withGame } from '../testing'
import type { GameData, GameState } from '../types'

const view = (state: GameState, viewer: string | null) => redactStateForPlayer(state as PlatformState, viewer).game as GameData

describe('redaction', () => {
  it("each player's view hides opponents' cash, never their own", () => {
    const s = autoplay(newGame({ hiddenInformationEnabled: true }), (x) => x.game.phase === 'investment')
    for (const viewer of s.game.seatOrder) {
      const g = view(s, viewer)
      for (const id of s.game.seatOrder) expect(g.players[id].cash).toBe(id === viewer ? s.game.players[id].cash : null)
      // Everything else about a player is public.
      expect(g.players[s.game.seatOrder[0]].bonds).toBe(s.game.players[s.game.seatOrder[0]].bonds)
    }
    expect(Object.values(view(s, null).players).every((p) => p.cash === null)).toBe(true)
  })

  it('hides the payoff deck and discard pile (R-GEN-01) but keeps their sizes', () => {
    const s = withGame(autoplay(newGame(), (x) => x.game.phase === 'investment'), (g) => {
      g.payoffDiscard = ['FIN', 'TECH']
    })
    const g = view(s, s.game.seatOrder[0])
    expect(g.payoffDeck).toHaveLength(s.game.payoffDeck.length)
    expect(g.payoffDeck.every((c) => c === null)).toBe(true)
    expect(g.payoffDiscard).toEqual([null, null])
    expect(g.revealed).toEqual(s.game.revealed)
  })

  it('shows Big Brother, and only Big Brother, the top Outlook card', () => {
    const s = autoplay(newGame(), (x) => x.game.phase === 'investment')
    const bb = corpPlayer(s, 'BIG_BROTHER')
    for (const viewer of [...s.game.seatOrder, null]) {
      const deck = view(s, viewer).outlookDeck
      expect(deck[0]).toBe(viewer === bb ? s.game.outlookDeck[0] : null)
      expect(deck.slice(1).every((c) => c === null)).toBe(true)
    }
    expect(view(s, bb).outlookOut.every((c) => c === null)).toBe(true)
  })

  it('shows the Subsidies peek to the lobbyist only', () => {
    let s = autoplay(newGame(), (x) => x.game.phase === 'lobbying')
    s = withGame(s, (g) => {
      g.revealed = ['FIN']
    })
    const fd = s.game.seatOrder[0]
    s = play(s, { type: 'LOBBY', playerId: fd, event: { kind: 'subsidies' } })
    const mine = view(s, fd).prompt
    const theirs = view(s, s.game.seatOrder[1]).prompt
    expect(mine?.kind === 'subsidies' && mine.peek.every((c) => c !== null)).toBe(true)
    expect(theirs?.kind === 'subsidies' && theirs.peek.every((c) => c === null)).toBe(true)
  })

  it('reveals everything once the game is over', () => {
    const s = autoplay(newGame())
    expect(view(s, s.game.seatOrder[0])).toEqual(s.game)
  })
})

describe('sealed bids (⚑ CLOSED_AUCTION_SCO)', () => {
  it('stay sealed from everyone else until the reveal', () => {
    let s = autoplay(newGame({ options: { closedAuctionSco: true } }), (x) => x.game.phase === 'investment')
    const [fd, gs, bb, om] = s.game.seatOrder
    s = play(s, { type: 'START_AUCTION', playerId: fd, country: 'CHINA' })
    const prompt = s.game.prompt
    if (prompt?.kind !== 'sealedAuction') throw new Error('expected a sealed auction')
    expect(s.pendingPlayerIds).toEqual([fd, gs, bb, om])
    s = play(s, { type: 'SEALED_BID', playerId: gs, auctionId: prompt.auctionId, amount: 7 })
    const entry = s.actionHistory.at(-1)!
    expect(gameDefinition.isActionSecret(entry, s, fd)).toBe(true)
    expect(gameDefinition.isActionSecret(entry, s, gs)).toBe(false)
    const fdView = view(s, fd).prompt
    expect(fdView?.kind === 'sealedAuction' && fdView.bids[gs]).toBeNull()
    expect(redactStateForPlayer(s as PlatformState, fd).actionHistory.at(-1)?.action.type).toBe('HIDDEN_ACTION')
    expect(gameDefinition.describeAction(entry.action as never, s, s).redactedMessage).toBe('{player} submits a sealed bid.')

    for (const id of [fd, bb, om]) s = play(s, { type: 'SEALED_BID', playerId: id, auctionId: prompt.auctionId, amount: id === bb ? 5 : 0 })
    // Revealed: nothing is secret any more, and Giant Squid bought.
    expect(gameDefinition.isActionSecret(entry, s, fd)).toBe(false)
    expect(s.game.players[gs].shares.CHINA).toBe(1)
    expect(s.game.journal.join(' ')).toContain('Sealed bids:')
  })

  it('cannot exceed cash ([AMBIG-17]) and is one per player', () => {
    let s = autoplay(newGame({ options: { closedAuctionSco: true } }), (x) => x.game.phase === 'investment')
    const [fd, gs] = s.game.seatOrder
    s = play(s, { type: 'START_AUCTION', playerId: fd, country: 'CHINA' })
    const prompt = s.game.prompt
    if (prompt?.kind !== 'sealedAuction') throw new Error('expected a sealed auction')
    expect(() => play(s, { type: 'SEALED_BID', playerId: gs, auctionId: prompt.auctionId, amount: 1000 })).toThrow('cannot exceed your cash')
    s = play(s, { type: 'SEALED_BID', playerId: gs, auctionId: prompt.auctionId, amount: 1 })
    expect(() => play(s, { type: 'SEALED_BID', playerId: gs, auctionId: prompt.auctionId, amount: 2 })).toThrow('already bid')
  })
})

describe('repayment decisions', () => {
  it('stay secret until everyone has decided', () => {
    let s = autoplay(newGame(), (x) => x.game.phase === 'lobbying')
    s = withGame(s, (g) => {
      for (const id of g.seatOrder) {
        g.players[id].bonds = 1
        g.players[id].cash = 50
      }
    })
    s = autoplay(s, (x) => x.game.prompt?.kind === 'repayment')
    const prompt = s.game.prompt
    if (prompt?.kind !== 'repayment') throw new Error('expected repayment')
    const [first, second] = prompt.waiting
    s = play(s, { type: 'REPAY', playerId: first, promptId: prompt.promptId, count: 1 })
    expect(gameDefinition.isActionSecret(s.actionHistory.at(-1)!, s, second)).toBe(true)
    const theirs = view(s, second).prompt
    expect(theirs?.kind === 'repayment' && theirs.decisions[first]).toBeNull()
  })
})

describe('replay', () => {
  it('replays a game with dice, draws and choices to the identical state', () => {
    let s = newGame({ options: { factionTweaks: true } })
    const genesis = s
    for (let i = 0; i < 400 && s.status === 'active'; i++) {
      const prompt = s.game.prompt!
      if (prompt.kind === 'lobbyTurn' && !prompt.mustPowerPlay) {
        const zone = (Object.keys(s.game.battlegrounds) as (keyof typeof s.game.battlegrounds)[]).find((z) => s.game.battlegrounds[z] && !s.game.lobbyUsed[`POWER_PLAY:${z}`])
        if (zone) {
          s = play(s, { type: 'LOBBY', playerId: prompt.playerId, event: { kind: 'powerPlay', zone, camp: i % 2 ? 'NATO' : 'SCO' } }, i + 1)
          continue
        }
      }
      s = play(s, simplestMove(s), i + 1)
    }
    expect(s.status).toBe('completed')
    const replayed = replayActions(genesis as PlatformState, s.actionHistory)
    expect(replayed).toEqual(s)
  })
})

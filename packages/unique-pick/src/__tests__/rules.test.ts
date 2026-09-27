import { describe, expect, it } from 'vitest'
import { applyAction, redactStateForPlayer, type LoggedAction, type GameState } from '@game-platform/sdk'
import { act, newGame, pick, pickAll } from '@game-platform/unique-pick/testing'
import { DEFAULT_GAME_OPTIONS, gameDefinition, MAX_PICK, MAX_ROUNDS_RANGE, normalizeGameOptions, PICK_PHASE, TARGET_SCORE_RANGE } from '../rules'

const pickAction = (playerId: string, value: number) => ({ type: 'PICK_NUMBER' as const, playerId, value })

describe('normalizeGameOptions', () => {
  it('fills in missing options from the defaults', () => {
    expect(normalizeGameOptions(undefined)).toEqual(DEFAULT_GAME_OPTIONS)
    expect(normalizeGameOptions(null)).toEqual(DEFAULT_GAME_OPTIONS)
    expect(normalizeGameOptions({ targetScore: 20 })).toEqual({ targetScore: 20, maxRounds: DEFAULT_GAME_OPTIONS.maxRounds })
  })

  it('clamps to the offered ranges and rounds to whole numbers', () => {
    expect(normalizeGameOptions({ targetScore: 1, maxRounds: 999 })).toEqual({ targetScore: TARGET_SCORE_RANGE.min, maxRounds: MAX_ROUNDS_RANGE.max })
    expect(normalizeGameOptions({ targetScore: 99, maxRounds: 0 })).toEqual({ targetScore: TARGET_SCORE_RANGE.max, maxRounds: MAX_ROUNDS_RANGE.min })
    expect(normalizeGameOptions({ targetScore: 7.6, maxRounds: 3.2 })).toEqual({ targetScore: 8, maxRounds: 3 })
  })

  it('treats a non-finite value as the range minimum', () => {
    expect(normalizeGameOptions({ targetScore: Number.NaN, maxRounds: Infinity })).toEqual({ targetScore: TARGET_SCORE_RANGE.min, maxRounds: MAX_ROUNDS_RANGE.min })
  })
})

describe('setup', () => {
  it('opens round 1 with every player pending and no picks in', () => {
    const genesis = newGame({ players: 3 })

    expect(genesis.status).toBe('active')
    expect(genesis.turn).toBe(1)
    expect(genesis.phase).toBe(PICK_PHASE)
    expect(genesis.activePlayerId).toBeNull()
    expect(genesis.pendingPlayerIds).toEqual(['p1', 'p2', 'p3'])
    expect(genesis.game).toEqual({ picks: { p1: null, p2: null, p3: null }, scores: { p1: 0, p2: 0, p3: 0 }, rounds: [] })
  })

  it('normalizes the options it is given', () => {
    expect(newGame({ options: { targetScore: 1000, maxRounds: -3 } }).options).toEqual({ targetScore: TARGET_SCORE_RANGE.max, maxRounds: MAX_ROUNDS_RANGE.min })
  })
})

describe('PICK_NUMBER', () => {
  it('records the pick and drops the player from pending', () => {
    const state = pick(newGame({ players: 3 }), 'p2', 4)
    expect(state.game.picks).toEqual({ p1: null, p2: 4, p3: null })
    expect(state.pendingPlayerIds).toEqual(['p1', 'p3'])
  })

  it('lets a player change their pick while the round is open', () => {
    const state = pick(pick(newGame({ players: 3 }), 'p2', 4), 'p2', 1)
    expect(state.game.picks.p2).toBe(1)
    expect(state.pendingPlayerIds).toEqual(['p1', 'p3'])
  })

  it('accepts every value from 1 to MAX_PICK', () => {
    for (let value = 1; value <= MAX_PICK; value++) expect(applyAction(newGame(), pickAction('p1', value)).ok).toBe(true)
  })

  it.each([
    ['zero', 0],
    ['above MAX_PICK', MAX_PICK + 1],
    ['negative', -1],
    ['a fraction', 2.5],
    ['NaN', Number.NaN],
  ])('rejects %s', (_label, value) => {
    expect(applyAction(newGame(), pickAction('p1', value))).toEqual({ ok: false, error: `Pick a whole number from 1 to ${MAX_PICK}.` })
  })

  it('rejects picking the same number again', () => {
    expect(applyAction(pick(newGame({ players: 3 }), 'p1', 3), pickAction('p1', 3))).toEqual({ ok: false, error: 'You already picked 3.' })
  })

  it('rejects an unknown player', () => {
    expect(applyAction(newGame(), pickAction('p9', 3))).toEqual({ ok: false, error: 'Unknown player: p9' })
  })

  it('rejects an eliminated player', () => {
    const state = act(newGame({ players: 3 }), { type: 'CONCEDE', playerId: 'p2' })
    expect(applyAction(state, pickAction('p2', 3))).toEqual({ ok: false, error: 'You are no longer in this game.' })
  })

  it('rejects a pick outside the picking phase', () => {
    const state: GameState = { ...newGame(), phase: 'elsewhere' }
    expect(applyAction(state, pickAction('p1', 3))).toEqual({ ok: false, error: 'Not in the picking phase.' })
  })
})

describe('round resolution', () => {
  it('waits until nobody is pending', () => {
    const state = pickAll(newGame({ players: 3 }), { p1: 1, p2: 2 })
    expect(state.game.rounds).toEqual([])
    expect(state.turn).toBe(1)
  })

  it('scores unique picks at face value and collisions at zero', () => {
    const state = pickAll(newGame({ players: 3 }), { p1: 2, p2: 5, p3: 5 })

    expect(state.game.rounds).toEqual([{ round: 1, picks: { p1: 2, p2: 5, p3: 5 }, pointsByPlayerId: { p1: 2, p2: 0, p3: 0 } }])
    expect(state.game.scores).toEqual({ p1: 2, p2: 0, p3: 0 })
  })

  it('scores both players in a 2-player round with different picks', () => {
    expect(pickAll(newGame(), { p1: 4, p2: 3 }).game.scores).toEqual({ p1: 4, p2: 3 })
  })

  it('scores nobody when every pick collides', () => {
    expect(pickAll(newGame({ players: 4 }), { p1: 1, p2: 1, p3: 2, p4: 2 }).game.scores).toEqual({ p1: 0, p2: 0, p3: 0, p4: 0 })
  })

  it('opens the next round with every remaining player pending', () => {
    const state = pickAll(newGame({ players: 3 }), { p1: 1, p2: 2, p3: 3 })

    expect(state.turn).toBe(2)
    expect(state.phase).toBe(PICK_PHASE)
    expect(state.pendingPlayerIds).toEqual(['p1', 'p2', 'p3'])
    expect(state.game.picks).toEqual({ p1: null, p2: null, p3: null })
  })

  it('accumulates scores across rounds', () => {
    let state = newGame()
    state = pickAll(state, { p1: 1, p2: 2 })
    state = pickAll(state, { p1: 3, p2: 3 })
    state = pickAll(state, { p1: 4, p2: 1 })
    expect(state.game.scores).toEqual({ p1: 5, p2: 3 })
    expect(state.game.rounds.map((round) => round.round)).toEqual([1, 2, 3])
  })
})

describe('game end', () => {
  it('ends as soon as someone reaches the target score, highest score winning', () => {
    let state = newGame({ options: { targetScore: 6, maxRounds: 10 } })
    state = pickAll(state, { p1: 5, p2: 4 })
    expect(state.status).toBe('active')
    state = pickAll(state, { p1: 1, p2: 2 })

    expect(state.status).toBe('completed')
    expect(state.game.scores).toEqual({ p1: 6, p2: 6 })
    expect(state.winnerPlayerIds).toEqual(['p1', 'p2'])
    expect(state.phase).toBeNull()
    expect(state.pendingPlayerIds).toEqual([])
    // The final round still counts; no further round is opened.
    expect(state.turn).toBe(2)
  })

  it('ends after maxRounds even if nobody reached the target', () => {
    let state = newGame({ players: 3, options: { targetScore: 30, maxRounds: 2 } })
    state = pickAll(state, { p1: 1, p2: 2, p3: 3 })
    state = pickAll(state, { p1: 5, p2: 5, p3: 3 })

    expect(state.status).toBe('completed')
    expect(state.game.scores).toEqual({ p1: 1, p2: 2, p3: 6 })
    expect(state.winnerPlayerIds).toEqual(['p3'])
  })

  it('lets tied top scorers share the win', () => {
    const state = pickAll(newGame({ players: 3, options: { targetScore: 30, maxRounds: 1 } }), { p1: 3, p2: 3, p3: 1 })
    expect(state.game.scores).toEqual({ p1: 0, p2: 0, p3: 1 })
    expect(state.winnerPlayerIds).toEqual(['p3'])

    const tied = pickAll(newGame({ players: 3, options: { targetScore: 30, maxRounds: 1 } }), { p1: 2, p2: 2, p3: 2 })
    expect(tied.winnerPlayerIds).toEqual(['p1', 'p2', 'p3'])
  })

  it('never names an eliminated player a winner', () => {
    let state = newGame({ players: 3, options: { targetScore: 30, maxRounds: 2 } })
    state = pickAll(state, { p1: 1, p2: 1, p3: 5 })
    state = act(state, { type: 'CONCEDE', playerId: 'p3' })
    state = pickAll(state, { p1: 1, p2: 2 })

    expect(state.status).toBe('completed')
    expect(state.winnerPlayerIds).toEqual(['p2'])
  })
})

describe('onPlayerEliminated', () => {
  it('resolves the round when the leaver was the only player still pending', () => {
    const state = act(pickAll(newGame({ players: 3 }), { p1: 2, p2: 4 }), { type: 'CONCEDE', playerId: 'p3' })

    expect(state.game.rounds[0]).toEqual({ round: 1, picks: { p1: 2, p2: 4 }, pointsByPlayerId: { p1: 2, p2: 4 } })
    expect(state.turn).toBe(2)
    expect(state.pendingPlayerIds).toEqual(['p1', 'p2'])
    expect(state.game.picks).toEqual({ p1: null, p2: null })
  })

  it("discards the leaver's own pick without resolving while others are still pending", () => {
    const state = act(pickAll(newGame({ players: 3 }), { p1: 2 }), { type: 'CONCEDE', playerId: 'p1' })

    expect(state.game.picks).toEqual({ p2: null, p3: null })
    expect(state.game.rounds).toEqual([])
    expect(state.pendingPlayerIds).toEqual(['p2', 'p3'])
  })

  it('leaves out a leaver whose pick would otherwise have collided', () => {
    const state = act(pickAll(newGame({ players: 3 }), { p1: 3, p2: 3 }), { type: 'CONCEDE', playerId: 'p2' })
    // p1 is still waiting on p3; once p3 picks, p1's 3 is unique.
    expect(pick(state, 'p3', 1).game.rounds[0].pointsByPlayerId).toEqual({ p1: 3, p3: 1 })
  })
})

describe('redactGame / isActionSecret', () => {
  const entry = (playerId: string, turn: number): LoggedAction => ({ action: pickAction(playerId, 3), turn, timestamp: '' })

  it("masks every open pick but the viewer's own", () => {
    const state = pickAll(newGame({ players: 3 }), { p1: 1, p2: 2 })
    expect(gameDefinition.redactGame(state, 'p2').picks).toEqual({ p1: null, p2: 2, p3: null })
    expect(gameDefinition.redactGame(state, null).picks).toEqual({ p1: null, p2: null, p3: null })
  })

  it('masks nothing once the game is over', () => {
    const completed = act(newGame(), { type: 'CONCEDE', playerId: 'p1' })
    expect(gameDefinition.redactGame(completed, null)).toBe(completed.game)
  })

  it("treats only another player's pick from the open round as secret", () => {
    const state = pickAll(pickAll(newGame({ players: 3 }), { p1: 1, p2: 2, p3: 3 }), { p1: 4 })

    expect(gameDefinition.isActionSecret(entry('p1', 2), state, 'p2')).toBe(true)
    expect(gameDefinition.isActionSecret(entry('p1', 2), state, 'p1')).toBe(false)
    expect(gameDefinition.isActionSecret(entry('p1', 2), state, null)).toBe(true)
    expect(gameDefinition.isActionSecret(entry('p1', 1), state, 'p2')).toBe(false)
    expect(gameDefinition.isActionSecret({ action: { type: 'CONCEDE', playerId: 'p1' }, turn: 2, timestamp: '' }, state, 'p2')).toBe(false)
  })

  it('agree: no viewer can recover a masked pick from their view of the log', () => {
    const state = pickAll(newGame({ players: 4 }), { p1: 1, p2: 5, p3: 2 })
    for (const viewer of ['p1', 'p2', 'p3', 'p4', null]) {
      const view = redactStateForPlayer(state, viewer)
      const leaked = view.actionHistory.filter((logged) => logged.action.type === 'PICK_NUMBER').map((logged) => logged.action.playerId)
      const unmasked = Object.entries(view.game.picks).filter(([, value]) => value !== null).map(([id]) => id)
      expect(leaked.every((id) => unmasked.includes(id!))).toBe(true)
    }
  })
})

describe('describeAction / describePhase', () => {
  it('describes a first pick, a changed pick, and the pick that reveals the round', () => {
    const genesis = newGame()
    const first = pick(genesis, 'p1', 2)
    const changed = pick(first, 'p1', 4)
    const resolving = pick(changed, 'p2', 1)

    expect(gameDefinition.describeAction(pickAction('p1', 2), genesis, first)).toEqual({ message: '{player} picked 2.', redactedMessage: '{player} picked a number.' })
    expect(gameDefinition.describeAction(pickAction('p1', 4), first, changed)).toEqual({ message: '{player} changed their pick to 4.', redactedMessage: '{player} changed their pick.' })
    expect(gameDefinition.describeAction(pickAction('p2', 1), changed, resolving).message).toBe('{player} picked 1. Round 1 revealed.')
  })

  it('labels the picking phase, and anything else generically', () => {
    expect(gameDefinition.describePhase(PICK_PHASE)).toBe('Picking')
    expect(gameDefinition.describePhase(null)).toBe('In progress')
  })

  it('has no forced moves', () => {
    expect(gameDefinition.nextForcedAction(newGame())).toBeNull()
  })
})

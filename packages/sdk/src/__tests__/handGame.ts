// A test-only card game with long-lived secrets — the fixture for the view
// log (../viewLog.ts). Each player draws a secret hand, then players take
// turns playing a card face up (scoring its value) and drawing a secret
// replacement from a deck nobody can see. A card stays secret for as long as
// it's in hand, often most of the game: exactly the case the earlier
// replay-based read protocol handled badly. Not a test file itself.

import type { LoggedAction } from '../actions'
import type { GameDefinition } from '../gameDefinition'
import { registerGame } from '../registry'
import type { GameState } from '../types'

export type HandData = {
  hands: Record<string, (number | null)[]>
  /** Cards still in the deck — masked to [] for every viewer. */
  remaining: number[]
  deckCount: number
  played: { playerId: string; card: number }[]
  scores: Record<string, number>
  /** Cards drawn by each entry, keyed `${turn}:${playerId}` — what isActionSecret checks. */
  drawnAt: Record<string, number[]>
}
export type HandAction = { type: 'DRAW_HAND'; playerId: string } | { type: 'PLAY'; playerId: string; card: number }
export type HandState = GameState<HandData, Record<string, never>>

export const HAND_GAME_TYPE = 'test-hand-race'
export const HAND_SIZE = 5
export const DECK_SIZE = 40

/** A card's value: 1..10. */
export const cardValue = (card: number) => (card % 10) + 1

function inHand(state: HandState, playerId: string, cards: number[]): boolean {
  const hand = state.game.hands[playerId] ?? []
  return cards.some((card) => hand.includes(card))
}

export const handGame: GameDefinition<HandData, Record<string, never>, HandAction> = {
  id: HAND_GAME_TYPE,
  rulesVersion: 1,
  title: 'Hand Race (test)',
  turnLabel: 'Turn',
  minPlayers: 2,
  maxPlayers: 6,
  defaultOptions: {},
  normalizeOptions: () => ({}),
  describeOptions: () => '',

  setup(lobby) {
    const ids = lobby.turnOrder
    return {
      ...lobby,
      status: 'active',
      turn: 0,
      phase: 'deal',
      activePlayerId: null,
      pendingPlayerIds: ids,
      game: {
        hands: Object.fromEntries(ids.map((id) => [id, []])),
        remaining: Array.from({ length: DECK_SIZE }, (_, i) => i),
        deckCount: DECK_SIZE,
        played: [],
        scores: Object.fromEntries(ids.map((id) => [id, 0])),
        drawnAt: {},
      },
    }
  },

  applyAction(state, action, random) {
    const g = state.game
    const draw = (n: number) => {
      const remaining = [...g.remaining]
      const drawn: number[] = []
      for (let i = 0; i < n && remaining.length > 0; i++) {
        const card = random.pick(remaining)
        remaining.splice(remaining.indexOf(card), 1)
        drawn.push(card)
      }
      return { remaining, drawn }
    }
    const key = `${state.turn}:${action.playerId}`
    if (action.type === 'DRAW_HAND') {
      if (state.phase !== 'deal' || !state.pendingPlayerIds.includes(action.playerId)) return { ok: false, error: 'You have already drawn.' }
      const { remaining, drawn } = draw(HAND_SIZE)
      const pendingPlayerIds = state.pendingPlayerIds.filter((id) => id !== action.playerId)
      const game = { ...g, remaining, deckCount: remaining.length, hands: { ...g.hands, [action.playerId]: drawn }, drawnAt: { ...g.drawnAt, [key]: drawn } }
      if (pendingPlayerIds.length > 0) return { ok: true, state: { ...state, pendingPlayerIds, game } }
      const first = state.turnOrder[0]
      return { ok: true, state: { ...state, phase: 'play', turn: 1, activePlayerId: first, pendingPlayerIds: [first], game } }
    }
    if (state.phase !== 'play' || state.activePlayerId !== action.playerId) return { ok: false, error: 'Not your turn.' }
    const hand = g.hands[action.playerId] as number[]
    if (!hand.includes(action.card)) return { ok: false, error: "That card isn't in your hand." }
    const { remaining, drawn } = draw(1)
    const hands = { ...g.hands, [action.playerId]: [...hand.filter((c) => c !== action.card), ...drawn] }
    const game: HandData = {
      ...g,
      remaining,
      deckCount: remaining.length,
      hands,
      played: [...g.played, { playerId: action.playerId, card: action.card }],
      scores: { ...g.scores, [action.playerId]: g.scores[action.playerId] + cardValue(action.card) },
      drawnAt: drawn.length > 0 ? { ...g.drawnAt, [key]: drawn } : g.drawnAt,
    }
    const order = state.turnOrder
    if (order.every((id) => hands[id].length === 0)) {
      const best = Math.max(...order.map((id) => game.scores[id]))
      return { ok: true, state: { ...state, game, status: 'completed', phase: null, activePlayerId: null, pendingPlayerIds: [], winnerPlayerIds: order.filter((id) => game.scores[id] === best) } }
    }
    let next = order[(order.indexOf(action.playerId) + 1) % order.length]
    while (hands[next].length === 0) next = order[(order.indexOf(next) + 1) % order.length]
    return { ok: true, state: { ...state, game, turn: state.turn + 1, activePlayerId: next, pendingPlayerIds: [next] } }
  },

  onPlayerEliminated: (state) => state,
  nextForcedAction: () => null,

  redactGame(state, viewerId) {
    if (state.status !== 'active') return state.game
    const g = state.game
    return {
      ...g,
      remaining: [],
      hands: Object.fromEntries(Object.entries(g.hands).map(([id, hand]) => [id, id === viewerId ? hand : hand.map(() => null)])),
      drawnAt: Object.fromEntries(Object.entries(g.drawnAt).filter(([key, cards]) => key.endsWith(`:${viewerId}`) || !inHand(state, key.split(':')[1], cards))),
    }
  },

  // A draw is secret from everyone else while any card it drew is still in
  // its drawer's hand. PLAY's own card is public, but its entry carries the
  // secret replacement draw, so it's secret for as long as that card is held.
  isActionSecret(entry: LoggedAction, state, viewerId) {
    const playerId = (entry.action as { playerId?: string }).playerId
    if (!playerId || playerId === viewerId || state.status !== 'active') return false
    return inHand(state, playerId, state.game.drawnAt[`${entry.turn}:${playerId}`] ?? [])
  },

  describeAction(action) {
    if (action.type === 'DRAW_HAND') return { message: '{player} drew a hand.' }
    return { message: `{player} played ${cardValue(action.card)} and drew a card.`, redactedMessage: `{player} played ${cardValue(action.card)} and drew a card.` }
  },

  describePhase: (phase) => (phase === 'deal' ? 'Dealing' : 'Playing'),
}

export function registerHandGame(): void {
  registerGame(handGame)
}

/** A simple legal next move: draw while dealing, else the active player plays their lowest card. */
export function nextHandAction(state: HandState): HandAction | null {
  if (state.status !== 'active') return null
  if (state.phase === 'deal') return { type: 'DRAW_HAND', playerId: state.pendingPlayerIds[0] }
  const playerId = state.activePlayerId!
  const hand = state.game.hands[playerId] as number[]
  return { type: 'PLAY', playerId, card: [...hand].sort((a, b) => a - b)[0] }
}

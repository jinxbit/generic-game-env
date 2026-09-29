// Rules for Bauernschlau (RULES.md is the source of truth; its rule ids are
// cited throughout) — this package's `rules` entry point, implementing the
// GameDefinition contract from @game-platform/sdk.
//
// How it's organised: ./board.ts holds everything that is a pure function of
// the board (the hex geometry, which fences are legal, the farms they
// enclose, scoring); this module runs the turn as a small step machine on
// `GameData.step` — `choose` an action, `place` the sheep just drawn — from
// which the envelope's `phase`, `activePlayerId` and `pendingPlayerIds` are
// always derived (`withEnvelope`), so they can never go stale. A turn is one
// action, plus two more for every black sheep turned over
// (`GameData.actionsLeft`).
//
// Hidden information: a sheep is put on the board face down, and only the
// player who drew it knows what it is (R-HIDE-01). `redactGame` masks every
// face-down sheep a viewer didn't place, the bag, and the hand of whoever is
// placing. No action or narration carries a face-down sheep's value, so no log
// entry is ever secret; the draws themselves come from the framework's
// `Random` (R-HIDE-02) and are recorded on the entry that drew them, which the
// framework never shows to a redacted viewer.
//
// Pure and deterministic, like everything the framework runs — imported by
// the Edge Functions too, so keep the `.ts` extensions on relative imports.

import type { ActionDescription, ActionResult, GameDefinition, GameState as PlatformGameState, LobbyState, Random } from '@game-platform/sdk'
import {
  BLACK_SHEEP_BONUS,
  borderStarts,
  cellLabel,
  CELLS,
  emptyFields,
  faceDownCells,
  FARM_POSITIONS,
  farmScore,
  FENCES_BY_PLAYERS,
  fenceMoves,
  isEdgeVertex,
  isEnclosed,
  isFarmFull,
  isField,
  sheepCounters,
  UNENCLOSED_GAP,
} from './board.ts'
import type { Border, EndReason, Farm, GameAction, GameData, GameOptions, PlayerId, Score, Sheep, Step } from './types.ts'

export type * from './types.ts'
export * from './board.ts'

/** This game's GameState. */
export type GameState = PlatformGameState<GameData, GameOptions>

export const DEFAULT_GAME_OPTIONS: GameOptions = { multiRoundScoring: false }

export const STEP_LABELS: Record<Step, string> = {
  choose: 'Choosing an action',
  place: 'Placing sheep',
  ended: 'Game over',
}

export function normalizeGameOptions(raw: unknown): GameOptions {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  return { multiRoundScoring: o.multiRoundScoring === true }
}

/** "+3", "−2", "0" — the sign written out, and formatted by hand so the stored narration is identical in every runtime. */
export function formatPoints(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0'
}

/** How a sheep reads once it's face up. */
export function sheepLabel(sheep: Sheep): string {
  return sheep.black ? 'a black sheep' : formatPoints(sheep.value)
}

/** R-OPEN-01: the first round, when every player must place a sheep and do nothing else. */
export function isOpeningRound(state: Pick<GameState, 'turn'>): boolean {
  return state.turn <= 1
}

/** The actions a player could take in the `choose` step (R-TURN-01). */
export interface ActionChoices {
  draw: boolean
  special: boolean
  flip: boolean
  herd: boolean
  fence: boolean
}

function activeCount(state: GameState): number {
  return state.players.filter((p) => !p.eliminated).length
}

/** R-SPECIAL-01: how many sheep a sheep special takes right now. */
export function specialCount(state: GameState): number {
  const g = state.game
  return Math.min(activeCount(state), g.bag.length, emptyFields(g).length)
}

/** Every fence `playerId` could build right now, on either of their borders (R-FENCE-01..05). */
export function fenceMovesFor(game: GameData, playerId: PlayerId) {
  const farm = game.farms[playerId]
  if (!farm || farm.fencesLeft <= 0) return []
  return [...new Set(farm.borders)].flatMap((b) => fenceMoves(game.borders, b))
}

/** What `playerId` could do if it were their `choose` step in `round` (R-TURN-01, R-OPEN-01). */
export function actionChoices(state: GameState, game: GameData, playerId: PlayerId, round = state.turn): ActionChoices {
  const canDraw = game.bag.length > 0 && emptyFields(game).length > 0
  if (round <= 1) return { draw: canDraw, special: false, flip: false, herd: false, fence: false }
  const faceDown = faceDownCells(game).length > 0
  return {
    draw: canDraw,
    special: !faceDown && canDraw,
    flip: faceDown,
    // The dog leaves its field as it goes, so that field is free for the sheep.
    herd: faceDown && (emptyFields(game).length > 0 || game.dog !== null),
    fence: fenceMovesFor(game, playerId).length > 0,
  }
}

function canAct(state: GameState, game: GameData, playerId: PlayerId, round: number): boolean {
  return Object.values(actionChoices(state, game, playerId, round)).some(Boolean)
}

/** R-SCORE-01..05: everyone's score, as the board stands. */
export function scoresOf(state: GameState, game: GameData = state.game): Record<PlayerId, Score> {
  const standing = game.seatOrder.filter((id) => !isOut(state, id))
  const enclosedFarms = standing.filter((id) => isEnclosed(game, id)).map((id) => farmScore(game, id))
  const lowest = enclosedFarms.length > 0 ? Math.min(...enclosedFarms) : 0
  return Object.fromEntries(
    game.seatOrder.map((id) => {
      const enclosed = isEnclosed(game, id)
      const farm = enclosed ? farmScore(game, id) : state.options.multiRoundScoring ? lowest - UNENCLOSED_GAP : 0
      const fences = -game.farms[id].fencesLeft
      return [id, { enclosed, farm, fences, total: farm + fences }]
    }),
  )
}

class RuleError extends Error {}

function fail(message: string): never {
  throw new RuleError(message)
}

function isOut(state: GameState, playerId: PlayerId): boolean {
  return state.players.find((p) => p.id === playerId)?.eliminated ?? true
}

/** Keeps the envelope in step with `game.step` — `pendingPlayerIds` is derived here and nowhere else. */
export function withEnvelope(state: GameState, game: GameData): GameState {
  if (game.step === 'ended') return { ...state, game, status: 'completed', phase: null, activePlayerId: null, pendingPlayerIds: [] }
  const turnPlayer = game.turnPlayerId
  return { ...state, game, phase: game.step, activePlayerId: turnPlayer, pendingPlayerIds: turnPlayer ? [turnPlayer] : [] }
}

/** R-END-01/02, §7: the game is over — score it. Mutates `game`; returns the winners. */
function finish(state: GameState, game: GameData, reason: EndReason): PlayerId[] {
  game.step = 'ended'
  game.endReason = reason
  // Sheep drawn but never placed go back in the bag.
  game.bag = [...game.bag, ...(game.hand as Sheep[])]
  game.hand = []
  game.actionsLeft = 0
  game.finalScores = scoresOf(state, game)
  const standing = game.seatOrder.filter((id) => !isOut(state, id))
  const best = Math.max(...standing.map((id) => game.finalScores![id].total))
  return standing.filter((id) => game.finalScores![id].total === best)
}

/**
 * R-SETUP-05, R-TURN-03: the next player clockwise who can act, counting a new round
 * each time the turn passes the start player's seat. With nobody left able
 * to act, the game ends (R-END-02). Mutates `game`; returns the new round, or
 * the winners if the game ended.
 */
function startNextTurn(state: GameState, game: GameData): { turn: number; winners: PlayerId[] | null } {
  const seats = game.seatOrder
  const current = seats.indexOf(game.turnPlayerId ?? game.startPlayerId)
  const startSeat = seats.indexOf(game.startPlayerId)
  let round = state.turn
  game.hand = []
  for (let k = 1; k <= seats.length; k++) {
    const seat = (current + k) % seats.length
    if (seat === startSeat) round += 1
    const candidate = seats[seat]
    if (isOut(state, candidate) || !canAct(state, game, candidate, round)) continue
    game.turnPlayerId = candidate
    game.step = 'choose'
    game.actionsLeft = 1
    return { turn: round, winners: null }
  }
  return { turn: state.turn, winners: finish(state, game, { kind: 'stalemate' }) }
}

/**
 * An action is done (the hand is empty): the game may end (R-END-01);
 * otherwise the turn player spends one of their actions and carries on, or
 * the turn passes. Mutates `game`.
 */
function completeAction(state: GameState, game: GameData): { turn: number; winners: PlayerId[] | null } {
  const full = game.seatOrder.find((id) => isFarmFull(game, id))
  if (full) return { turn: state.turn, winners: finish(state, game, { kind: 'farmFull', playerId: full }) }
  game.actionsLeft -= 1
  if (game.actionsLeft > 0 && game.turnPlayerId && canAct(state, game, game.turnPlayerId, state.turn)) {
    game.step = 'choose'
    return { turn: state.turn, winners: null }
  }
  return startNextTurn(state, game)
}

function requireTurn(state: GameState, playerId: PlayerId, step: Step): void {
  const game = state.game
  if (game.turnPlayerId !== playerId) fail("It isn't your turn.")
  if (game.step !== step) fail(game.step === 'place' ? 'Place the sheep you drew first.' : 'You have no sheep to place.')
}

function requireAfterOpening(state: GameState): void {
  if (isOpeningRound(state)) fail('In the first round everyone just places a sheep.')
}

function requireCell(raw: unknown): number {
  if (typeof raw !== 'number' || !isField(raw)) fail('Choose a field on the board.')
  return raw
}

function requireFaceDown(game: GameData, cell: number): void {
  const s = game.sheep[cell]
  if (!s || s.faceUp) fail(`There is no face-down sheep on ${cellLabel(cell)}.`)
}

/** Takes `count` sheep from the bag at random into the hand (R-HIDE-02). Mutates `game`. */
function draw(game: GameData, random: Random, count: number): void {
  const bag = [...game.bag] as Sheep[]
  const hand: Sheep[] = []
  for (let i = 0; i < count; i++) hand.push(bag.splice(random.int(0, bag.length - 1), 1)[0])
  game.bag = bag
  game.hand = hand
  game.step = 'place'
}

/** R-PLACE-01 / R-OPEN-01: take one sheep and look at it. */
function onDraw(state: GameState, game: GameData, playerId: PlayerId, random: Random): void {
  requireTurn(state, playerId, 'choose')
  if (game.bag.length === 0) fail('The bag of sheep is empty.')
  if (emptyFields(game).length === 0) fail('Every field is occupied.')
  draw(game, random, 1)
  game.last = { kind: 'draw', playerId, count: 1, special: false }
}

/** R-SPECIAL-01/02: with no face-down sheep on the board, take one per player. */
function onSpecial(state: GameState, game: GameData, playerId: PlayerId, random: Random): void {
  requireTurn(state, playerId, 'choose')
  requireAfterOpening(state)
  if (faceDownCells(game).length > 0) fail('A sheep special needs every sheep on the board face up.')
  const count = specialCount(state)
  if (count === 0) fail(game.bag.length === 0 ? 'The bag of sheep is empty.' : 'Every field is occupied.')
  draw(game, random, count)
  game.last = { kind: 'draw', playerId, count, special: true }
}

/** Put one drawn sheep face down on an empty field. Returns whether the hand is now empty. */
function onPlace(state: GameState, game: GameData, playerId: PlayerId, rawCell: unknown, rawIndex: unknown): boolean {
  requireTurn(state, playerId, 'place')
  const cell = requireCell(rawCell)
  if (typeof rawIndex !== 'number' || !Number.isInteger(rawIndex) || rawIndex < 0 || rawIndex >= game.hand.length) fail('Choose one of the sheep you drew.')
  if (game.sheep[cell] !== null || game.dog === cell) fail(`${cellLabel(cell)} is already occupied.`)
  const hand = [...game.hand]
  const [sheep] = hand.splice(rawIndex, 1)
  game.sheep = [...game.sheep]
  game.sheep[cell] = { sheep, faceUp: false, placedBy: playerId }
  game.hand = hand
  game.last = { kind: 'place', playerId, cell, remaining: hand.length }
  return hand.length === 0
}

/** R-FLIP-01/02. */
function onFlip(state: GameState, game: GameData, playerId: PlayerId, rawCell: unknown): void {
  requireTurn(state, playerId, 'choose')
  requireAfterOpening(state)
  const cell = requireCell(rawCell)
  requireFaceDown(game, cell)
  const placed = game.sheep[cell]!
  game.sheep = [...game.sheep]
  game.sheep[cell] = { ...placed, faceUp: true }
  if (placed.sheep!.black) game.actionsLeft += BLACK_SHEEP_BONUS
  game.last = { kind: 'flip', playerId, cell, sheep: placed.sheep! }
}

/** R-DOG-01..04. */
function onHerd(state: GameState, game: GameData, playerId: PlayerId, rawFrom: unknown, rawTo: unknown, rawDog: unknown): void {
  requireTurn(state, playerId, 'choose')
  requireAfterOpening(state)
  const from = requireCell(rawFrom)
  requireFaceDown(game, from)
  const to = requireCell(rawTo)
  // The dog leaves wherever it stood, so that field is free for the sheep.
  if (to === from || game.sheep[to] !== null) fail(`Drive the sheep to an empty field, not ${cellLabel(to)}.`)
  let dog: number | null = null
  if (rawDog !== null) {
    dog = requireCell(rawDog)
    if (dog !== from && (dog === to || game.sheep[dog] !== null)) fail(`The dog can stay on ${cellLabel(from)}, go back to the centre or go to an empty field — not ${cellLabel(dog)}.`)
  }
  const placed = game.sheep[from]!
  game.sheep = [...game.sheep]
  game.sheep[from] = null
  game.sheep[to] = { ...placed, faceUp: true }
  game.dog = dog
  if (placed.sheep!.black) game.actionsLeft += BLACK_SHEEP_BONUS
  game.last = { kind: 'herd', playerId, from, to, dog, sheep: placed.sheep! }
}

/** R-FENCE-01..07. */
function onFence(state: GameState, game: GameData, playerId: PlayerId, rawBorder: unknown, rawFrom: unknown, rawTo: unknown): void {
  requireTurn(state, playerId, 'choose')
  requireAfterOpening(state)
  const farm = game.farms[playerId]
  if (typeof rawBorder !== 'number' || !farm.borders.includes(rawBorder)) fail('You can only build on the borders of your own farm.')
  if (farm.fencesLeft <= 0) fail('You have no fences left.')
  const border = game.borders[rawBorder]
  if (border.finished) fail('That border already reaches the edge of the board.')
  const move = fenceMoves(game.borders, rawBorder).find((m) => m.from === rawFrom && m.to === rawTo)
  if (!move) fail(border.path.length === 0 ? 'The first fence must start between the farmhouses and lead outwards.' : 'That fence would turn back, touch another fence or cut a border off from the edge.')
  const path = border.path.length === 0 ? [move.from, move.to] : [...border.path, move.to]
  const finished = isEdgeVertex(move.to)
  game.borders = game.borders.map((b, i): Border => (i === rawBorder ? { ...b, path, builtBy: [...b.builtBy, playerId], finished } : b))
  game.farms = { ...game.farms, [playerId]: { ...farm, fencesLeft: farm.fencesLeft - 1 } }
  game.last = { kind: 'fence', playerId, border: rawBorder, from: move.from, to: move.to, finished }
}

function apply(state: GameState, action: GameAction, random: Random): GameState {
  // A working copy the handlers reassign fields of (never mutate `state`:
  // replay and undo keep it). Every nested record is replaced, not edited.
  const game: GameData = { ...state.game }
  const actor = state.players.find((p) => p.id === action.playerId)
  if (!actor) fail(`Unknown player: ${action.playerId}`)
  if (actor.eliminated) fail('You are no longer in this game.')
  let done = true
  switch (action.type) {
    case 'DRAW_SHEEP':
      onDraw(state, game, action.playerId, random)
      done = false
      break
    case 'SHEEP_SPECIAL':
      onSpecial(state, game, action.playerId, random)
      done = false
      break
    case 'PLACE_SHEEP':
      done = onPlace(state, game, action.playerId, action.cell, action.index)
      break
    case 'FLIP_SHEEP':
      onFlip(state, game, action.playerId, action.cell)
      break
    case 'HERD':
      onHerd(state, game, action.playerId, action.from, action.to, action.dog)
      break
    case 'BUILD_FENCE':
      onFence(state, game, action.playerId, action.border, action.from, action.to)
      break
    default: {
      const unknown: never = action
      fail(`Unknown action: ${String((unknown as { type: unknown }).type)}`)
    }
  }
  if (!done) {
    // Mid-way through placing a sheep special, a farm may already be full.
    const full = game.seatOrder.find((id) => isFarmFull(game, id))
    if (!full) return withEnvelope(state, game)
    const winners = finish(state, game, { kind: 'farmFull', playerId: full })
    return { ...withEnvelope(state, game), winnerPlayerIds: winners }
  }
  const { turn, winners } = completeAction(state, game)
  const next = withEnvelope({ ...state, turn }, game)
  return winners ? { ...next, winnerPlayerIds: winners } : next
}

function nameIn(state: GameState) {
  return (id: PlayerId) => state.players.find((p) => p.id === id)?.displayName ?? 'Someone'
}

function describeLast(before: GameState, after: GameState): string {
  const last = after.game.last
  const name = nameIn(after)
  if (!last) return '{player} acted.'
  switch (last.kind) {
    case 'draw':
      return last.special ? `{player} called a sheep special and took ${last.count} sheep.` : '{player} took a sheep and looked at it.'
    case 'place':
      return `{player} put a sheep face down on ${cellLabel(last.cell)}.${last.remaining > 0 ? ` ${last.remaining} left to place.` : ''}`
    case 'flip':
      return `{player} turned over the sheep on ${cellLabel(last.cell)}: ${sheepLabel(last.sheep)}.${last.sheep.black ? ` Two extra actions!` : ''}`
    case 'herd': {
      const dog = last.dog === last.from ? 'The dog stays there.' : last.dog === null ? 'The dog goes back to the centre.' : `The dog goes to ${cellLabel(last.dog)}.`
      return `{player} set the dog on ${cellLabel(last.from)} and drove the sheep to ${cellLabel(last.to)}: ${sheepLabel(last.sheep)}.${last.sheep.black ? ' Two extra actions!' : ''} ${dog}`
    }
    case 'fence': {
      const [a, b] = after.game.borders[last.border].between
      const parts = [`{player} built a fence on the border between ${name(a)} and ${a === b ? 'themselves' : name(b)}.`]
      if (last.finished) parts.push('That border now reaches the edge.')
      for (const id of after.game.seatOrder) if (isEnclosed(after.game, id) && !isEnclosed(before.game, id)) parts.push(`${name(id)}'s farm is enclosed.`)
      return parts.join(' ')
    }
  }
}

/** The end-of-game line: why it ended, the scores, the winners. */
function describeEnd(after: GameState): string[] {
  const g = after.game
  if (g.step !== 'ended' || !g.endReason || !g.finalScores) return []
  const name = nameIn(after)
  const why = g.endReason.kind === 'farmFull' ? `${name(g.endReason.playerId)}'s farm is enclosed and full` : 'nobody can do anything more'
  const scores = g.seatOrder
    .filter((id) => !isOut(after, id))
    .map((id) => `${name(id)} ${formatPoints(g.finalScores![id].total)}`)
    .join(', ')
  const winners = after.winnerPlayerIds.map(name).join(', ')
  return [`Game over — ${why}. Scores: ${scores}. Winner${after.winnerPlayerIds.length === 1 ? '' : 's'}: ${winners}.`]
}

export const gameDefinition: GameDefinition<GameData, GameOptions, GameAction> = {
  id: 'bauernschlau',
  rulesVersion: 1,
  title: 'Bauernschlau',
  turnLabel: 'Round',
  minPlayers: 2,
  maxPlayers: 6,

  defaultOptions: DEFAULT_GAME_OPTIONS,
  normalizeOptions: normalizeGameOptions,
  describeOptions(options) {
    return options.multiRoundScoring ? 'Multi-round scoring' : 'Standard rules'
  },

  setup(lobby: LobbyState<GameOptions>, random: Random) {
    const seats = [...lobby.turnOrder]
    const n = seats.length
    const positions = FARM_POSITIONS[n]
    // R-SETUP-05: a random start player; play goes clockwise, in seat order.
    const startPlayerId = seats[random.int(0, n - 1)]
    const farms: Record<PlayerId, Farm> = Object.fromEntries(
      seats.map((id, i) => [id, { position: positions[i], fencesLeft: FENCES_BY_PLAYERS[n], borders: [(i - 1 + n) % n, i] as [number, number] }]),
    )
    const borders: Border[] = seats.map((id, i) => ({
      between: [id, seats[(i + 1) % n]],
      starts: borderStarts(positions[i], positions[(i + 1) % n]),
      path: [],
      builtBy: [],
      finished: false,
    }))
    const game: GameData = {
      seatOrder: seats,
      farms,
      borders,
      sheep: CELLS.map(() => null),
      dog: null,
      bag: sheepCounters(),
      hand: [],
      startPlayerId,
      turnPlayerId: startPlayerId,
      step: 'choose',
      actionsLeft: 1,
      last: null,
      endReason: null,
      finalScores: null,
    }
    return withEnvelope({ ...lobby, status: 'active', turn: 1 } as GameState, game)
  },

  applyAction(state, action, random): ActionResult<GameState> {
    if (state.status !== 'active') return { ok: false, error: 'The game is over.' }
    try {
      return { ok: true, state: apply(state, action, random) }
    } catch (error) {
      if (error instanceof RuleError) return { ok: false, error: error.message }
      throw error
    }
  },

  onPlayerEliminated(state, playerId) {
    // R-LEAVE-01: their farm and fences stay on the board; sheep they'd drawn go back in the bag.
    // Only called while the game goes on: the framework ends it itself when one player is left.
    const game: GameData = { ...state.game }
    if (game.turnPlayerId !== playerId) return withEnvelope(state, game)
    game.bag = [...game.bag, ...(game.hand as Sheep[])]
    const { turn, winners } = startNextTurn(state, game)
    const next = withEnvelope({ ...state, turn }, game)
    return winners ? { ...next, winnerPlayerIds: winners } : next
  },

  nextForcedAction(state) {
    // One sheep in hand and one empty field: nothing to decide.
    const g = state.game
    if (state.status !== 'active' || g.step !== 'place' || g.hand.length !== 1 || !g.turnPlayerId) return null
    const empty = emptyFields(g)
    return empty.length === 1 ? { type: 'PLACE_SHEEP', playerId: g.turnPlayerId, cell: empty[0], index: 0 } : null
  },

  redactGame(state, viewerId) {
    // R-HIDE-03: at the end every sheep is shown.
    if (state.status !== 'active') return state.game
    const g = state.game
    return {
      ...g,
      bag: g.bag.map(() => null),
      hand: viewerId !== null && viewerId === g.turnPlayerId ? g.hand : g.hand.map(() => null),
      sheep: g.sheep.map((s) => (s && !s.faceUp && s.placedBy !== viewerId ? { ...s, sheep: null } : s)),
    }
  },

  isActionSecret() {
    // No action or narration names a face-down sheep (R-HIDE-01).
    return false
  },

  describeAction(_action, before, after): ActionDescription {
    return { message: [describeLast(before, after), ...describeEnd(after)].join(' ') }
  },

  describePhase(phase) {
    return phase && phase in STEP_LABELS ? STEP_LABELS[phase as Step] : 'In progress'
  },
}

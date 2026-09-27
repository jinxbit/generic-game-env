// The working context every rule module mutates while one action is applied.
//
// Rules never mutate their input (packages/unique-pick/README.md, rule 3):
// ./rules.ts deep-copies `GameState.game` into `Ctx.g` once per action, the
// modules edit that copy, and the result becomes the new state. A rejected
// action throws RuleError part-way through, which simply discards the copy.

import type { GameState as PlatformGameState, Random } from '@game-platform/sdk'
import { CORPORATIONS, type CorporationDef } from './data/corporations.ts'
import type { CorporationId, CorpPlayer, GameData, GameOptions, PlayerId, Prompt, Task } from './types.ts'

/** This game's GameState. */
export type GameState = PlatformGameState<GameData, GameOptions>

export interface Ctx {
  /** The state the action is being applied to — envelope fields only; read `g` for the game. */
  readonly state: GameState
  readonly options: GameOptions
  readonly random: Random
  /** The mutable working copy of `state.game`. */
  g: GameData
}

/** An illegal action: ./rules.ts turns it into `{ ok: false, error }`. */
export class RuleError extends Error {}

export function fail(message: string): never {
  throw new RuleError(message)
}

export function corporation(id: CorporationId): CorporationDef {
  const def = CORPORATIONS.find((c) => c.id === id)
  if (!def) throw new Error(`Unknown corporation: ${id}`)
  return def
}

export function isEliminated(ctx: Ctx, playerId: PlayerId): boolean {
  return ctx.state.players.find((p) => p.id === playerId)?.eliminated ?? true
}

/** Players still in the game, in play order. */
export function activeSeats(ctx: Ctx): PlayerId[] {
  return ctx.g.seatOrder.filter((id) => !isEliminated(ctx, id))
}

/** Seated players at the start — what "a 2-player game" means for scoring (R-EARN-05, R-END-02). */
export const playerCount = (ctx: Ctx): number => ctx.g.seatOrder.length

export function player(ctx: Ctx, playerId: PlayerId): CorpPlayer {
  const p = ctx.g.players[playerId]
  if (!p) fail(`Unknown player: ${playerId}`)
  return p
}

/** A player's cash on the true (server) state — never null there. */
export function cashOf(ctx: Ctx, playerId: PlayerId): number {
  return player(ctx, playerId).cash ?? 0
}

export function addCash(ctx: Ctx, playerId: PlayerId, amount: number): void {
  const p = player(ctx, playerId)
  p.cash = (p.cash ?? 0) + amount
}

export function displayName(ctx: Ctx, playerId: PlayerId): string {
  return ctx.state.players.find((p) => p.id === playerId)?.displayName ?? playerId
}

/**
 * Active players clockwise after `from` (exclusive), wrapping round to
 * `from` itself last when it is still active. `from` null starts at the
 * first player.
 */
export function clockwiseAfter(ctx: Ctx, from: PlayerId | null): PlayerId[] {
  const order = ctx.g.seatOrder
  const start = from === null ? 0 : order.indexOf(from) + 1
  const rotated = [...order.slice(start), ...order.slice(0, start)]
  return rotated.filter((id) => !isEliminated(ctx, id))
}

/** The first active player clockwise after `from` (the first player when null) that satisfies `test`. */
export function nextSeat(ctx: Ctx, from: PlayerId | null, test: (id: PlayerId) => boolean): PlayerId | null {
  return clockwiseAfter(ctx, from).find(test) ?? null
}

/** The corporation's player, if it's in the game and not eliminated. */
export function playerWithCorp(ctx: Ctx, corp: CorporationId): PlayerId | null {
  return activeSeats(ctx).find((id) => ctx.g.players[id].corp === corp) ?? null
}

/**
 * Who makes Big Brother's Outlook choices (R-OUT-02): Big Brother, or the
 * first player when Big Brother isn't in the game ([AMBIG-6]).
 */
export function outlookChooser(ctx: Ctx): PlayerId {
  return playerWithCorp(ctx, 'BIG_BROTHER') ?? activeSeats(ctx)[0]
}

export function note(ctx: Ctx, line: string): void {
  ctx.g.journal.push(line)
}

export function setPrompt(ctx: Ctx, prompt: Prompt): void {
  ctx.g.prompt = prompt
}

/** Queue `tasks` to run next, before anything already queued. */
export function runNext(ctx: Ctx, ...tasks: Task[]): void {
  ctx.g.queue.unshift(...tasks)
}

/** The prompt the game is waiting on, narrowed to `kind` and owned by `playerId` — or a RuleError. */
export function expectPrompt<K extends Prompt['kind']>(ctx: Ctx, kind: K, playerId: PlayerId): Extract<Prompt, { kind: K }> {
  const prompt = ctx.g.prompt
  if (!prompt || prompt.kind !== kind) fail(`That move isn't possible right now.`)
  const owner = 'playerId' in prompt ? prompt.playerId : prompt.kind === 'auction' ? prompt.current : null
  if (owner !== null && owner !== playerId) fail("It isn't your turn.")
  return prompt as Extract<Prompt, { kind: K }>
}

export const isFinalRound = (ctx: Ctx): boolean => ctx.g.round >= ctx.g.totalRounds

export function requireWhole(value: unknown, what: string, min = 0): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) fail(`${what} must be a whole number of at least ${min}.`)
  return value
}

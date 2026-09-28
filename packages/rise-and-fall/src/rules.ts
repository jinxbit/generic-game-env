// Rise & Fall — this package's `rules` entry point, implementing the
// GameDefinition contract from @game-platform/sdk.
//
// The rules are the Rise & Fall engine (./engine/, carried over from the
// game's original standalone app) run through ./adapter.ts, which maps the
// platform's envelope + GameData onto the engine's flat state and back. The
// engine's content (./content/*.json, resolved per game by ./gameContent.ts)
// is its rulebook data: unit kinds and their actions, terrain, achievements,
// Tales. ./content/README.md documents every field.
//
// What the framework took over from the standalone engine: the action log,
// undo/redo, admin mode, CONCEDE's bookkeeping (the engine still runs its own
// concede in `onPlayerEliminated`) and converging forced follow-ups
// (`nextForcedAction` hands the engine's nextForcedFollowUp to the
// framework's loop).
//
// Hidden information: the three simultaneous phases each keep one secret
// until everyone has acted — which card a player chose (select cards), which
// cards they moved to decline, and which card they bought back (purchase).
// `redactGame` shows other players the state as it was before those moves;
// `isActionSecret` hides the matching log entries for exactly as long.
//
// No randomness in play: the only draws are at setup, for "build alone" with
// a random builder or unit-placement order.
//
// Pure and deterministic, like everything the framework runs — imported by
// the Edge Functions too, so keep the `.ts` extensions on relative imports.

import type { ActionDescription, ActionResult, GameDefinition, LobbyState, LoggedAction, Random } from '@game-platform/sdk'
import { resolveHistory } from '@game-platform/sdk'
import { buildEngineGenesis, phaseOf, toEngine, toPlatform, type GameState } from './adapter.ts'
import { concedeDuringBoardSetup } from './concede.ts'
import { listGameLengthBounds, listMapTemplates, listTales } from './content/resolveContent.ts'
import { applyGameAction, nextForcedFollowUp } from './engine/applyAction.ts'
import { moveCard } from './engine/cards.ts'
import { describeCascade, describePrimaryAction, type DraftEvent } from './engine/gameLog.ts'
import { calculateVPBreakdown } from './engine/victoryPoints.ts'
import { resolveGameContent, type GameContent } from './gameContent.ts'
import type { GameAction, GameData, GameOptions, MapMode } from './types.ts'

export type * from './types.ts'
export type { GameState, Phase } from './adapter.ts'
export { engineGenesisOf, toEngine } from './adapter.ts'
export { resolveGameContent, type GameContent } from './gameContent.ts'

export const GAME_ID = 'rise-and-fall'
export const MIN_PLAYERS = 2
/** content/resources.json's global supply is defined for up to eight players. */
export const MAX_PLAYERS = 8

const GAME_LENGTH_BOUNDS = listGameLengthBounds()

export const DEFAULT_GAME_OPTIONS: GameOptions = {
  gameLength: GAME_LENGTH_BOUNDS.default,
  activeTaleIds: [],
  mapMode: 'together',
  mapTemplateId: null,
  soloBuilder: 'host',
  soloBuilderUnitOrder: 'last',
}

const MAP_MODES: readonly MapMode[] = ['together', 'solo', 'template']

/** Fills in and clamps options from a stored settings row — accepts anything. */
export function normalizeGameOptions(raw: unknown): GameOptions {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof GameOptions, unknown>>
  const lengthInput = typeof input.gameLength === 'number' && Number.isFinite(input.gameLength) ? Math.round(input.gameLength) : GAME_LENGTH_BOUNDS.default
  const gameLength = Math.min(GAME_LENGTH_BOUNDS.max, Math.max(GAME_LENGTH_BOUNDS.min, lengthInput))
  const knownTales = new Set(listTales().map((t) => t.id))
  const activeTaleIds = Array.isArray(input.activeTaleIds)
    ? [...new Set(input.activeTaleIds.filter((id): id is string => typeof id === 'string' && knownTales.has(id)))]
    : []
  const templateIds = new Set(listMapTemplates().map((t) => t.id))
  const mapTemplateId = typeof input.mapTemplateId === 'string' && templateIds.has(input.mapTemplateId) ? input.mapTemplateId : null
  let mapMode: MapMode = MAP_MODES.includes(input.mapMode as MapMode) ? (input.mapMode as MapMode) : 'together'
  if (mapMode === 'template' && !mapTemplateId) mapMode = 'together'
  return {
    gameLength,
    activeTaleIds,
    mapMode,
    mapTemplateId: mapMode === 'template' ? mapTemplateId : null,
    soloBuilder: input.soloBuilder === 'random' ? 'random' : 'host',
    soloBuilderUnitOrder: input.soloBuilderUnitOrder === 'random' ? 'random' : 'last',
  }
}

export function describeGameOptions(options: GameOptions): string {
  const parts = [`${options.gameLength} achievement${options.gameLength === 1 ? '' : 's'} to end`]
  if (options.mapMode === 'solo') parts.push(options.soloBuilder === 'random' ? 'map built by a random player' : 'map built by the host')
  if (options.mapMode === 'template') {
    const template = listMapTemplates().find((t) => t.id === options.mapTemplateId)
    parts.push(`map: ${template?.name ?? options.mapTemplateId}`)
  }
  if (options.activeTaleIds.length > 0) {
    const names = new Map(listTales().map((t) => [t.id, t.name]))
    parts.push(`Tales: ${options.activeTaleIds.map((id) => names.get(id) ?? id).join(', ')}`)
  }
  return parts.join(' · ')
}

export const PHASE_LABELS: Record<string, string> = {
  placeTiles: 'Placing tiles',
  placeUnits: 'Placing starting units',
  selectCards: 'Choosing cards',
  actions: 'Actions',
  decline: 'Decline',
  purchase: 'Buying back',
}

/** The engine content for this game — its player count, Tales and game length. */
export function contentFor(state: Pick<GameState, 'options' | 'players'>): GameContent {
  return resolveGameContent(state.options.activeTaleIds, state.options.gameLength, state.players.length)
}

/** Each player's total victory points right now — what the end-of-game screen shows as the final score. */
export function victoryPointsOf(state: GameState): Record<string, number> {
  const content = contentFor(state)
  const breakdown = calculateVPBreakdown(toEngine(state), content.achievementContent, content.taleContent)
  return Object.fromEntries(state.players.map((player) => [player.id, breakdown[player.id]?.total ?? 0]))
}

function applyEngineAction(state: GameState, action: GameAction): ActionResult<GameState> {
  const content = contentFor(state)
  const result = applyGameAction(toEngine(state), action, content.unitContent, content.achievementContent, content.boardGenerationContent, content.taleContent)
  if (!result.ok) return result
  return { ok: true, state: toPlatform(result.state, state) }
}

/** Draws "build alone"'s random builder and order, in a fixed order: builder, then order. */
function resolveSeating(lobby: LobbyState<GameOptions>, random: Random): GameData['seating'] {
  const seats = [...lobby.turnOrder]
  if (lobby.options.mapMode !== 'solo') return { turnOrder: seats, builderId: null }
  const builderId = lobby.options.soloBuilder === 'random' ? random.pick(seats) : seats[0]
  const turnOrder = lobby.options.soloBuilderUnitOrder === 'random' ? random.shuffle(seats) : [...seats.filter((id) => id !== builderId), builderId]
  return { turnOrder, builderId }
}

// ---------------------------------------------------------------------------
// Hidden information

/** The select-cards secret: others' picks stay hidden while anyone is still choosing. */
function choicesHidden(game: GameData): boolean {
  return game.status === 'active' && game.roundPhase === 'selectCards' && game.pendingPlayerIds.length > 0
}

/**
 * Each player's buy-back in the purchase phase still open — at most one each.
 * From the log's in-effect entries of this round: the engine keeps no record
 * of it on the state.
 */
function purchasesThisPhase(state: GameState): Map<string, string> {
  const byPlayerId = new Map<string, string>()
  if (state.game.status !== 'active' || state.game.roundPhase !== 'purchase') return byPlayerId
  for (const { action, turn } of resolveHistory(state.actionHistory).effective) {
    if (turn === state.turn && action.type === 'PURCHASE_CARD') byPlayerId.set(action.playerId, (action as unknown as { cardId: string }).cardId)
  }
  return byPlayerId
}

function redactGame(state: GameState, viewerId: string | null): GameData {
  const game = state.game
  const hideChoices = choicesHidden(game)
  const inDecline = game.status === 'active' && game.roundPhase === 'decline'
  const purchases = purchasesThisPhase(state)
  const declineSources = game.declineSourceZoneByCardId ?? {}

  const chosenCardIdByPlayerId = hideChoices
    ? Object.fromEntries(Object.entries(game.chosenCardIdByPlayerId).map(([id, cardId]) => [id, id === viewerId ? cardId : null]))
    : game.chosenCardIdByPlayerId

  const players = game.players.map((holdings) => {
    if (holdings.id === viewerId) return holdings
    // moveCard works on a whole engine Player; holdings carry every zone it touches.
    type ZonePlayer = Parameters<typeof moveCard>[0]
    let shown = holdings as unknown as ZonePlayer
    if (inDecline) {
      for (const cardId of holdings.declineCardIds) {
        const source = declineSources[cardId]
        if (source) shown = moveCard(shown, cardId, source)
      }
    }
    const bought = purchases.get(holdings.id)
    if (bought && !shown.declineCardIds.includes(bought)) shown = moveCard(shown, bought, 'decline')
    return shown as unknown as typeof holdings
  })

  const ownSources = Object.fromEntries(
    Object.entries(declineSources).filter(([cardId]) => game.players.find((p) => p.id === viewerId)?.declineCardIds.includes(cardId)),
  )
  return {
    ...game,
    chosenCardIdByPlayerId,
    players,
    ...(game.declineSourceZoneByCardId ? { declineSourceZoneByCardId: ownSources } : {}),
  }
}

function isActionSecret(entry: LoggedAction, state: GameState, viewerId: string | null): boolean {
  const action = entry.action as GameAction | { type: string; playerId?: string | null }
  if (!('playerId' in action) || action.playerId === viewerId || entry.turn !== state.turn) return false
  const game = state.game
  if (game.status !== 'active') return false
  switch (action.type) {
    case 'CHOOSE_CARD':
      return choicesHidden(game)
    case 'MOVE_TO_DECLINE':
      return game.roundPhase === 'decline'
    case 'RETRACT_DECLINE':
      return game.roundPhase === 'decline' && (action as { cardId?: string }).cardId != null
    case 'PURCHASE_CARD':
      return game.roundPhase === 'purchase'
    default:
      return false
  }
}

// ---------------------------------------------------------------------------
// Narration

/** The engine's "Game ends — …" line: the framework writes its own game-over line. */
function isGameEndLine(draft: DraftEvent): boolean {
  return draft.playerId === null && draft.message.startsWith('Game ends')
}

function describeAction(action: GameAction, before: GameState, after: GameState): ActionDescription {
  const content = contentFor(before)
  const engineBefore = toEngine(before)
  const engineAfter = toEngine(after)
  const drafts = [
    ...describePrimaryAction(action, engineBefore, engineAfter, content.unitContent),
    ...describeCascade(engineBefore, engineAfter, content.achievementContent).filter((draft) => !isGameEndLine(draft)),
  ]
  const [first, ...rest] = drafts
  return {
    message: `${first?.message ?? '{player} acted'}.`,
    ...(first?.secret ? { redactedMessage: `${first.secret.redactedMessage}.` } : {}),
    ...(rest.length > 0 ? { extraLines: rest.map((line) => ({ playerId: line.playerId, message: `${line.message}.` })) } : {}),
  }
}

// ---------------------------------------------------------------------------

export const gameDefinition: GameDefinition<GameData, GameOptions, GameAction> = {
  id: GAME_ID,
  rulesVersion: 1,
  title: 'Rise & Fall',
  turnLabel: 'Round',
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  defaultOptions: DEFAULT_GAME_OPTIONS,
  normalizeOptions: normalizeGameOptions,
  describeOptions: describeGameOptions,

  setup(lobby, random) {
    const seating = resolveSeating(lobby, random)
    const engine = buildEngineGenesis({
      gameId: lobby.gameId,
      playMode: lobby.playMode,
      players: lobby.players.map((p) => ({ id: p.id, authUserId: p.authUserId, displayName: p.displayName, color: p.color })),
      options: lobby.options,
      hiddenInformationEnabled: lobby.hiddenInformationEnabled,
      lockRevealedInformationEnabled: Boolean(lobby.lockRevealedInformationEnabled),
      seating,
    })
    return toPlatform(engine, lobby, seating)
  },

  applyAction(state, action) {
    return applyEngineAction(state, action)
  },

  onPlayerEliminated(state, playerId) {
    const engine = toEngine(state, true)
    const content = contentFor(state)
    if (engine.status === 'boardSetup') return toPlatform(concedeDuringBoardSetup(engine, playerId, content), state)
    const result = applyGameAction(engine, { type: 'CONCEDE', playerId }, content.unitContent, content.achievementContent, content.boardGenerationContent, content.taleContent)
    return result.ok ? toPlatform(result.state, state) : state
  },

  nextForcedAction(state) {
    if (state.status !== 'active') return null
    return nextForcedFollowUp(toEngine(state), contentFor(state).boardGenerationContent)
  },

  redactGame,
  isActionSecret,
  describeAction,

  describePhase(phase) {
    return phase ? (PHASE_LABELS[phase] ?? phase) : ''
  },
}

export { phaseOf }

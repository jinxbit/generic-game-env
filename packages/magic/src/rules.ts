// Rules for Magic: The Gathering (base set) — this package's `rules` entry
// point, implementing the GameDefinition contract from @game-platform/sdk.
// RULES.md is the source of truth; its rule ids are cited throughout.
//
// How it's organised: ./cards.ts is the card pool and the decks, ./mana.ts
// mana pools and automatic payment, ./engine.ts the game itself (casting,
// the stack, combat, state-based actions, the turn). This module sequences
// one action — validate, change a deep copy of `GameData`, then play on
// through every decision nobody has (`settle`, RULES.md AMBIG-4) — and
// derives the envelope from `GameData` (`withEnvelope`), so `phase`,
// `activePlayerId` and `pendingPlayerIds` can never go stale. Whatever
// happens beyond the action itself (a spell resolving, combat damage, a new
// turn) is narrated from `GameData.journal`, so there's never a forced
// follow-up.
//
// Hidden information: hands and libraries are secret from the opponent
// (R-ZONE-01), and a deck choice until both have chosen (R-SETUP-02) —
// `redactGame` masks them. Libraries have no stored order: each draw picks
// a card at random from what's left (AMBIG-1), so the numbers an entry drew
// are the only thing that says which card, and a redacted viewer never
// receives those. Narration never names a drawn card. The two actions that
// name a secret card are a keep that puts cards on the bottom (R-MULL-02)
// and a deck choice while the other player is still choosing, which
// `isActionSecret` hides from the opponent.
//
// Commander (RULES.md §10) is an option, not another game: `options.commander`
// sets `GameData.format`, which the engine's few Commander hooks read. Both
// stay absent in a standard game, so a standard game — genesis included — is
// exactly what it was before the format existed and needs no new
// `rulesVersion`. The command zone is public, and a commander is set aside
// only once both decks are chosen, so it never gives a pick away early.
//
// Pure and deterministic, like everything the framework runs — imported by
// the Edge Functions too, so keep the `.ts` extensions on relative imports.

import type { ActionDescription, ActionResult, GameDefinition, GameState as PlatformGameState, LobbyState, Random } from '@game-platform/sdk'
import { cardDef, cardName, decksFor, findDeck, isCommanderDeck } from './cards.ts'
import {
  activateAbility,
  afterDiscard,
  beginTurn,
  buildLibrary,
  castSpell,
  declareAttackers,
  declareBlockers,
  describeTarget,
  discard,
  drawCard,
  endGame,
  fail,
  findCard,
  inCommandZone,
  isCommanderGame,
  MAX_MULLIGANS,
  mulligan,
  OPENING_HAND,
  passPriority,
  permanentById,
  playLand,
  RuleError,
  settle,
  type Names,
} from './engine.ts'
import { emptyPool } from './mana.ts'
import type { GameAction, GameData, GameOptions, PlayerData, PlayerId, Step, Target } from './types.ts'

export type * from './types.ts'
export * from './cards.ts'
export * from './mana.ts'
export * from './engine.ts'

/** This game's GameState. */
export type GameState = PlatformGameState<GameData, GameOptions>

export const DEFAULT_GAME_OPTIONS: GameOptions = { startingLife: 20 }

export const LIFE_RANGE = { min: 1, max: 100 }

/** R-CMD-01: the starting life the options editor proposes for Commander. */
export const COMMANDER_LIFE = 40

export const STEP_LABELS: Record<Step, string> = {
  chooseDeck: 'Choosing decks',
  mulligan: 'Mulligans',
  main1: 'First main phase',
  attack: 'Declare attackers',
  block: 'Declare blockers',
  combat: 'Combat',
  main2: 'Second main phase',
  end: 'End step',
  discard: 'Cleanup',
  ended: 'Game over',
}

/** RULES.md §9: fills in and clamps possibly-missing/out-of-range options from a stored settings row. */
export function normalizeGameOptions(raw: unknown): GameOptions {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const commander = o.commander === true
  const life = typeof o.startingLife === 'number' && Number.isFinite(o.startingLife) ? Math.round(o.startingLife) : commander ? COMMANDER_LIFE : DEFAULT_GAME_OPTIONS.startingLife
  // `commander` only when on: a standard game's options stay `{ startingLife }`, as they always were.
  return { startingLife: Math.max(LIFE_RANGE.min, Math.min(LIFE_RANGE.max, life)), ...(commander ? { commander: true as const } : {}) }
}

function namesOf(state: { players: { id: string; displayName: string }[] }): Names {
  return Object.fromEntries(state.players.map((p) => [p.id, p.displayName]))
}

function cloneGame(game: GameData): GameData {
  return JSON.parse(JSON.stringify(game)) as GameData
}

/** Keeps the envelope in step with `game` — `pendingPlayerIds` is derived here and nowhere else. */
export function withEnvelope(state: GameState, game: GameData): GameState {
  const base: GameState = { ...state, game, turn: Math.max(1, game.turnNumber) }
  if (game.step === 'ended') {
    const winnerPlayerIds = game.seatOrder.filter((id) => !game.players[id].lost)
    return { ...base, status: 'completed', phase: null, activePlayerId: null, pendingPlayerIds: [], winnerPlayerIds: winnerPlayerIds.length === game.seatOrder.length ? [] : winnerPlayerIds }
  }
  if (game.step === 'chooseDeck' || game.step === 'mulligan') {
    const pending = game.seatOrder.filter((id) => (game.step === 'chooseDeck' ? game.players[id].deck === null : !game.players[id].kept))
    return { ...base, phase: game.step, activePlayerId: null, pendingPlayerIds: pending }
  }
  return { ...base, phase: game.step, activePlayerId: game.priorityId, pendingPlayerIds: game.priorityId ? [game.priorityId] : [] }
}

function onChooseDeck(game: GameData, playerId: PlayerId, deck: unknown, random: Random, names: Names): void {
  if (game.step !== 'chooseDeck') fail('Decks have already been chosen.')
  if (game.players[playerId].deck !== null) fail("You've already chosen a deck.")
  // R-SETUP-02 / R-CMD-01: a Commander game picks from the Commander decks, any other from the base-set ones.
  if (typeof deck !== 'string' || !decksFor(isCommanderGame(game)).some((d) => d.id === deck)) fail('Choose one of the decks.')
  game.players[playerId].deck = deck
  if (game.seatOrder.some((id) => game.players[id].deck === null)) return
  // R-SETUP-04 (and R-CMD-02: each commander to its command zone).
  for (const id of game.seatOrder) {
    buildLibrary(game, id, game.players[id].deck!)
    for (let i = 0; i < OPENING_HAND; i++) drawCard(game, id, random)
  }
  const deckLabel = (id: PlayerId) => {
    const d = findDeck(game.players[id].deck!)!
    return isCommanderDeck(d) ? `${d.name}, led by ${cardName(d.commander)}` : d.name
  }
  game.journal.push(game.seatOrder.map((id) => `${names[id]} plays ${deckLabel(id)}`).join('; ') + '.')
  game.journal.push(`${names[game.startingPlayerId]} goes first. Each player draws seven cards.`)
  game.step = 'mulligan'
}

function onKeep(game: GameData, playerId: PlayerId, bottomRaw: unknown, random: Random, names: Names): void {
  const p = game.players[playerId]
  if (game.step !== 'mulligan' || p.kept) fail("You've already kept your hand.")
  const ids = Array.isArray(bottomRaw) ? (bottomRaw as unknown[]) : []
  if (ids.length !== p.mulligans || new Set(ids).size !== ids.length) fail(`Put exactly ${p.mulligans} card${p.mulligans === 1 ? '' : 's'} from your hand on the bottom of your library.`)
  for (const id of ids) {
    const index = p.hand.findIndex((c) => c?.id === id)
    if (index < 0) fail("That card isn't in your hand.")
    p.bottom.push(p.hand.splice(index, 1)[0])
  }
  p.kept = true
  if (game.seatOrder.every((id) => game.players[id].kept)) beginTurn(game, game.startingPlayerId, random, names)
}

function apply(state: GameState, action: GameAction, random: Random): GameState {
  const game = cloneGame(state.game)
  game.journal = []
  const names = namesOf(state)
  const actor = state.players.find((p) => p.id === action.playerId)
  if (!actor || !game.players[action.playerId]) fail(`Unknown player: ${action.playerId}`)
  if (actor.eliminated) fail('You are no longer in this game.')
  const setup = game.step === 'chooseDeck' || game.step === 'mulligan'
  if (!setup && game.priorityId !== action.playerId) fail(game.priorityId ? `It's ${names[game.priorityId]}'s move.` : 'Nobody may act now.')
  switch (action.type) {
    case 'CHOOSE_DECK':
      onChooseDeck(game, action.playerId, action.deck, random, names)
      break
    case 'MULLIGAN': {
      const p = game.players[action.playerId]
      if (game.step !== 'mulligan' || p.kept) fail("You can't take a mulligan now.")
      if (p.mulligans >= MAX_MULLIGANS) fail("You can't take any more mulligans.")
      mulligan(game, action.playerId, random)
      break
    }
    case 'KEEP':
      onKeep(game, action.playerId, action.bottom, random, names)
      break
    case 'PLAY_LAND':
      playLand(game, action.playerId, action.cardId)
      break
    case 'CAST':
      castSpell(game, action.playerId, action.cardId, action.targets, action.x)
      break
    case 'ACTIVATE':
      activateAbility(game, action.playerId, action.permanentId, action.ability, action.targets, action.color)
      break
    case 'PASS':
      if (setup || game.step === 'attack' || game.step === 'discard') fail("There's a decision to make first.")
      passPriority(game, action.playerId, random, names)
      break
    case 'DECLARE_ATTACKERS':
      declareAttackers(game, action.playerId, action.attackers)
      break
    case 'DECLARE_BLOCKERS':
      declareBlockers(game, action.playerId, action.blocks)
      break
    case 'DISCARD':
      discard(game, action.playerId, action.cardIds)
      afterDiscard(game, random, names)
      break
    default: {
      const unknown: never = action
      fail(`Unknown action: ${String((unknown as { type: unknown }).type)}`)
    }
  }
  settle(game, random, names)
  return withEnvelope(state, game)
}

// ---------------------------------------------------------------------------
// Narration.

function targetsLabel(game: GameData, targets: Target[] | undefined, names: Names): string {
  if (!targets || targets.length === 0) return ''
  return ` targeting ${targets.map((t) => describeTarget(game, t, names)).join(', ')}`
}

function passHeadline(before: GameData): string {
  if (before.stack.length > 0) return '{player} passes priority.'
  switch (before.step) {
    case 'main1':
      return '{player} moves to combat.'
    case 'main2':
      return '{player} passes to the end step.'
    case 'combat':
      return '{player} is done before damage.'
    case 'end':
      return '{player} lets the turn end.'
    default:
      return '{player} passes.'
  }
}

function headline(action: GameAction, before: GameData, names: Names): string {
  switch (action.type) {
    case 'CHOOSE_DECK':
      return `{player} chooses ${findDeck(action.deck)?.name ?? 'a deck'}.`
    case 'MULLIGAN':
      return '{player} takes a mulligan.'
    case 'KEEP': {
      const n = action.bottom.length
      return n === 0 ? '{player} keeps their hand.' : `{player} keeps, putting ${n} card${n === 1 ? '' : 's'} on the bottom.`
    }
    case 'PLAY_LAND':
      return `{player} plays ${cardName(findCard(before, action.cardId)?.def ?? '')}.`
    case 'CAST': {
      const card = findCard(before, action.cardId)
      const def = card ? cardDef(card.def) : null
      const x = def?.cost?.x ? ` with X = ${action.x ?? 0}` : ''
      const from = inCommandZone(before, action.playerId, action.cardId) ? ' from the command zone' : ''
      return `{player} casts ${def?.name ?? 'a spell'}${from}${x}${targetsLabel(before, action.targets, names)}.`
    }
    case 'ACTIVATE': {
      const p = permanentById(before, action.permanentId)
      const name = p ? cardName(p.def) : 'a permanent'
      const ability = p ? cardDef(p.def).abilities?.[action.ability] : undefined
      if (ability?.produces !== undefined) return `{player} taps ${name} for ${`{${ability.produces === 'any' ? action.color : ability.produces}}`.repeat(ability.amount ?? 1)}.`
      return `{player} activates ${name}${targetsLabel(before, action.targets, names)}.`
    }
    case 'PASS':
      return passHeadline(before)
    case 'DECLARE_ATTACKERS':
      return action.attackers.length === 0 ? "{player} doesn't attack." : `{player} attacks with ${action.attackers.map((id) => cardName(permanentById(before, id)?.def ?? '')).join(', ')}.`
    case 'DECLARE_BLOCKERS':
      return action.blocks.length === 0
        ? "{player} doesn't block."
        : `{player} blocks: ${action.blocks.map((b) => `${cardName(permanentById(before, b.blocker)?.def ?? '')} blocks ${cardName(permanentById(before, b.attacker)?.def ?? '')}`).join('; ')}.`
    case 'DISCARD':
      return `{player} discards ${action.cardIds.map((id) => cardName(findCard(before, id)?.def ?? '')).join(', ')}.`
  }
}

// ---------------------------------------------------------------------------

export const gameDefinition: GameDefinition<GameData, GameOptions, GameAction> = {
  id: 'magic',
  rulesVersion: 1,
  title: 'Magic: The Gathering',
  turnLabel: 'Turn',
  minPlayers: 2,
  maxPlayers: 2,

  defaultOptions: DEFAULT_GAME_OPTIONS,
  normalizeOptions: normalizeGameOptions,
  describeOptions(options) {
    return `${options.commander ? 'Commander' : 'Base set'} · ${options.startingLife} life`
  },

  setup(lobby: LobbyState<GameOptions>, random) {
    const seatOrder = [...lobby.turnOrder]
    const commander = lobby.options.commander === true
    const seat = (): PlayerData => ({
      // R-CMD-02/05: only a Commander game carries these, so a standard genesis is unchanged.
      ...(commander ? { commander: null, commanderDamage: {} } : {}),
      deck: null,
      life: lobby.options.startingLife,
      mulligans: 0,
      kept: false,
      library: [],
      bottom: [],
      hand: [],
      graveyard: [],
      manaPool: emptyPool(),
      landsPlayed: 0,
      drewFromEmpty: false,
      lost: false,
    })
    // R-SETUP-03.
    const startingPlayerId = random.pick(seatOrder)
    const game: GameData = {
      ...(commander ? { format: 'commander' as const } : {}),
      seatOrder,
      players: Object.fromEntries(seatOrder.map((id) => [id, seat()])),
      step: 'chooseDeck',
      startingPlayerId,
      activeId: startingPlayerId,
      priorityId: null,
      passed: [],
      turnNumber: 0,
      battlefield: [],
      stack: [],
      exile: [],
      combat: null,
      combatDamagePrevented: false,
      nextAbilityId: 1,
      journal: [],
      endReason: null,
    }
    return withEnvelope({ ...lobby, status: 'active', game } as GameState, game)
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
    // Two players only, so the framework ends the game itself when one
    // concedes and never calls this; kept correct regardless.
    const game = cloneGame(state.game)
    game.journal = []
    if (game.players[playerId]) game.players[playerId].lost = true
    endGame(game, 'life')
    return withEnvelope(state, game)
  },

  nextForcedAction() {
    // Everything nobody decides happens inside the action that caused it (settle).
    return null
  },

  redactGame(state, viewerId) {
    // R-ZONE-01 / R-SETUP-02.
    const g = state.game
    const choosing = g.step === 'chooseDeck'
    const players = Object.fromEntries(
      Object.entries(g.players).map(([id, p]) => {
        if (id === viewerId) return [id, p]
        const hide = <T,>(cards: T[]) => cards.map(() => null)
        return [id, { ...p, deck: choosing ? null : p.deck, library: hide(p.library), bottom: hide(p.bottom), hand: hide(p.hand) }]
      }),
    )
    return { ...g, players }
  },

  isActionSecret(entry, state, viewerId) {
    const action = entry.action as GameAction
    if (action.playerId === viewerId) return false
    if (action.type === 'KEEP') return action.bottom.length > 0
    if (action.type === 'CHOOSE_DECK') return state.game.step === 'chooseDeck'
    return false
  },

  describeAction(action, before, after): ActionDescription {
    const message = headline(action, before.game, namesOf(before))
    const redactedMessage = action.type === 'CHOOSE_DECK' ? '{player} chooses a deck.' : action.type === 'KEEP' ? message : undefined
    return {
      message,
      ...(redactedMessage ? { redactedMessage } : {}),
      extraLines: after.game.journal.map((line) => ({ playerId: null, message: line })),
    }
  },

  describePhase(phase) {
    return phase && phase in STEP_LABELS ? STEP_LABELS[phase as Step] : 'In progress'
  },
}

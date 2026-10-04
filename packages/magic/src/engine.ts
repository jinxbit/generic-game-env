// The rules engine (RULES.md is the source of truth; its rule ids are cited
// throughout). Two kinds of function live here:
//
// - read-only helpers (characteristics, legality, what a player could do),
//   exported for the rules module, the view and the tests;
// - the mutating engine, which works on a deep copy of `GameData` made once
//   per action (rules.ts's `apply`) and may change it freely.
//
// Pure and deterministic; the only randomness is the `Random` the framework
// passes in, used for draws (RULES.md AMBIG-1), the starting player and
// Hypnotic Specter's discard.
//
// Commander (RULES.md §10) is the same engine with a few hooks, every one of
// them behind `game.format === 'commander'` (or a card only the Commander
// decks contain), so a standard game plays exactly as it always has: the
// command zone and the commander tax in casting, the trip back to the
// command zone wherever a card leaves the battlefield or the stack, and
// commander damage in combat and the state-based actions.

import type { Random } from '@game-platform/sdk'
import { cardDef, cardName, colorsOf, deckList, findDeck, isCommanderDeck } from './cards.ts'
import { canTap, COLORS, emptyPool, findPayment, payCost } from './mana.ts'
import type { ActivatedAbility, CardRef, Color, Effect, GameData, Keyword, ManaCost, Permanent, PlayerData, PlayerId, StackItem, Target, TargetSpec } from './types.ts'

export class RuleError extends Error {}

export function fail(message: string): never {
  throw new RuleError(message)
}

export const KEYWORD_LABELS: Record<Keyword, string> = {
  flying: 'Flying',
  reach: 'Reach',
  firstStrike: 'First strike',
  trample: 'Trample',
  vigilance: 'Vigilance',
  defender: 'Defender',
  protectionFromWhite: 'Protection from white',
  protectionFromBlack: 'Protection from black',
  swampwalk: 'Swampwalk',
  islandwalk: 'Islandwalk',
  forestwalk: 'Forestwalk',
  mountainwalk: 'Mountainwalk',
  plainswalk: 'Plainswalk',
  attacksEachCombat: 'Attacks each combat',
  unblockableByWalls: "Can't be blocked by Walls",
  haste: 'Haste',
  unblockable: "Can't be blocked",
}

export const HAND_SIZE = 7
export const OPENING_HAND = 7
export const MAX_MULLIGANS = 7
/** R-CMD-05. */
export const COMMANDER_DAMAGE = 21
/** R-CMD-03: the commander tax per earlier cast from the command zone. */
export const COMMANDER_TAX = 2

/** Display names by player id — the engine's only view of the envelope. */
export type Names = Record<PlayerId, string>

// ---------------------------------------------------------------------------
// Read-only helpers.

export function opponentOf(game: GameData, playerId: PlayerId): PlayerId {
  return game.seatOrder.find((id) => id !== playerId)!
}

export function permanentById(game: GameData, id: string): Permanent | undefined {
  return game.battlefield.find((p) => p.id === id)
}

export function isType(def: string, type: string): boolean {
  return cardDef(def).types.includes(type as never)
}

export function isCreature(p: Permanent): boolean {
  return isType(p.def, 'Creature')
}

/** The card with id `id`, wherever it is (for narration); null if it's hidden. */
export function findCard(game: GameData, id: string): CardRef | null {
  const perm = permanentById(game, id)
  if (perm) return { id, def: perm.def }
  const onStack = game.stack.find((s) => s.card?.id === id)
  if (onStack) return onStack.card
  for (const pid of game.seatOrder) {
    const p = game.players[pid]
    for (const zone of [p.hand, p.graveyard, p.library, p.bottom]) {
      const card = zone.find((c) => c?.id === id)
      if (card) return card
    }
    if (p.commander?.id === id) return { id, def: p.commander.def }
  }
  return game.exile.find((c) => c.id === id) ?? null
}

// --- Commander (RULES.md §10) --------------------------------------------------

export function isCommanderGame(game: GameData): boolean {
  return game.format === 'commander'
}

/** The player whose commander the card `cardId` is, or null (always null outside a Commander game). */
export function commanderOwner(game: GameData, cardId: string): PlayerId | null {
  if (!isCommanderGame(game)) return null
  return game.seatOrder.find((pid) => game.players[pid].commander?.id === cardId) ?? null
}

/** R-CMD-03: the extra generic mana `player`'s commander costs from the command zone now. */
export function commanderTax(player: PlayerData): number {
  return COMMANDER_TAX * (player.commander?.casts ?? 0)
}

/** Whether `cardId` is `playerId`'s commander, waiting in the command zone. */
export function inCommandZone(game: GameData, playerId: PlayerId, cardId: string): boolean {
  const c = game.players[playerId].commander
  return isCommanderGame(game) && !!c && c.inCommandZone && c.id === cardId
}

/** What casting `cardId` costs `playerId` right now: its mana cost, plus the commander tax from the command zone (R-CMD-03). */
export function castCost(game: GameData, playerId: PlayerId, cardId: string, def: string): ManaCost {
  const base = cardDef(def).cost!
  if (!inCommandZone(game, playerId, cardId)) return base
  return { ...base, generic: base.generic + commanderTax(game.players[playerId]) }
}

/** R-CMD-03: could `playerId` cast their commander from the command zone right now (timing and mana)? */
export function commanderCastable(game: GameData, playerId: PlayerId): boolean {
  const c = game.players[playerId].commander
  if (!c || !inCommandZone(game, playerId, c.id) || !castableNow(game, playerId, c.def)) return false
  return !!findPayment(game, playerId, castCost(game, playerId, c.id, c.def))
}

function landsOfType(game: GameData, playerId: PlayerId, subtype: string): number {
  return game.battlefield.filter((p) => p.controller === playerId && isType(p.def, 'Land') && cardDef(p.def).subtypes.includes(subtype)).length
}

function aurasOn(game: GameData, id: string): Permanent[] {
  return game.battlefield.filter((p) => p.attachedTo === id && cardDef(p.def).aura)
}

/** R-CHAR-02: a creature's current power and toughness. */
export function creatureStats(game: GameData, p: Permanent): { power: number; toughness: number } {
  const def = cardDef(p.def)
  let power = def.power ?? 0
  let toughness = def.toughness ?? 0
  for (const s of def.statics ?? []) {
    if (s.kind === 'ptFromLands') power = toughness = landsOfType(game, p.controller, s.land)
  }
  const colors = colorsOf(p.def)
  for (const source of game.battlefield) {
    for (const s of cardDef(source.def).statics ?? []) {
      if (s.kind === 'anthem' && colors.includes(s.color)) {
        power += s.power
        toughness += s.toughness
      }
    }
  }
  for (const aura of aurasOn(game, p.id)) {
    power += cardDef(aura.def).aura!.power
    toughness += cardDef(aura.def).aura!.toughness
  }
  return { power: power + p.eot.power, toughness: toughness + p.eot.toughness }
}

/** Every keyword a creature has right now: printed, from auras, and until end of turn. */
export function keywordsOf(game: GameData, p: Permanent): Keyword[] {
  const out = new Set<Keyword>(cardDef(p.def).keywords ?? [])
  for (const aura of aurasOn(game, p.id)) for (const k of cardDef(aura.def).aura!.keywords) out.add(k)
  for (const k of p.eot.keywords) out.add(k)
  return [...out]
}

export function hasKeyword(game: GameData, p: Permanent, keyword: Keyword): boolean {
  return keywordsOf(game, p).includes(keyword)
}

const PROTECTION: Partial<Record<Color, Keyword>> = { W: 'protectionFromWhite', B: 'protectionFromBlack' }

/** R-KW-01: does `p` have protection from any of `colors`? */
export function protectedFrom(game: GameData, p: Permanent, colors: readonly Color[]): boolean {
  return colors.some((c) => PROTECTION[c] && hasKeyword(game, p, PROTECTION[c]!))
}

/** The colours of whatever a stack item came from — a spell's card, or an ability's source (R-CHAR-01). */
export function sourceColors(item: Pick<StackItem, 'card' | 'source'>): Color[] {
  return colorsOf(item.card?.def ?? item.source!.def)
}

export function describeTarget(game: GameData, target: Target, names: Names): string {
  if (target.kind === 'player') return names[target.id] ?? 'a player'
  if (target.kind === 'spell') {
    const item = game.stack.find((s) => s.id === target.id)
    return item?.card ? cardName(item.card.def) : 'a spell'
  }
  const card = findCard(game, target.id)
  return card ? cardName(card.def) : 'a card'
}

/**
 * Whether `target` is legal for `spec`, for a spell or ability controlled
 * by `controller` whose source has `colors` (R-PRIO-04, R-KW-01).
 * `selfId` is the stack id of the spell doing the targeting, which can't
 * target itself.
 */
export function isLegalTarget(game: GameData, controller: PlayerId, spec: TargetSpec, target: Target, colors: readonly Color[], selfId: string | null = null): boolean {
  if (!target || typeof target !== 'object') return false
  if (target.kind === 'player') {
    return (spec.kind === 'player' || spec.kind === 'any') && game.seatOrder.includes(target.id) && !game.players[target.id].lost
  }
  if (target.kind === 'spell') {
    if (spec.kind !== 'spell' || target.id === selfId) return false
    const item = game.stack.find((s) => s.id === target.id && s.card !== null)
    return !!item && (spec.filter !== 'creatureSpell' || isType(item.card!.def, 'Creature'))
  }
  if (target.kind === 'card') {
    if (spec.kind !== 'cardInYourGraveyard') return false
    const card = game.players[controller].graveyard.find((c) => c.id === target.id)
    return !!card && (spec.filter !== 'creatureCard' || isType(card.def, 'Creature'))
  }
  if (target.kind !== 'permanent') return false
  const p = permanentById(game, target.id)
  if (!p) return false
  const types = cardDef(p.def).types
  const kindOk =
    spec.kind === 'permanent' ||
    ((spec.kind === 'creature' || spec.kind === 'any') && types.includes('Creature')) ||
    (spec.kind === 'land' && types.includes('Land')) ||
    (spec.kind === 'artifact' && types.includes('Artifact')) ||
    (spec.kind === 'artifactOrEnchantment' && (types.includes('Artifact') || types.includes('Enchantment')))
  if (!kindOk) return false
  switch (spec.filter) {
    case 'nonartifactNonblack':
      if (types.includes('Artifact') || colorsOf(p.def).includes('B')) return false
      break
    case 'tapped':
      if (!p.tapped) return false
      break
    case 'blocking':
      if (!game.combat?.blocks.some((b) => b.blocker === p.id)) return false
      break
    case 'black':
      if (!colorsOf(p.def).includes('B')) return false
      break
  }
  return !protectedFrom(game, p, colors)
}

/** Every legal target for `spec` (see isLegalTarget). */
export function legalTargets(game: GameData, controller: PlayerId, spec: TargetSpec, colors: readonly Color[], selfId: string | null = null): Target[] {
  const candidates: Target[] = [
    ...game.seatOrder.map((id): Target => ({ kind: 'player', id })),
    ...game.battlefield.map((p): Target => ({ kind: 'permanent', id: p.id })),
    ...game.stack.map((s): Target => ({ kind: 'spell', id: s.id })),
    ...game.players[controller].graveyard.map((c): Target => ({ kind: 'card', id: c.id })),
  ]
  return candidates.filter((t) => isLegalTarget(game, controller, spec, t, colors, selfId))
}

/** A step in which someone may hold priority (RULES.md AMBIG-2). */
export function isPriorityStep(game: GameData): boolean {
  return ['main1', 'main2', 'block', 'combat', 'end'].includes(game.step)
}

/** R-PRIO-02: may `playerId` cast a sorcery-speed spell right now? */
export function canActAtSorcerySpeed(game: GameData, playerId: PlayerId): boolean {
  return (game.step === 'main1' || game.step === 'main2') && game.activeId === playerId && game.priorityId === playerId && game.stack.length === 0
}

/** Whether `cardDefId` could be cast by `playerId` now, timing-wise. */
export function castableNow(game: GameData, playerId: PlayerId, cardDefId: string): boolean {
  if (game.priorityId !== playerId || !isPriorityStep(game)) return false
  const def = cardDef(cardDefId)
  if (def.types.includes('Land')) return false
  return def.types.includes('Instant') || canActAtSorcerySpeed(game, playerId)
}

/** R-TURN-06. */
export function canPlayLand(game: GameData, playerId: PlayerId): boolean {
  return canActAtSorcerySpeed(game, playerId) && game.players[playerId].landsPlayed === 0
}

/** Why `playerId` can't activate ability `index` of `p` right now, or null if they can (costs and targets, not timing). */
export function activationProblem(game: GameData, playerId: PlayerId, p: Permanent, index: number): string | null {
  const ability = cardDef(p.def).abilities?.[index]
  if (!ability) return 'That permanent has no such ability.'
  if (p.controller !== playerId) return "You don't control that."
  if (ability.tap && !canTap(p)) return p.tapped ? "It's tapped." : "It can't use {T} abilities the turn it comes under your control."
  if (ability.mana && !findPayment(game, playerId, ability.mana, 0, ability.tap ? p.id : null)) return "You can't pay for that."
  if (ability.effects.some((e) => e.kind === 'pump' && e.who === 'enchanted') && !p.attachedTo) return "It isn't enchanting anything."
  if (ability.target && legalTargets(game, playerId, ability.target, colorsOf(p.def)).length === 0) return 'It has no legal target.'
  return null
}

/**
 * RULES.md AMBIG-4: could `playerId` possibly do anything with priority —
 * judged only from public information: cards in hand, a non-mana activated
 * ability they could pay for, or (R-CMD-03) a commander in the command zone
 * they could cast.
 */
export function mightAct(game: GameData, playerId: PlayerId): boolean {
  if (game.players[playerId].hand.length > 0) return true
  if (commanderCastable(game, playerId)) return true
  return game.battlefield.some((p) => (cardDef(p.def).abilities ?? []).some((a, i) => a.produces === undefined && activationProblem(game, playerId, p, i) === null))
}

/** R-CREA-02 / R-ATK-01: could `p` attack this turn? */
export function canAttack(game: GameData, p: Permanent): boolean {
  return p.controller === game.activeId && isCreature(p) && !p.tapped && (!p.sick || hasKeyword(game, p, 'haste')) && !hasKeyword(game, p, 'defender')
}

const LANDWALK: Partial<Record<Keyword, string>> = { swampwalk: 'Swamp', islandwalk: 'Island', forestwalk: 'Forest', mountainwalk: 'Mountain', plainswalk: 'Plains' }

/** R-BLK-01/02: could `blocker` block `attacker`? */
export function canBlock(game: GameData, blocker: Permanent, attacker: Permanent): boolean {
  if (!isCreature(blocker) || blocker.tapped || blocker.controller === attacker.controller) return false
  const keywords = keywordsOf(game, attacker)
  if (keywords.includes('unblockable')) return false
  if (keywords.includes('flying') && !hasKeyword(game, blocker, 'flying') && !hasKeyword(game, blocker, 'reach')) return false
  for (const k of keywords) {
    const land = LANDWALK[k]
    if (land && landsOfType(game, blocker.controller, land) > 0) return false
  }
  if (keywords.includes('unblockableByWalls') && cardDef(blocker.def).subtypes.includes('Wall')) return false
  return !protectedFrom(game, attacker, colorsOf(blocker.def))
}

/** The attackers `blocker` could block right now. */
export function blockableAttackers(game: GameData, blocker: Permanent): string[] {
  return (game.combat?.attackers ?? []).filter((id) => {
    const attacker = permanentById(game, id)
    return attacker && canBlock(game, blocker, attacker)
  })
}

export function handOf(game: GameData, playerId: PlayerId): CardRef[] {
  return game.players[playerId].hand.filter((c): c is CardRef => c !== null)
}

// ---------------------------------------------------------------------------
// The mutating engine.

function say(game: GameData, line: string): void {
  game.journal.push(line)
}

function sortCards(cards: CardRef[]): CardRef[] {
  return [...cards].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** AMBIG-1: one card at random from the library, or the bottom once it's empty; R-SBA-01 if both are. */
export function drawCard(game: GameData, playerId: PlayerId, random: Random): void {
  const p = game.players[playerId]
  if (p.library.length > 0) {
    const [card] = p.library.splice(random.int(0, p.library.length - 1), 1)
    p.hand.push(card)
  } else if (p.bottom.length > 0) {
    p.hand.push(p.bottom.shift()!)
  } else {
    p.drewFromEmpty = true
  }
}

export function drawCards(game: GameData, playerId: PlayerId, count: number, random: Random, names: Names): void {
  if (count <= 0) return
  for (let i = 0; i < count; i++) drawCard(game, playerId, random)
  say(game, `${names[playerId]} draws ${count === 1 ? 'a card' : `${count} cards`}.`)
}

/** R-SETUP-02/04: builds a library from the chosen deck; a Commander deck's commander goes to the command zone (R-CMD-02). */
export function buildLibrary(game: GameData, playerId: PlayerId, deckId: string): void {
  const deck = findDeck(deckId)!
  const cards = deckList(deck).map((def, i): CardRef => ({ id: `${playerId}-${String(i).padStart(2, '0')}`, def }))
  game.players[playerId].library = sortCards(cards)
  if (isCommanderDeck(deck)) game.players[playerId].commander = { id: `${playerId}-cmd`, def: deck.commander, inCommandZone: true, casts: 0 }
}

/** R-MULL-01: the hand goes back and seven new cards are drawn. */
export function mulligan(game: GameData, playerId: PlayerId, random: Random): void {
  const p = game.players[playerId]
  p.library = sortCards([...(p.library as CardRef[]), ...(p.hand as CardRef[])])
  p.hand = []
  p.mulligans++
  for (let i = 0; i < OPENING_HAND; i++) drawCard(game, playerId, random)
}

function removeFromBattlefield(game: GameData, id: string): Permanent | null {
  const index = game.battlefield.findIndex((p) => p.id === id)
  if (index < 0) return null
  const [p] = game.battlefield.splice(index, 1)
  if (game.combat) {
    game.combat.attackers = game.combat.attackers.filter((a) => a !== id)
    // A removed blocker stays "blocked" for its attacker (R-DMG-01): keep the entry but it no longer resolves to a permanent.
  }
  return p
}

/** R-CMD-04: a commander going anywhere but the battlefield or the stack goes to the command zone instead. Returns whether it did. */
function toCommandZone(game: GameData, cardId: string): boolean {
  const owner = commanderOwner(game, cardId)
  if (!owner) return false
  const c = game.players[owner].commander!
  c.inCommandZone = true
  say(game, `${cardName(c.def)} goes to the command zone.`)
  return true
}

/** A spell card that's done (resolved, countered, fizzled) goes to its owner's graveyard — a commander to the command zone (R-CMD-04). */
function spellToGraveyard(game: GameData, card: CardRef): void {
  if (toCommandZone(game, card.id)) return
  game.players[ownerOf(card.id, game)].graveyard.push(card)
}

/** Moves a permanent to its owner's graveyard, hand or exile (R-ZONE-02) — or a commander to the command zone (R-CMD-04). */
function leaveBattlefield(game: GameData, id: string, to: 'graveyard' | 'hand' | 'exile'): Permanent | null {
  const p = removeFromBattlefield(game, id)
  if (!p) return null
  const card: CardRef = { id: p.id, def: p.def }
  if (toCommandZone(game, p.id)) return p
  if (to === 'exile') game.exile.push(card)
  else if (to === 'hand') game.players[p.owner].hand.push(card)
  else game.players[p.owner].graveyard.push(card)
  return p
}

function enterBattlefield(game: GameData, card: CardRef, controller: PlayerId, attachedTo: string | null = null): void {
  game.battlefield.push({
    id: card.id,
    def: card.def,
    owner: ownerOf(card.id, game),
    controller,
    tapped: false,
    sick: true,
    damage: 0,
    attachedTo,
    eot: { power: 0, toughness: 0, keywords: [] },
  })
}

/** Card ids are `<owner>-<nn>` (buildLibrary). */
export function ownerOf(cardId: string, game: GameData): PlayerId {
  return game.seatOrder.find((pid) => cardId.startsWith(`${pid}-`)) ?? game.seatOrder[0]
}

/** Damage from a source of `colors` to a creature or player; prevented by protection (R-DMG-04). Returns what was dealt. */
function dealDamage(game: GameData, colors: readonly Color[], target: Target, amount: number): number {
  if (amount <= 0) return 0
  if (target.kind === 'player') {
    game.players[target.id].life -= amount
    return amount
  }
  const p = permanentById(game, target.id)
  if (!p || !isCreature(p) || protectedFrom(game, p, colors)) return 0
  p.damage += amount
  return amount
}

/** R-CMD-05: has `p` taken lethal combat damage from a single commander? */
export function commanderDamageLethal(p: PlayerData): boolean {
  return Object.values(p.commanderDamage ?? {}).some((n) => n >= COMMANDER_DAMAGE)
}

/** R-SBA-01..04 (and R-CMD-05), repeated until nothing changes. Returns true if the game is over. */
export function checkStateBasedActions(game: GameData, names: Names): boolean {
  for (let guard = 0; guard < 100; guard++) {
    let changed = false
    for (const pid of game.seatOrder) {
      const p = game.players[pid]
      if (!p.lost && (p.life <= 0 || p.drewFromEmpty || commanderDamageLethal(p))) {
        p.lost = true
        changed = true
        say(
          game,
          p.drewFromEmpty
            ? `${names[pid]} can't draw from an empty library and loses.`
            : p.life <= 0
              ? `${names[pid]} is at ${p.life} life and loses.`
              : `${names[pid]} has taken ${COMMANDER_DAMAGE} combat damage from one commander and loses.`,
        )
      }
    }
    const dying: string[] = []
    for (const p of game.battlefield) {
      if (isCreature(p)) {
        const { toughness } = creatureStats(game, p)
        if (toughness <= 0 || p.damage >= toughness) dying.push(p.id)
      } else if (cardDef(p.def).aura) {
        const host = p.attachedTo ? permanentById(game, p.attachedTo) : undefined
        if (!host || !isCreature(host) || protectedFrom(game, host, colorsOf(p.def))) dying.push(p.id)
      }
    }
    for (const id of dying) {
      const p = permanentById(game, id)
      if (p) say(game, `${cardName(p.def)} ${isCreature(p) ? 'dies' : 'is put into the graveyard'}.`)
      leaveBattlefield(game, id, 'graveyard')
      changed = true
    }
    if (!changed) break
  }
  const losers = game.seatOrder.filter((pid) => game.players[pid].lost)
  if (losers.length === 0) return false
  const loser = game.players[losers[0]]
  const reason = losers.length > 1 ? 'draw' : loser.drewFromEmpty ? 'library' : loser.life <= 0 ? 'life' : commanderDamageLethal(loser) ? 'commander' : 'life'
  endGame(game, reason)
  return true
}

export function endGame(game: GameData, reason: GameData['endReason']): void {
  game.step = 'ended'
  game.priorityId = null
  game.passed = []
  game.endReason = reason
}

function emptyPools(game: GameData): void {
  for (const pid of game.seatOrder) game.players[pid].manaPool = emptyPool()
}

// --- Casting and activating -------------------------------------------------

function validateTargets(game: GameData, controller: PlayerId, spec: TargetSpec | undefined, targets: unknown, colors: Color[], selfId: string | null): Target[] {
  const list = Array.isArray(targets) ? (targets as Target[]) : []
  if (!spec) {
    if (list.length > 0) fail("That doesn't target anything.")
    return []
  }
  if (list.length !== 1) fail('Choose one target.')
  if (!isLegalTarget(game, controller, spec, list[0], colors, selfId)) fail("That isn't a legal target.")
  return [{ kind: list[0].kind, id: list[0].id } as Target]
}

function validateX(hasX: boolean | undefined, x: unknown): number {
  if (!hasX) return 0
  if (typeof x !== 'number' || !Number.isInteger(x) || x < 0 || x > 99) fail('Choose a whole number for X, from 0 to 99.')
  return x
}

/** AMBIG-3: the caster's pass comes with the cast. */
function passAfterPutting(game: GameData, playerId: PlayerId): void {
  game.passed = [playerId]
  game.priorityId = opponentOf(game, playerId)
}

export function playLand(game: GameData, playerId: PlayerId, cardId: string): CardRef {
  const p = game.players[playerId]
  const index = p.hand.findIndex((c) => c?.id === cardId)
  if (index < 0) fail("That card isn't in your hand.")
  const card = p.hand[index]!
  if (!isType(card.def, 'Land')) fail("That isn't a land.")
  if (!canActAtSorcerySpeed(game, playerId)) fail('You can play a land only in a main phase of your turn, with the stack empty.')
  if (p.landsPlayed > 0) fail("You've already played a land this turn.")
  p.hand.splice(index, 1)
  p.landsPlayed++
  enterBattlefield(game, card, playerId)
  game.passed = []
  return card
}

/** Casts a card from `playerId`'s hand — or, in a Commander game, their commander from the command zone, paying the tax (R-CMD-03). */
export function castSpell(game: GameData, playerId: PlayerId, cardId: string, targets: unknown, xRaw: unknown): void {
  const p = game.players[playerId]
  const index = p.hand.findIndex((c) => c?.id === cardId)
  const fromCommandZone = index < 0 && inCommandZone(game, playerId, cardId)
  if (index < 0 && !fromCommandZone) fail("That card isn't in your hand.")
  const card = fromCommandZone ? { id: cardId, def: p.commander!.def } : p.hand[index]!
  const def = cardDef(card.def)
  if (def.types.includes('Land')) fail('Play a land instead of casting it.')
  if (game.priorityId !== playerId || !isPriorityStep(game)) fail("You don't have priority.")
  if (!castableNow(game, playerId, card.def)) fail(`${def.name} can be cast only in a main phase of your turn, with the stack empty.`)
  const x = validateX(def.cost?.x, xRaw)
  const chosen = validateTargets(game, playerId, def.target, targets, colorsOf(card.def), card.id)
  const tax = fromCommandZone ? commanderTax(p) : 0
  if (!payCost(game, playerId, castCost(game, playerId, card.id, card.def), x)) fail(`You can't pay ${def.name}'s cost${tax > 0 ? ` plus {${tax}} commander tax` : ''}.`)
  if (fromCommandZone) {
    p.commander!.inCommandZone = false
    p.commander!.casts++
  } else p.hand.splice(index, 1)
  game.stack.push({ id: card.id, controller: playerId, card, source: null, targets: chosen, x, enchanted: null })
  passAfterPutting(game, playerId)
}

export function activateAbility(game: GameData, playerId: PlayerId, permanentId: string, abilityIndex: unknown, targets: unknown, color: unknown): { ability: ActivatedAbility; mana: string | null } {
  if (game.priorityId !== playerId || !isPriorityStep(game)) fail("You don't have priority.")
  const p = permanentById(game, permanentId)
  if (!p) fail("That permanent isn't on the battlefield.")
  if (typeof abilityIndex !== 'number') fail('Choose an ability.')
  const problem = activationProblem(game, playerId, p, abilityIndex)
  if (problem) fail(problem)
  const ability = cardDef(p.def).abilities![abilityIndex]
  // R-PRIO-03: a mana ability resolves at once.
  if (ability.produces !== undefined) {
    let mana = ability.produces
    if (mana === 'any') {
      if (!COLORS.includes(color as Color)) fail('Choose a colour of mana.')
      mana = color as Color
    }
    p.tapped = true
    game.players[playerId].manaPool[mana] += ability.amount ?? 1
    return { ability, mana }
  }
  const chosen = validateTargets(game, playerId, ability.target, targets, colorsOf(p.def), null)
  if (ability.tap) p.tapped = true
  if (ability.mana && !payCost(game, playerId, ability.mana, 0, ability.tap ? p.id : null)) fail("You can't pay for that.")
  const id = `a${game.nextAbilityId++}`
  game.stack.push({ id, controller: playerId, card: null, source: { permanentId: p.id, def: p.def, ability: abilityIndex }, targets: chosen, x: 0, enchanted: p.attachedTo })
  passAfterPutting(game, playerId)
  return { ability, mana: null }
}

// --- Resolution --------------------------------------------------------------

function amountOf(amount: number | 'X', item: StackItem): number {
  return amount === 'X' ? item.x : amount
}

function runEffect(game: GameData, item: StackItem, effect: Effect, random: Random, names: Names): void {
  const target = item.targets[0]
  const colors = sourceColors(item)
  const label = cardName(item.card?.def ?? item.source!.def)
  const perm = target?.kind === 'permanent' ? permanentById(game, target.id) : undefined
  switch (effect.kind) {
    case 'damage': {
      const n = amountOf(effect.amount, item)
      const dealt = dealDamage(game, colors, target, n)
      say(game, dealt > 0 ? `${label} deals ${dealt} damage to ${describeTarget(game, target, names)}.` : `${label} deals no damage.`)
      break
    }
    case 'destroy':
      if (perm) {
        say(game, `${cardName(perm.def)} is destroyed.`)
        leaveBattlefield(game, perm.id, 'graveyard')
      }
      break
    case 'exileGainLife':
      if (perm) {
        const power = Math.max(0, creatureStats(game, perm).power)
        say(game, `${cardName(perm.def)} is exiled; ${names[perm.controller]} gains ${power} life.`)
        leaveBattlefield(game, perm.id, 'exile')
        game.players[perm.controller].life += power
      }
      break
    case 'bounce':
      if (perm) {
        if (!commanderOwner(game, perm.id)) say(game, `${cardName(perm.def)} returns to ${names[perm.owner]}'s hand.`)
        leaveBattlefield(game, perm.id, 'hand')
      }
      break
    case 'counter': {
      const index = game.stack.findIndex((s) => s.id === target.id)
      if (index >= 0) {
        const [countered] = game.stack.splice(index, 1)
        say(game, `${countered.card ? cardName(countered.card.def) : 'The ability'} is countered.`)
        if (countered.card) spellToGraveyard(game, countered.card)
      }
      break
    }
    case 'pump': {
      const id = effect.who === 'target' ? perm?.id : effect.who === 'self' ? item.source?.permanentId : (item.enchanted ?? undefined)
      const subject = id ? permanentById(game, id) : undefined
      if (subject) {
        subject.eot.power += effect.power
        subject.eot.toughness += effect.toughness
        const { power, toughness } = creatureStats(game, subject)
        say(game, `${cardName(subject.def)} is ${power}/${toughness} until end of turn.`)
      }
      break
    }
    case 'grant': {
      const id = effect.who === 'target' ? perm?.id : item.source?.permanentId
      const subject = id ? permanentById(game, id) : undefined
      if (subject) {
        if (!subject.eot.keywords.includes(effect.keyword)) subject.eot.keywords.push(effect.keyword)
        say(game, `${cardName(subject.def)} gains ${KEYWORD_LABELS[effect.keyword].toLowerCase()} until end of turn.`)
      }
      break
    }
    case 'gainLife': {
      const who = effect.who === 'you' ? item.controller : target.id
      const n = amountOf(effect.amount, item)
      game.players[who].life += n
      say(game, `${names[who]} gains ${n} life.`)
      break
    }
    case 'draw':
      drawCards(game, effect.who === 'you' ? item.controller : target.id, amountOf(effect.amount, item), random, names)
      break
    case 'addMana':
      for (const m of effect.mana) game.players[item.controller].manaPool[m]++
      break
    case 'destroyAll': {
      const doomed = game.battlefield.filter(isCreature)
      say(game, doomed.length > 0 ? `${doomed.map((p) => cardName(p.def)).join(', ')} ${doomed.length === 1 ? 'is' : 'are'} destroyed.` : 'No creatures are destroyed.')
      for (const p of doomed) leaveBattlefield(game, p.id, 'graveyard')
      break
    }
    case 'damageEach': {
      const n = amountOf(effect.amount, item)
      const struck = game.battlefield.filter((p) => isCreature(p) && (effect.creatures === 'all' || (effect.creatures === 'flying') === hasKeyword(game, p, 'flying')))
      const hurt: string[] = []
      for (const p of struck) if (dealDamage(game, colors, { kind: 'permanent', id: p.id }, n) > 0) hurt.push(cardName(p.def))
      if (effect.players) for (const pid of livingPlayers(game)) if (dealDamage(game, colors, { kind: 'player', id: pid }, n) > 0) hurt.push(names[pid])
      say(game, hurt.length > 0 ? `${label} deals ${n} damage to ${hurt.join(', ')}.` : `${label} deals no damage.`)
      break
    }
    case 'pumpAll': {
      const affected = game.battlefield.filter((p) => isCreature(p) && (effect.attacking ? !!game.combat?.attackers.includes(p.id) : p.controller === item.controller))
      for (const p of affected) {
        p.eot.power += effect.power
        p.eot.toughness += effect.toughness
        if (effect.keyword && !p.eot.keywords.includes(effect.keyword)) p.eot.keywords.push(effect.keyword)
      }
      const bonus = `+${effect.power}/+${effect.toughness}${effect.keyword ? ` and ${KEYWORD_LABELS[effect.keyword].toLowerCase()}` : ''}`
      say(game, affected.length > 0 ? `${affected.map((p) => cardName(p.def)).join(', ')} ${affected.length === 1 ? 'gets' : 'get'} ${bonus} until end of turn.` : `${label} affects no creatures.`)
      break
    }
    case 'returnToHand': {
      const gy = game.players[item.controller].graveyard
      const index = gy.findIndex((c) => c.id === target.id)
      if (index >= 0) {
        const [card] = gy.splice(index, 1)
        game.players[item.controller].hand.push(card)
        say(game, `${cardName(card.def)} returns to ${names[item.controller]}'s hand.`)
      }
      break
    }
    case 'fog':
      game.combatDamagePrevented = true
      say(game, 'All combat damage this turn will be prevented.')
      break
  }
}

/** R-PRIO-01/04: resolves the top of the stack. */
function resolveTop(game: GameData, random: Random, names: Names): void {
  const item = game.stack.pop()!
  const card = item.card
  const def = card ? cardDef(card.def) : null
  const ability = item.source ? cardDef(item.source.def).abilities![item.source.ability] : null
  const spec = def ? def.target : ability!.target
  const colors = sourceColors(item)
  if (spec && !item.targets.every((t) => isLegalTarget(game, item.controller, spec, t, colors, item.id))) {
    say(game, `${cardName(card?.def ?? item.source!.def)}${card ? '' : "'s ability"} has no legal target and doesn't resolve.`)
    if (card) spellToGraveyard(game, card)
    return
  }
  if (card && def) {
    const permanent = def.types.some((t) => t === 'Creature' || t === 'Enchantment' || t === 'Artifact')
    if (permanent) {
      enterBattlefield(game, card, item.controller, def.aura ? item.targets[0].id : null)
      say(game, def.aura ? `${def.name} enchants ${describeTarget(game, item.targets[0], names)}.` : `${def.name} enters the battlefield.`)
      return
    }
    for (const effect of def.effects ?? []) runEffect(game, item, effect, random, names)
    spellToGraveyard(game, card)
    return
  }
  for (const effect of ability!.effects) runEffect(game, item, effect, random, names)
}

// --- Turn flow ----------------------------------------------------------------

/** AMBIG-2: who receives priority, in order, with the stack empty in the current step. */
export function priorityWindow(game: GameData): PlayerId[] {
  const active = game.activeId
  const defending = opponentOf(game, active)
  switch (game.step) {
    case 'main1':
    case 'main2':
      return [active]
    case 'block':
      return [defending]
    case 'combat':
      return [active, defending]
    case 'end':
      return [defending]
    default:
      return []
  }
}

function livingPlayers(game: GameData): PlayerId[] {
  return game.seatOrder.filter((pid) => !game.players[pid].lost)
}

/** R-TURN-02/03: the start of `playerId`'s turn, up to priority in their first main phase. */
export function beginTurn(game: GameData, playerId: PlayerId, random: Random, names: Names): void {
  game.activeId = playerId
  game.turnNumber++
  say(game, `Turn ${game.turnNumber}: ${names[playerId]}.`)
  for (const p of game.battlefield) {
    if (p.controller !== playerId) continue
    p.tapped = false
    p.sick = false
  }
  game.players[playerId].landsPlayed = 0
  if (!(game.turnNumber === 1 && playerId === game.startingPlayerId)) drawCards(game, playerId, 1, random, names)
  if (checkStateBasedActions(game, names)) return
  game.step = 'main1'
  game.priorityId = playerId
  game.passed = []
}

/** R-ATK-01: to the declare attackers step, or past combat if nothing can attack. */
function enterCombat(game: GameData): void {
  const any = game.battlefield.some((p) => canAttack(game, p))
  game.step = any ? 'attack' : 'main2'
  game.priorityId = game.activeId
  game.passed = []
}

/** R-TURN-04: cleanup and the next turn. */
function finishTurn(game: GameData, random: Random, names: Names): void {
  for (const p of game.battlefield) {
    p.damage = 0
    p.eot = { power: 0, toughness: 0, keywords: [] }
  }
  game.combatDamagePrevented = false
  game.combat = null
  emptyPools(game)
  beginTurn(game, opponentOf(game, game.activeId), random, names)
}

function cleanup(game: GameData, random: Random, names: Names): void {
  emptyPools(game)
  if (game.players[game.activeId].hand.length > HAND_SIZE) {
    game.step = 'discard'
    game.priorityId = game.activeId
    game.passed = []
    return
  }
  finishTurn(game, random, names)
}

/** The step's priority round is over with an empty stack: on to the next step. */
function endStep(game: GameData, random: Random, names: Names): void {
  emptyPools(game)
  switch (game.step) {
    case 'main1':
      enterCombat(game)
      return
    case 'combat':
      combatDamage(game, random, names)
      return
    case 'main2':
      game.step = 'end'
      game.priorityId = opponentOf(game, game.activeId)
      game.passed = []
      return
    case 'end':
      cleanup(game, random, names)
      return
    default:
      throw new Error(`No step follows ${game.step} on a pass.`)
  }
}

/** R-PRIO-01: `playerId` passes priority. */
export function passPriority(game: GameData, playerId: PlayerId, random: Random, names: Names): void {
  if (!game.passed.includes(playerId)) game.passed.push(playerId)
  if (game.stack.length > 0) {
    const everyone = livingPlayers(game).every((pid) => game.passed.includes(pid))
    if (!everyone) {
      game.priorityId = opponentOf(game, playerId)
      return
    }
    resolveTop(game, random, names)
    if (checkStateBasedActions(game, names)) return
    game.passed = []
    game.priorityId = game.stack.length > 0 ? game.activeId : (priorityWindow(game)[0] ?? game.activeId)
    return
  }
  if (game.step === 'block') fail('Declare your blockers (or none).')
  const next = priorityWindow(game).find((pid) => !game.passed.includes(pid))
  if (next) {
    game.priorityId = next
    return
  }
  endStep(game, random, names)
}

// --- Combat --------------------------------------------------------------------

export function declareAttackers(game: GameData, playerId: PlayerId, attackersRaw: unknown): Permanent[] {
  if (game.step !== 'attack' || game.priorityId !== playerId) fail("It isn't time for you to declare attackers.")
  const ids = Array.isArray(attackersRaw) ? (attackersRaw as unknown[]) : fail('Choose the attackers.')
  if (new Set(ids).size !== ids.length) fail('Each creature can attack only once.')
  const attackers = ids.map((id) => {
    const p = typeof id === 'string' ? permanentById(game, id) : undefined
    if (!p || !canAttack(game, p)) fail(`${p ? cardName(p.def) : 'That'} can't attack.`)
    return p
  })
  for (const p of game.battlefield) {
    if (canAttack(game, p) && hasKeyword(game, p, 'attacksEachCombat') && !attackers.includes(p)) fail(`${cardName(p.def)} attacks each combat if able.`)
  }
  if (attackers.length === 0) {
    game.step = 'main2'
    game.priorityId = playerId
    game.passed = []
    return []
  }
  for (const p of attackers) if (!hasKeyword(game, p, 'vigilance')) p.tapped = true
  game.combat = { attackers: attackers.map((p) => p.id), blocks: [], blocked: false }
  game.step = 'block'
  game.priorityId = opponentOf(game, playerId)
  game.passed = []
  return attackers
}

export function declareBlockers(game: GameData, playerId: PlayerId, blocksRaw: unknown): { blocker: string; attacker: string }[] {
  if (game.step !== 'block' || game.priorityId !== playerId || game.stack.length > 0) fail("It isn't time for you to declare blockers.")
  const list = Array.isArray(blocksRaw) ? (blocksRaw as { blocker: unknown; attacker: unknown }[]) : fail('Choose the blockers.')
  const seen = new Set<string>()
  const blocks = list.map((b) => {
    const blocker = typeof b?.blocker === 'string' ? permanentById(game, b.blocker) : undefined
    const attacker = typeof b?.attacker === 'string' && game.combat!.attackers.includes(b.attacker) ? permanentById(game, b.attacker) : undefined
    if (!blocker || blocker.controller !== playerId) fail('Block with your own creatures.')
    if (!attacker) fail('Block an attacking creature.')
    if (seen.has(blocker.id)) fail('Each creature can block only one attacker.')
    seen.add(blocker.id)
    if (!canBlock(game, blocker, attacker)) fail(`${cardName(blocker.def)} can't block ${cardName(attacker.def)}.`)
    return { blocker: blocker.id, attacker: attacker.id }
  })
  game.combat!.blocks = blocks
  game.combat!.blocked = true
  game.step = 'combat'
  game.priorityId = game.activeId
  game.passed = []
  return blocks
}

type Hit = { source: Permanent; target: Target; amount: number }

/** R-DMG-01/02: the damage one combat damage step deals (`first`: the first-strike step, when there is one). */
function combatHits(game: GameData, step: 'first' | 'regular' | 'all'): Hit[] {
  const combat = game.combat!
  const defending = opponentOf(game, game.activeId)
  const deals = (p: Permanent) => step === 'all' || (step === 'first') === hasKeyword(game, p, 'firstStrike')
  const hits: Hit[] = []
  for (const id of combat.attackers) {
    const attacker = permanentById(game, id)
    if (!attacker || !deals(attacker)) continue
    let power = creatureStats(game, attacker).power
    if (power <= 0) continue
    const blockedBy = combat.blocks.filter((b) => b.attacker === id)
    const blockers = blockedBy.map((b) => permanentById(game, b.blocker)).filter((p): p is Permanent => !!p)
    const trample = hasKeyword(game, attacker, 'trample')
    if (blockedBy.length === 0) {
      hits.push({ source: attacker, target: { kind: 'player', id: defending }, amount: power })
      continue
    }
    if (blockers.length === 0) {
      if (trample) hits.push({ source: attacker, target: { kind: 'player', id: defending }, amount: power })
      continue
    }
    // AMBIG-6: lethal to each blocker in declaration order.
    blockers.forEach((blocker, i) => {
      if (power <= 0) return
      const lethal = Math.max(0, creatureStats(game, blocker).toughness - blocker.damage)
      const last = i === blockers.length - 1
      const amount = last && !trample ? power : Math.min(power, lethal)
      if (amount > 0) hits.push({ source: attacker, target: { kind: 'permanent', id: blocker.id }, amount })
      power -= amount
    })
    if (power > 0 && trample) hits.push({ source: attacker, target: { kind: 'player', id: defending }, amount: power })
  }
  for (const { blocker: bid, attacker: aid } of combat.blocks) {
    const blocker = permanentById(game, bid)
    if (!blocker || !deals(blocker) || !permanentById(game, aid)) continue
    const power = creatureStats(game, blocker).power
    if (power > 0) hits.push({ source: blocker, target: { kind: 'permanent', id: aid }, amount: power })
  }
  return hits
}

function applyHits(game: GameData, hits: Hit[], random: Random, names: Names): void {
  const toPlayer: Record<string, number> = {}
  for (const hit of hits) {
    const dealt = dealDamage(game, colorsOf(hit.source.def), hit.target, hit.amount)
    if (dealt <= 0) continue
    if (hit.target.kind === 'player') {
      toPlayer[hit.source.id] = (toPlayer[hit.source.id] ?? 0) + dealt
      // R-CMD-05.
      if (commanderOwner(game, hit.source.id)) {
        const taken = (game.players[hit.target.id].commanderDamage ??= {})
        taken[hit.source.id] = (taken[hit.source.id] ?? 0) + dealt
      }
      say(game, `${cardName(hit.source.def)} deals ${dealt} damage to ${names[hit.target.id]}.`)
    } else {
      say(game, `${cardName(hit.source.def)} deals ${dealt} damage to ${describeTarget(game, hit.target, names)}.`)
    }
  }
  // AMBIG-5: Hypnotic Specter's trigger resolves at once.
  for (const hit of hits) {
    if (hit.target.kind !== 'player' || !toPlayer[hit.source.id] || cardDef(hit.source.def).trigger !== 'discardRandomOnDamageToPlayer') continue
    const hand = game.players[hit.target.id].hand
    if (hand.length === 0) continue
    const [card] = hand.splice(random.int(0, hand.length - 1), 1)
    game.players[hit.target.id].graveyard.push(card!)
    say(game, `${names[hit.target.id]} discards ${cardName(card!.def)} at random.`)
    delete toPlayer[hit.source.id]
  }
}

/** R-DMG-01..03, then on to the second main phase. */
function combatDamage(game: GameData, random: Random, names: Names): void {
  const combat = game.combat!
  if (game.combatDamagePrevented) {
    say(game, 'Combat damage is prevented.')
  } else {
    const combatants = [...combat.attackers, ...combat.blocks.map((b) => b.blocker)].map((id) => permanentById(game, id)).filter((p): p is Permanent => !!p)
    if (combatants.some((p) => hasKeyword(game, p, 'firstStrike'))) {
      applyHits(game, combatHits(game, 'first'), random, names)
      if (checkStateBasedActions(game, names)) return
      applyHits(game, combatHits(game, 'regular'), random, names)
    } else {
      applyHits(game, combatHits(game, 'all'), random, names)
    }
    if (checkStateBasedActions(game, names)) return
  }
  game.combat = null
  game.step = 'main2'
  game.priorityId = game.activeId
  game.passed = []
}

export function discard(game: GameData, playerId: PlayerId, cardIds: unknown): CardRef[] {
  if (game.step !== 'discard' || game.priorityId !== playerId) fail("You don't need to discard now.")
  const hand = game.players[playerId].hand
  const need = hand.length - HAND_SIZE
  const ids = Array.isArray(cardIds) ? (cardIds as unknown[]) : []
  if (ids.length !== need || new Set(ids).size !== ids.length) fail(`Discard exactly ${need} card${need === 1 ? '' : 's'}.`)
  const cards = ids.map((id) => {
    const index = hand.findIndex((c) => c?.id === id)
    if (index < 0) fail("That card isn't in your hand.")
    return hand.splice(index, 1)[0]!
  })
  game.players[playerId].graveyard.push(...cards)
  return cards
}

/** Finishes a turn after the cleanup discard. */
export function afterDiscard(game: GameData, random: Random, names: Names): void {
  finishTurn(game, random, names)
}

/** Whether the defending player could block anything at all right now. */
function anyBlockPossible(game: GameData, defending: PlayerId): boolean {
  return game.battlefield.some((p) => p.controller === defending && blockableAttackers(game, p).length > 0)
}

/**
 * Plays on through decisions nobody has (AMBIG-4): a priority holder who
 * might not act passes, and a defender who can neither act nor block
 * declares no blockers. Stops at the first real decision.
 */
export function settle(game: GameData, random: Random, names: Names): void {
  for (let guard = 0; guard < 1000; guard++) {
    if (game.step === 'ended') return
    const pid = game.priorityId
    if (!pid || game.step === 'attack' || game.step === 'discard' || !isPriorityStep(game)) return
    if (mightAct(game, pid)) return
    if (game.step === 'block' && game.stack.length === 0) {
      if (anyBlockPossible(game, pid)) return
      declareBlockers(game, pid, [])
      continue
    }
    passPriority(game, pid, random, names)
  }
  throw new Error('The game did not settle.')
}

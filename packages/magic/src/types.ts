// Data types for Magic: The Gathering (base set). RULES.md (next to this
// package's README) is the source of truth; its rule ids are cited in
// comments.
//
// Keep this module pure data: no React, no Supabase, no I/O. It's imported by
// the Edge Functions, so every relative import in the graph must carry an
// explicit `.ts` extension.

export type PlayerId = string

export type Color = 'W' | 'U' | 'B' | 'R' | 'G'
/** A colour, or colourless mana. */
export type ManaType = Color | 'C'

/** A mana cost: generic plus coloured symbols, and whether it has an {X}. */
export interface ManaCost {
  generic: number
  W?: number
  U?: number
  B?: number
  R?: number
  G?: number
  x?: boolean
}

export type ManaPool = Record<ManaType, number>

export type CardType = 'Land' | 'Creature' | 'Instant' | 'Sorcery' | 'Enchantment' | 'Artifact'

export type Keyword =
  | 'flying'
  | 'reach'
  | 'firstStrike'
  | 'trample'
  | 'vigilance'
  | 'defender'
  | 'protectionFromWhite'
  | 'protectionFromBlack'
  | 'swampwalk'
  | 'islandwalk'
  | 'forestwalk'
  | 'mountainwalk'
  | 'plainswalk'
  /** Juggernaut: must attack each combat if able (R-ATK-01). */
  | 'attacksEachCombat'
  /** Juggernaut: can't be blocked by Walls (R-BLK-02). */
  | 'unblockableByWalls'

/** What a spell or ability can target. */
export type TargetKind =
  /** A creature or a player ("any target"). */
  | 'any'
  | 'creature'
  | 'player'
  | 'permanent'
  /** A spell on the stack. */
  | 'spell'
  | 'land'
  | 'artifact'
  | 'artifactOrEnchantment'
  /** A card in the caster's own graveyard. */
  | 'cardInYourGraveyard'

export type TargetFilter =
  /** Terror. */
  | 'nonartifactNonblack'
  /** Royal Assassin. */
  | 'tapped'
  /** Righteousness. */
  | 'blocking'
  /** Northern Paladin. */
  | 'black'
  /** Raise Dead. */
  | 'creatureCard'

export interface TargetSpec {
  kind: TargetKind
  filter?: TargetFilter
}

export type Target = { kind: 'player'; id: PlayerId } | { kind: 'permanent'; id: string } | { kind: 'spell'; id: string } | { kind: 'card'; id: string }

/** A number, or the spell's X. */
export type Amount = number | 'X'

/**
 * One thing a spell or ability does when it resolves, in order. "target"
 * means the spell's single target; "self" the permanent whose ability it is;
 * "enchanted" the creature the ability's aura was attached to when activated.
 */
export type Effect =
  | { kind: 'damage'; amount: Amount }
  | { kind: 'destroy' }
  /** Swords to Plowshares: exile target creature; its controller gains life equal to its power. */
  | { kind: 'exileGainLife' }
  /** Return target permanent to its owner's hand. */
  | { kind: 'bounce' }
  | { kind: 'counter' }
  | { kind: 'pump'; who: 'target' | 'self' | 'enchanted'; power: number; toughness: number }
  | { kind: 'grant'; who: 'target' | 'self'; keyword: Keyword }
  | { kind: 'gainLife'; who: 'you' | 'target'; amount: Amount }
  | { kind: 'draw'; who: 'you' | 'target'; amount: Amount }
  | { kind: 'addMana'; mana: ManaType[] }
  | { kind: 'destroyAll'; what: 'creature' }
  /** Return the target card from your graveyard to your hand. */
  | { kind: 'returnToHand' }
  /** Fog: prevent all combat damage this turn. */
  | { kind: 'fog' }

export interface ActivatedAbility {
  /** Mana to pay (none when omitted). */
  mana?: ManaCost
  /** {T} is part of the cost. */
  tap?: boolean
  target?: TargetSpec
  effects: Effect[]
  /**
   * Set for a mana ability (R-PRIO-03), which resolves at once, off the
   * stack: the one mana it adds, or `any` for one of the activator's choice
   * (Birds of Paradise).
   */
  produces?: ManaType | 'any'
  text: string
}

export type StaticAbility =
  /** Crusade / Bad Moon: every creature of `color` gets +power/+toughness. */
  | { kind: 'anthem'; color: Color; power: number; toughness: number }
  /** Nightmare: power and toughness are each the number of `land`s its controller controls. */
  | { kind: 'ptFromLands'; land: BasicLandType }

export type BasicLandType = 'Plains' | 'Island' | 'Swamp' | 'Mountain' | 'Forest'

export interface AuraSpec {
  power: number
  toughness: number
  keywords: Keyword[]
}

export interface CardDef {
  id: string
  name: string
  /** Null for lands. */
  cost: ManaCost | null
  types: CardType[]
  subtypes: string[]
  /** Printed power/toughness for creatures (Nightmare's are computed, R-CHAR-02). */
  power?: number
  toughness?: number
  keywords?: Keyword[]
  /** What the spell does on resolution (instants and sorceries). */
  effects?: Effect[]
  /** The spell's target, if it has one (auras: the creature to enchant). */
  target?: TargetSpec
  abilities?: ActivatedAbility[]
  statics?: StaticAbility[]
  aura?: AuraSpec
  /** Hypnotic Specter (AMBIG-5). */
  trigger?: 'discardRandomOnDamageToPlayer'
  /** Rules text, for the view. */
  text: string
}

/** A card in a hidden-able zone: its id (stable for the whole game) and which card it is. */
export interface CardRef {
  id: string
  def: string
}

export interface Permanent {
  id: string
  def: string
  owner: PlayerId
  controller: PlayerId
  tapped: boolean
  /** R-CREA-02: came under its controller's control since the start of their most recent turn. */
  sick: boolean
  damage: number
  /** The permanent an aura is attached to. */
  attachedTo: string | null
  /** "Until end of turn" changes (R-TURN-04). */
  eot: { power: number; toughness: number; keywords: Keyword[] }
}

export interface StackItem {
  /** Unique on the stack — a spell's card id, or `a<n>` for an ability. */
  id: string
  controller: PlayerId
  /** The card being cast, for a spell. */
  card: CardRef | null
  /** For an ability: the permanent it came from, its card and which ability. */
  source: { permanentId: string; def: string; ability: number } | null
  targets: Target[]
  x: number
  /** Firebreathing: the creature the aura was attached to when activated. */
  enchanted: string | null
}

export interface Combat {
  /** Attacking creatures, in declaration order. */
  attackers: string[]
  /** Blocker id → the attacker it blocks, in declaration order. */
  blocks: { blocker: string; attacker: string }[]
  /** Whether the attackers' blockers have been declared. */
  blocked: boolean
}

export interface PlayerData {
  /** One of DECKS, once chosen (R-SETUP-02). Redacted while the other player is still choosing. */
  deck: string | null
  life: number
  /** R-MULL-01. */
  mulligans: number
  kept: boolean
  /** AMBIG-1: the shuffled part of the library, sorted by id. Redacted to nulls for the opponent. */
  library: (CardRef | null)[]
  /** R-MULL-02: cards put on the bottom, drawn first-in first-out once `library` is empty. */
  bottom: (CardRef | null)[]
  hand: (CardRef | null)[]
  /** Top card last. */
  graveyard: CardRef[]
  manaPool: ManaPool
  landsPlayed: number
  /** R-SBA-01: tried to draw from an empty library. */
  drewFromEmpty: boolean
  lost: boolean
}

/**
 * Where the game is. `chooseDeck` and `mulligan` are simultaneous; the rest
 * belong to the active player's turn (AMBIG-2 lists who holds priority in
 * each).
 */
export type Step = 'chooseDeck' | 'mulligan' | 'main1' | 'attack' | 'block' | 'combat' | 'main2' | 'end' | 'discard' | 'ended'

export interface GameOptions {
  startingLife: number
}

export interface GameData {
  seatOrder: PlayerId[]
  players: Record<PlayerId, PlayerData>
  step: Step
  /** R-SETUP-03. */
  startingPlayerId: PlayerId
  activeId: PlayerId
  /** Who holds priority, or must decide (attackers, blockers, discard); null in simultaneous steps. */
  priorityId: PlayerId | null
  /** Players who have passed in succession since the last change (R-PRIO-01). */
  passed: PlayerId[]
  /** Counts turns, from 1 — the starting player's first turn. */
  turnNumber: number
  battlefield: Permanent[]
  /** Bottom first, top last. */
  stack: StackItem[]
  exile: CardRef[]
  combat: Combat | null
  /** Fog this turn. */
  combatDamagePrevented: boolean
  /** For stack ids of abilities. */
  nextAbilityId: number
  /** What happened this action, beyond the headline — narrated as extra log lines. */
  journal: string[]
  endReason: 'life' | 'library' | 'draw' | null
}

export type GameAction =
  | { type: 'CHOOSE_DECK'; playerId: PlayerId; deck: string }
  | { type: 'MULLIGAN'; playerId: PlayerId }
  | { type: 'KEEP'; playerId: PlayerId; bottom: string[] }
  | { type: 'PLAY_LAND'; playerId: PlayerId; cardId: string }
  | { type: 'CAST'; playerId: PlayerId; cardId: string; targets: Target[]; x?: number }
  | { type: 'ACTIVATE'; playerId: PlayerId; permanentId: string; ability: number; targets: Target[]; x?: number; color?: Color }
  | { type: 'PASS'; playerId: PlayerId }
  | { type: 'DECLARE_ATTACKERS'; playerId: PlayerId; attackers: string[] }
  | { type: 'DECLARE_BLOCKERS'; playerId: PlayerId; blocks: { blocker: string; attacker: string }[] }
  | { type: 'DISCARD'; playerId: PlayerId; cardIds: string[] }

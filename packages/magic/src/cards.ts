// The card pool and the preconstructed decks (RULES.md R-SETUP-02) — pure
// data plus the few helpers that read it. Every card here has all of its
// abilities implemented by ./engine.ts; a base-set card whose abilities the
// engine doesn't model is left out of the pool rather than shipped with some
// missing (RULES.md, preamble).
//
// The rules text is this package's own wording of each card's modern
// Oracle text.

import type { BasicLandType, CardDef, CardType, Color, Keyword, ManaCost, ManaType } from './types.ts'

/** Parses a cost like `2WW` or `XR`. */
export function cost(text: string): ManaCost {
  const c: ManaCost = { generic: 0 }
  for (const m of text.matchAll(/(\d+)|([WUBRG])|(X)/g)) {
    if (m[1]) c.generic += Number(m[1])
    else if (m[2]) {
      const color = m[2] as Color
      c[color] = (c[color] ?? 0) + 1
    } else c.x = true
  }
  return c
}

const COLORS: Color[] = ['W', 'U', 'B', 'R', 'G']

/** A cost as mana symbols, e.g. `{2}{W}{W}`. */
export function costLabel(c: ManaCost | null | undefined): string {
  if (!c) return ''
  let out = c.x ? '{X}' : ''
  if (c.generic > 0 || (!c.x && COLORS.every((k) => !c[k]))) out += `{${c.generic}}`
  for (const k of COLORS) out += `{${k}}`.repeat(c[k] ?? 0)
  return out
}

/** The mana value of a cost (X counts as 0). */
export function manaValue(c: ManaCost | null | undefined): number {
  if (!c) return 0
  return c.generic + COLORS.reduce((n, k) => n + (c[k] ?? 0), 0)
}

const BASICS: Record<BasicLandType, ManaType> = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' }

function basic(name: BasicLandType): CardDef {
  const mana = BASICS[name]
  return {
    id: name.toLowerCase(),
    name,
    cost: null,
    types: ['Land'],
    subtypes: [name],
    abilities: [{ tap: true, produces: mana, effects: [], text: `{T}: Add {${mana}}.` }],
    text: `({T}: Add {${mana}}.)`,
  }
}

function creature(id: string, name: string, manaCost: string, subtypes: string[], power: number, toughness: number, text = '', extra: Partial<CardDef> = {}): CardDef {
  const types: CardType[] = manaCost.match(/[WUBRG]/) ? ['Creature'] : ['Artifact', 'Creature']
  return { id, name, cost: cost(manaCost), types, subtypes, power, toughness, text, ...extra }
}

function kw(...keywords: Keyword[]): Partial<CardDef> {
  return { keywords }
}

const LIST: CardDef[] = [
  basic('Plains'),
  basic('Island'),
  basic('Swamp'),
  basic('Mountain'),
  basic('Forest'),

  // White
  creature('savannah-lions', 'Savannah Lions', 'W', ['Cat'], 2, 1),
  creature('pearled-unicorn', 'Pearled Unicorn', '2W', ['Unicorn'], 2, 2),
  creature('white-knight', 'White Knight', 'WW', ['Human', 'Knight'], 2, 2, 'First strike, protection from black', kw('firstStrike', 'protectionFromBlack')),
  creature('northern-paladin', 'Northern Paladin', '2WW', ['Human', 'Knight'], 3, 3, '{W}{W}, {T}: Destroy target black permanent.', {
    abilities: [{ mana: cost('WW'), tap: true, target: { kind: 'permanent', filter: 'black' }, effects: [{ kind: 'destroy' }], text: '{W}{W}, {T}: Destroy target black permanent.' }],
  }),
  creature('serra-angel', 'Serra Angel', '3WW', ['Angel'], 4, 4, 'Flying, vigilance', kw('flying', 'vigilance')),
  {
    id: 'swords-to-plowshares',
    name: 'Swords to Plowshares',
    cost: cost('W'),
    types: ['Instant'],
    subtypes: [],
    target: { kind: 'creature' },
    effects: [{ kind: 'exileGainLife' }],
    text: 'Exile target creature. Its controller gains life equal to its power.',
  },
  { id: 'holy-strength', name: 'Holy Strength', cost: cost('W'), types: ['Enchantment'], subtypes: ['Aura'], target: { kind: 'creature' }, aura: { power: 1, toughness: 2, keywords: [] }, text: 'Enchant creature. Enchanted creature gets +1/+2.' },
  { id: 'crusade', name: 'Crusade', cost: cost('WW'), types: ['Enchantment'], subtypes: [], statics: [{ kind: 'anthem', color: 'W', power: 1, toughness: 1 }], text: 'White creatures get +1/+1.' },
  { id: 'righteousness', name: 'Righteousness', cost: cost('W'), types: ['Instant'], subtypes: [], target: { kind: 'creature', filter: 'blocking' }, effects: [{ kind: 'pump', who: 'target', power: 7, toughness: 7 }], text: 'Target blocking creature gets +7/+7 until end of turn.' },
  { id: 'disenchant', name: 'Disenchant', cost: cost('1W'), types: ['Instant'], subtypes: [], target: { kind: 'artifactOrEnchantment' }, effects: [{ kind: 'destroy' }], text: 'Destroy target artifact or enchantment.' },
  { id: 'wrath-of-god', name: 'Wrath of God', cost: cost('2WW'), types: ['Sorcery'], subtypes: [], effects: [{ kind: 'destroyAll', what: 'creature' }], text: 'Destroy all creatures.' },

  // Blue
  creature('merfolk-of-the-pearl-trident', 'Merfolk of the Pearl Trident', 'U', ['Merfolk'], 1, 1),
  creature('prodigal-sorcerer', 'Prodigal Sorcerer', '2U', ['Human', 'Wizard'], 1, 1, '{T}: Prodigal Sorcerer deals 1 damage to any target.', {
    abilities: [{ tap: true, target: { kind: 'any' }, effects: [{ kind: 'damage', amount: 1 }], text: '{T}: 1 damage to any target.' }],
  }),
  creature('wall-of-air', 'Wall of Air', '1UU', ['Wall'], 1, 5, 'Defender, flying', kw('defender', 'flying')),
  creature('phantom-monster', 'Phantom Monster', '3U', ['Illusion'], 3, 3, 'Flying', kw('flying')),
  creature('air-elemental', 'Air Elemental', '3UU', ['Elemental'], 4, 4, 'Flying', kw('flying')),
  creature('mahamoti-djinn', 'Mahamoti Djinn', '4UU', ['Djinn'], 5, 6, 'Flying', kw('flying')),
  { id: 'counterspell', name: 'Counterspell', cost: cost('UU'), types: ['Instant'], subtypes: [], target: { kind: 'spell' }, effects: [{ kind: 'counter' }], text: 'Counter target spell.' },
  { id: 'unsummon', name: 'Unsummon', cost: cost('U'), types: ['Instant'], subtypes: [], target: { kind: 'creature' }, effects: [{ kind: 'bounce' }], text: "Return target creature to its owner's hand." },
  { id: 'flight', name: 'Flight', cost: cost('U'), types: ['Enchantment'], subtypes: ['Aura'], target: { kind: 'creature' }, aura: { power: 0, toughness: 0, keywords: ['flying'] }, text: 'Enchant creature. Enchanted creature has flying.' },
  { id: 'ancestral-recall', name: 'Ancestral Recall', cost: cost('U'), types: ['Instant'], subtypes: [], target: { kind: 'player' }, effects: [{ kind: 'draw', who: 'target', amount: 3 }], text: 'Target player draws three cards.' },
  { id: 'braingeyser', name: 'Braingeyser', cost: cost('XUU'), types: ['Sorcery'], subtypes: [], target: { kind: 'player' }, effects: [{ kind: 'draw', who: 'target', amount: 'X' }], text: 'Target player draws X cards.' },

  // Black
  creature('scathe-zombies', 'Scathe Zombies', '2B', ['Zombie'], 2, 2),
  creature('black-knight', 'Black Knight', 'BB', ['Human', 'Knight'], 2, 2, 'First strike, protection from white', kw('firstStrike', 'protectionFromWhite')),
  creature('hypnotic-specter', 'Hypnotic Specter', '1BB', ['Specter'], 2, 2, 'Flying. Whenever Hypnotic Specter deals damage to an opponent, that player discards a card at random.', {
    keywords: ['flying'],
    trigger: 'discardRandomOnDamageToPlayer',
  }),
  creature('royal-assassin', 'Royal Assassin', '1BB', ['Human', 'Assassin'], 1, 1, '{T}: Destroy target tapped creature.', {
    abilities: [{ tap: true, target: { kind: 'creature', filter: 'tapped' }, effects: [{ kind: 'destroy' }], text: '{T}: Destroy target tapped creature.' }],
  }),
  creature('bog-wraith', 'Bog Wraith', '3B', ['Wraith'], 3, 3, 'Swampwalk', kw('swampwalk')),
  creature('nightmare', 'Nightmare', '5B', ['Nightmare', 'Horse'], 0, 0, "Flying. Nightmare's power and toughness are each equal to the number of Swamps you control.", {
    keywords: ['flying'],
    statics: [{ kind: 'ptFromLands', land: 'Swamp' }],
  }),
  { id: 'terror', name: 'Terror', cost: cost('1B'), types: ['Instant'], subtypes: [], target: { kind: 'creature', filter: 'nonartifactNonblack' }, effects: [{ kind: 'destroy' }], text: 'Destroy target nonartifact, nonblack creature.' },
  { id: 'dark-ritual', name: 'Dark Ritual', cost: cost('B'), types: ['Instant'], subtypes: [], effects: [{ kind: 'addMana', mana: ['B', 'B', 'B'] }], text: 'Add {B}{B}{B}.' },
  { id: 'unholy-strength', name: 'Unholy Strength', cost: cost('B'), types: ['Enchantment'], subtypes: ['Aura'], target: { kind: 'creature' }, aura: { power: 2, toughness: 1, keywords: [] }, text: 'Enchant creature. Enchanted creature gets +2/+1.' },
  { id: 'bad-moon', name: 'Bad Moon', cost: cost('1B'), types: ['Enchantment'], subtypes: [], statics: [{ kind: 'anthem', color: 'B', power: 1, toughness: 1 }], text: 'Black creatures get +1/+1.' },
  { id: 'raise-dead', name: 'Raise Dead', cost: cost('B'), types: ['Sorcery'], subtypes: [], target: { kind: 'cardInYourGraveyard', filter: 'creatureCard' }, effects: [{ kind: 'returnToHand' }], text: 'Return target creature card from your graveyard to your hand.' },

  // Red
  creature('mons-goblin-raiders', "Mons's Goblin Raiders", 'R', ['Goblin'], 1, 1),
  creature('goblin-balloon-brigade', 'Goblin Balloon Brigade', 'R', ['Goblin', 'Warrior'], 1, 1, '{R}: Goblin Balloon Brigade gains flying until end of turn.', {
    abilities: [{ mana: cost('R'), effects: [{ kind: 'grant', who: 'self', keyword: 'flying' }], text: '{R}: Gains flying until end of turn.' }],
  }),
  creature('gray-ogre', 'Gray Ogre', '2R', ['Ogre'], 2, 2),
  creature('hill-giant', 'Hill Giant', '3R', ['Giant'], 3, 3),
  creature('earth-elemental', 'Earth Elemental', '3RR', ['Elemental'], 4, 5),
  creature('shivan-dragon', 'Shivan Dragon', '4RR', ['Dragon'], 5, 5, 'Flying. {R}: Shivan Dragon gets +1/+0 until end of turn.', {
    keywords: ['flying'],
    abilities: [{ mana: cost('R'), effects: [{ kind: 'pump', who: 'self', power: 1, toughness: 0 }], text: '{R}: +1/+0 until end of turn.' }],
  }),
  { id: 'lightning-bolt', name: 'Lightning Bolt', cost: cost('R'), types: ['Instant'], subtypes: [], target: { kind: 'any' }, effects: [{ kind: 'damage', amount: 3 }], text: 'Lightning Bolt deals 3 damage to any target.' },
  { id: 'fireball', name: 'Fireball', cost: cost('XR'), types: ['Sorcery'], subtypes: [], target: { kind: 'any' }, effects: [{ kind: 'damage', amount: 'X' }], text: 'Fireball deals X damage to any target.' },
  { id: 'stone-rain', name: 'Stone Rain', cost: cost('2R'), types: ['Sorcery'], subtypes: [], target: { kind: 'land' }, effects: [{ kind: 'destroy' }], text: 'Destroy target land.' },
  { id: 'shatter', name: 'Shatter', cost: cost('1R'), types: ['Instant'], subtypes: [], target: { kind: 'artifact' }, effects: [{ kind: 'destroy' }], text: 'Destroy target artifact.' },
  {
    id: 'firebreathing',
    name: 'Firebreathing',
    cost: cost('R'),
    types: ['Enchantment'],
    subtypes: ['Aura'],
    target: { kind: 'creature' },
    aura: { power: 0, toughness: 0, keywords: [] },
    abilities: [{ mana: cost('R'), effects: [{ kind: 'pump', who: 'enchanted', power: 1, toughness: 0 }], text: '{R}: Enchanted creature gets +1/+0 until end of turn.' }],
    text: 'Enchant creature. {R}: Enchanted creature gets +1/+0 until end of turn.',
  },

  // Green
  creature('llanowar-elves', 'Llanowar Elves', 'G', ['Elf', 'Druid'], 1, 1, '{T}: Add {G}.', { abilities: [{ tap: true, produces: 'G', effects: [], text: '{T}: Add {G}.' }] }),
  creature('birds-of-paradise', 'Birds of Paradise', 'G', ['Bird'], 0, 1, 'Flying. {T}: Add one mana of any color.', {
    keywords: ['flying'],
    abilities: [{ tap: true, produces: 'any', effects: [], text: '{T}: Add one mana of any color.' }],
  }),
  creature('scryb-sprites', 'Scryb Sprites', 'G', ['Faerie'], 1, 1, 'Flying', kw('flying')),
  creature('grizzly-bears', 'Grizzly Bears', '1G', ['Bear'], 2, 2),
  creature('giant-spider', 'Giant Spider', '3G', ['Spider'], 2, 4, 'Reach', kw('reach')),
  creature('ironroot-treefolk', 'Ironroot Treefolk', '4G', ['Treefolk'], 3, 5),
  creature('war-mammoth', 'War Mammoth', '3GG', ['Elephant'], 3, 3, 'Trample', kw('trample')),
  creature('craw-wurm', 'Craw Wurm', '4GG', ['Wurm'], 6, 4),
  { id: 'giant-growth', name: 'Giant Growth', cost: cost('G'), types: ['Instant'], subtypes: [], target: { kind: 'creature' }, effects: [{ kind: 'pump', who: 'target', power: 3, toughness: 3 }], text: 'Target creature gets +3/+3 until end of turn.' },
  { id: 'fog', name: 'Fog', cost: cost('G'), types: ['Instant'], subtypes: [], effects: [{ kind: 'fog' }], text: 'Prevent all combat damage that would be dealt this turn.' },
  { id: 'stream-of-life', name: 'Stream of Life', cost: cost('XG'), types: ['Sorcery'], subtypes: [], target: { kind: 'player' }, effects: [{ kind: 'gainLife', who: 'target', amount: 'X' }], text: 'Target player gains X life.' },
  { id: 'regrowth', name: 'Regrowth', cost: cost('1G'), types: ['Sorcery'], subtypes: [], target: { kind: 'cardInYourGraveyard' }, effects: [{ kind: 'returnToHand' }], text: 'Return target card from your graveyard to your hand.' },

  // Artifacts
  creature('juggernaut', 'Juggernaut', '4', ['Juggernaut'], 5, 3, 'Juggernaut attacks each combat if able. Juggernaut can’t be blocked by Walls.', kw('attacksEachCombat', 'unblockableByWalls')),
  creature('obsianus-golem', 'Obsianus Golem', '6', ['Golem'], 4, 6),
]

export const CARDS: Record<string, CardDef> = Object.fromEntries(LIST.map((c) => [c.id, c]))

/** The card definition for a card id like `p1-07`'s `def`. */
export function cardDef(def: string): CardDef {
  const card = CARDS[def]
  if (!card) throw new Error(`Unknown card: ${def}`)
  return card
}

export function cardName(def: string): string {
  return CARDS[def]?.name ?? 'a card'
}

/** R-CHAR-01. */
export function colorsOf(def: string): Color[] {
  const c = CARDS[def]?.cost
  return c ? COLORS.filter((k) => (c[k] ?? 0) > 0) : []
}

export interface Deck {
  id: string
  name: string
  color: Color
  /** Card id → copies; 40 cards in all. */
  cards: [string, number][]
}

/** R-SETUP-02: one 40-card deck per colour. */
export const DECKS: Deck[] = [
  {
    id: 'white',
    name: 'White Knights',
    color: 'W',
    cards: [
      ['plains', 17],
      ['savannah-lions', 3],
      ['pearled-unicorn', 3],
      ['white-knight', 3],
      ['northern-paladin', 2],
      ['serra-angel', 2],
      ['juggernaut', 1],
      ['swords-to-plowshares', 2],
      ['holy-strength', 2],
      ['crusade', 1],
      ['righteousness', 2],
      ['disenchant', 1],
      ['wrath-of-god', 1],
    ],
  },
  {
    id: 'blue',
    name: 'Blue Skies',
    color: 'U',
    cards: [
      ['island', 17],
      ['merfolk-of-the-pearl-trident', 3],
      ['prodigal-sorcerer', 2],
      ['wall-of-air', 2],
      ['phantom-monster', 3],
      ['air-elemental', 2],
      ['mahamoti-djinn', 2],
      ['obsianus-golem', 1],
      ['counterspell', 3],
      ['unsummon', 2],
      ['flight', 1],
      ['ancestral-recall', 1],
      ['braingeyser', 1],
    ],
  },
  {
    id: 'black',
    name: 'Black Terror',
    color: 'B',
    cards: [
      ['swamp', 17],
      ['scathe-zombies', 2],
      ['black-knight', 3],
      ['hypnotic-specter', 3],
      ['royal-assassin', 2],
      ['bog-wraith', 3],
      ['nightmare', 1],
      ['juggernaut', 1],
      ['terror', 3],
      ['dark-ritual', 2],
      ['unholy-strength', 1],
      ['bad-moon', 1],
      ['raise-dead', 1],
    ],
  },
  {
    id: 'red',
    name: 'Red Fire',
    color: 'R',
    cards: [
      ['mountain', 17],
      ['mons-goblin-raiders', 3],
      ['goblin-balloon-brigade', 2],
      ['gray-ogre', 3],
      ['hill-giant', 3],
      ['earth-elemental', 2],
      ['shivan-dragon', 1],
      ['lightning-bolt', 4],
      ['fireball', 2],
      ['firebreathing', 1],
      ['stone-rain', 1],
      ['shatter', 1],
    ],
  },
  {
    id: 'green',
    name: 'Green Might',
    color: 'G',
    cards: [
      ['forest', 17],
      ['llanowar-elves', 3],
      ['birds-of-paradise', 1],
      ['scryb-sprites', 2],
      ['grizzly-bears', 3],
      ['giant-spider', 2],
      ['ironroot-treefolk', 2],
      ['war-mammoth', 2],
      ['craw-wurm', 2],
      ['giant-growth', 3],
      ['fog', 1],
      ['stream-of-life', 1],
      ['regrowth', 1],
    ],
  },
]

export function findDeck(id: string): Deck | undefined {
  return DECKS.find((d) => d.id === id)
}

/** Every card in `deck` as a flat list of card ids, in list order. */
export function deckList(deck: Deck): string[] {
  return deck.cards.flatMap(([def, n]) => Array.from({ length: n }, () => def))
}

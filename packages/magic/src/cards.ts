// The card pool, the preconstructed decks (RULES.md R-SETUP-02) and the
// Commander decks (R-CMD-01) — pure data plus the few helpers that read it.
// The base-set decks use only base-set cards; the Commander decks add cards
// from later sets (and their two legendary commanders, from Legends) to
// reach 100 singletons, which a standard game can never see. Every card here has all of its
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

/** The basic lands' card ids — the only cards a Commander deck may hold more than one of (R-CMD-01). */
export const BASIC_LAND_IDS: readonly string[] = ['plains', 'island', 'swamp', 'mountain', 'forest']

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

  // --- Cards from later sets, for the Commander decks (R-CMD-01) ---

  // Commanders (Legends)
  creature('tobias-andrion', 'Tobias Andrion', '3WU', ['Human', 'Advisor'], 4, 4, '', { legendary: true }),
  creature('jerrard-of-the-closed-fist', 'Jerrard of the Closed Fist', '3RGG', ['Human', 'Knight'], 6, 5, '', { legendary: true }),

  // White
  creature('tundra-wolves', 'Tundra Wolves', 'W', ['Wolf'], 1, 1, 'First strike', kw('firstStrike')),
  creature('elite-vanguard', 'Elite Vanguard', 'W', ['Human', 'Soldier'], 2, 1),
  creature('suntail-hawk', 'Suntail Hawk', 'W', ['Bird'], 1, 1, 'Flying', kw('flying')),
  creature('youthful-knight', 'Youthful Knight', '1W', ['Human', 'Knight'], 2, 1, 'First strike', kw('firstStrike')),
  creature('silvercoat-lion', 'Silvercoat Lion', '1W', ['Cat'], 2, 2),
  creature('standing-troops', 'Standing Troops', '2W', ['Human', 'Soldier'], 1, 4, 'Vigilance', kw('vigilance')),
  creature('skyhunter-patrol', 'Skyhunter Patrol', '2WW', ['Cat', 'Knight'], 2, 3, 'Flying, first strike', kw('flying', 'firstStrike')),
  creature('pillarfield-ox', 'Pillarfield Ox', '3W', ['Ox'], 2, 4),
  creature('razorfoot-griffin', 'Razorfoot Griffin', '3W', ['Griffin'], 2, 2, 'Flying, first strike', kw('flying', 'firstStrike')),
  creature('wall-of-swords', 'Wall of Swords', '3W', ['Wall'], 3, 5, 'Defender, flying', kw('defender', 'flying')),
  creature('ardent-militia', 'Ardent Militia', '4W', ['Human', 'Soldier'], 2, 5, 'Vigilance', kw('vigilance')),
  {
    id: 'holy-armor',
    name: 'Holy Armor',
    cost: cost('W'),
    types: ['Enchantment'],
    subtypes: ['Aura'],
    target: { kind: 'creature' },
    aura: { power: 0, toughness: 2, keywords: [] },
    abilities: [{ mana: cost('W'), effects: [{ kind: 'pump', who: 'enchanted', power: 0, toughness: 1 }], text: '{W}: Enchanted creature gets +0/+1 until end of turn.' }],
    text: 'Enchant creature. Enchanted creature gets +0/+2. {W}: Enchanted creature gets +0/+1 until end of turn.',
  },
  {
    id: 'blessing',
    name: 'Blessing',
    cost: cost('WW'),
    types: ['Enchantment'],
    subtypes: ['Aura'],
    target: { kind: 'creature' },
    aura: { power: 0, toughness: 0, keywords: [] },
    abilities: [{ mana: cost('W'), effects: [{ kind: 'pump', who: 'enchanted', power: 1, toughness: 1 }], text: '{W}: Enchanted creature gets +1/+1 until end of turn.' }],
    text: 'Enchant creature. {W}: Enchanted creature gets +1/+1 until end of turn.',
  },
  { id: 'warriors-honor', name: "Warrior's Honor", cost: cost('2W'), types: ['Instant'], subtypes: [], effects: [{ kind: 'pumpAll', power: 1, toughness: 1 }], text: 'Creatures you control get +1/+1 until end of turn.' },

  // Blue
  creature('storm-crow', 'Storm Crow', '1U', ['Bird'], 1, 2, 'Flying', kw('flying')),
  creature('wind-drake', 'Wind Drake', '2U', ['Drake'], 2, 2, 'Flying', kw('flying')),
  creature('horned-turtle', 'Horned Turtle', '2U', ['Turtle'], 1, 4),
  creature('phantom-warrior', 'Phantom Warrior', '1UU', ['Illusion', 'Warrior'], 2, 2, 'Phantom Warrior can’t be blocked.', kw('unblockable')),
  creature('wall-of-water', 'Wall of Water', '1UU', ['Wall'], 0, 5, 'Defender. {U}: Wall of Water gets +1/+0 until end of turn.', {
    keywords: ['defender'],
    abilities: [{ mana: cost('U'), effects: [{ kind: 'pump', who: 'self', power: 1, toughness: 0 }], text: '{U}: +1/+0 until end of turn.' }],
  }),
  creature('azure-drake', 'Azure Drake', '3U', ['Drake'], 2, 4, 'Flying', kw('flying')),
  creature('snapping-drake', 'Snapping Drake', '3U', ['Drake'], 3, 2, 'Flying', kw('flying')),
  { id: 'remove-soul', name: 'Remove Soul', cost: cost('1U'), types: ['Instant'], subtypes: [], target: { kind: 'spell', filter: 'creatureSpell' }, effects: [{ kind: 'counter' }], text: 'Counter target creature spell.' },
  { id: 'cancel', name: 'Cancel', cost: cost('1UU'), types: ['Instant'], subtypes: [], target: { kind: 'spell' }, effects: [{ kind: 'counter' }], text: 'Counter target spell.' },
  { id: 'boomerang', name: 'Boomerang', cost: cost('UU'), types: ['Instant'], subtypes: [], target: { kind: 'permanent' }, effects: [{ kind: 'bounce' }], text: "Return target permanent to its owner's hand." },
  { id: 'divination', name: 'Divination', cost: cost('2U'), types: ['Sorcery'], subtypes: [], effects: [{ kind: 'draw', who: 'you', amount: 2 }], text: 'Draw two cards.' },
  { id: 'inspiration', name: 'Inspiration', cost: cost('3U'), types: ['Instant'], subtypes: [], target: { kind: 'player' }, effects: [{ kind: 'draw', who: 'target', amount: 2 }], text: 'Target player draws two cards.' },

  // Red
  creature('raging-goblin', 'Raging Goblin', 'R', ['Goblin', 'Berserker'], 1, 1, 'Haste', kw('haste')),
  creature('goblin-hero', 'Goblin Hero', '2R', ['Goblin'], 2, 2),
  creature('bloodrock-cyclops', 'Bloodrock Cyclops', '2R', ['Cyclops'], 3, 3, 'Bloodrock Cyclops attacks each combat if able.', kw('attacksEachCombat')),
  creature('granite-gargoyle', 'Granite Gargoyle', '2R', ['Gargoyle'], 2, 2, 'Flying. {R}: Granite Gargoyle gets +0/+1 until end of turn.', {
    keywords: ['flying'],
    abilities: [{ mana: cost('R'), effects: [{ kind: 'pump', who: 'self', power: 0, toughness: 1 }], text: '{R}: +0/+1 until end of turn.' }],
  }),
  creature('furnace-whelp', 'Furnace Whelp', '2RR', ['Dragon'], 2, 2, 'Flying. {R}: Furnace Whelp gets +1/+0 until end of turn.', {
    keywords: ['flying'],
    abilities: [{ mana: cost('R'), effects: [{ kind: 'pump', who: 'self', power: 1, toughness: 0 }], text: '{R}: +1/+0 until end of turn.' }],
  }),
  creature('lightning-elemental', 'Lightning Elemental', '3R', ['Elemental'], 4, 1, 'Haste', kw('haste')),
  creature('fire-elemental', 'Fire Elemental', '3RR', ['Elemental'], 5, 4),
  { id: 'shock', name: 'Shock', cost: cost('R'), types: ['Instant'], subtypes: [], target: { kind: 'any' }, effects: [{ kind: 'damage', amount: 2 }], text: 'Shock deals 2 damage to any target.' },
  { id: 'volcanic-hammer', name: 'Volcanic Hammer', cost: cost('1R'), types: ['Sorcery'], subtypes: [], target: { kind: 'any' }, effects: [{ kind: 'damage', amount: 3 }], text: 'Volcanic Hammer deals 3 damage to any target.' },
  { id: 'lava-axe', name: 'Lava Axe', cost: cost('4R'), types: ['Sorcery'], subtypes: [], target: { kind: 'player' }, effects: [{ kind: 'damage', amount: 5 }], text: 'Lava Axe deals 5 damage to target player.' },
  { id: 'trumpet-blast', name: 'Trumpet Blast', cost: cost('2R'), types: ['Instant'], subtypes: [], effects: [{ kind: 'pumpAll', power: 2, toughness: 0, attacking: true }], text: 'Attacking creatures get +2/+0 until end of turn.' },
  { id: 'pyroclasm', name: 'Pyroclasm', cost: cost('1R'), types: ['Sorcery'], subtypes: [], effects: [{ kind: 'damageEach', amount: 2, creatures: 'all', players: false }], text: 'Pyroclasm deals 2 damage to each creature.' },
  {
    id: 'earthquake',
    name: 'Earthquake',
    cost: cost('XR'),
    types: ['Sorcery'],
    subtypes: [],
    effects: [{ kind: 'damageEach', amount: 'X', creatures: 'nonflying', players: true }],
    text: 'Earthquake deals X damage to each creature without flying and each player.',
  },

  // Green
  creature('fyndhorn-elves', 'Fyndhorn Elves', 'G', ['Elf', 'Druid'], 1, 1, '{T}: Add {G}.', { abilities: [{ tap: true, produces: 'G', effects: [], text: '{T}: Add {G}.' }] }),
  creature('elvish-mystic', 'Elvish Mystic', 'G', ['Elf', 'Druid'], 1, 1, '{T}: Add {G}.', { abilities: [{ tap: true, produces: 'G', effects: [], text: '{T}: Add {G}.' }] }),
  creature('shanodin-dryads', 'Shanodin Dryads', 'G', ['Nymph', 'Dryad'], 1, 1, 'Forestwalk', kw('forestwalk')),
  creature('canopy-spider', 'Canopy Spider', '1G', ['Spider'], 1, 3, 'Reach', kw('reach')),
  creature('elvish-warrior', 'Elvish Warrior', 'GG', ['Elf', 'Warrior'], 2, 3),
  creature('trained-armodon', 'Trained Armodon', '1GG', ['Elephant'], 3, 3),
  creature('durkwood-boars', 'Durkwood Boars', '4G', ['Boar'], 4, 4),
  creature('spined-wurm', 'Spined Wurm', '4G', ['Wurm'], 5, 4),
  { id: 'titanic-growth', name: 'Titanic Growth', cost: cost('1G'), types: ['Instant'], subtypes: [], target: { kind: 'creature' }, effects: [{ kind: 'pump', who: 'target', power: 4, toughness: 4 }], text: 'Target creature gets +4/+4 until end of turn.' },
  { id: 'monstrous-growth', name: 'Monstrous Growth', cost: cost('1G'), types: ['Sorcery'], subtypes: [], target: { kind: 'creature' }, effects: [{ kind: 'pump', who: 'target', power: 4, toughness: 4 }], text: 'Target creature gets +4/+4 until end of turn.' },
  {
    id: 'overrun',
    name: 'Overrun',
    cost: cost('2GGG'),
    types: ['Sorcery'],
    subtypes: [],
    effects: [{ kind: 'pumpAll', power: 3, toughness: 3, keyword: 'trample' }],
    text: 'Creatures you control get +3/+3 and gain trample until end of turn.',
  },
  {
    id: 'hurricane',
    name: 'Hurricane',
    cost: cost('XG'),
    types: ['Sorcery'],
    subtypes: [],
    effects: [{ kind: 'damageEach', amount: 'X', creatures: 'flying', players: true }],
    text: 'Hurricane deals X damage to each creature with flying and each player.',
  },

  // Artifacts
  creature('ornithopter', 'Ornithopter', '0', ['Thopter'], 0, 2, 'Flying', kw('flying')),
  creature('phyrexian-walker', 'Phyrexian Walker', '0', ['Phyrexian', 'Construct'], 0, 3),
  creature('wall-of-spears', 'Wall of Spears', '3', ['Wall'], 2, 3, 'Defender, first strike', kw('defender', 'firstStrike')),
  creature('yotian-soldier', 'Yotian Soldier', '3', ['Soldier'], 1, 4, 'Vigilance', kw('vigilance')),
  creature('dragon-engine', 'Dragon Engine', '3', ['Construct'], 1, 3, '{2}: Dragon Engine gets +1/+0 until end of turn.', {
    abilities: [{ mana: cost('2'), effects: [{ kind: 'pump', who: 'self', power: 1, toughness: 0 }], text: '{2}: +1/+0 until end of turn.' }],
  }),
  creature('patagia-golem', 'Patagia Golem', '4', ['Golem'], 2, 3, '{3}: Patagia Golem gains flying until end of turn.', {
    abilities: [{ mana: cost('3'), effects: [{ kind: 'grant', who: 'self', keyword: 'flying' }], text: '{3}: Gains flying until end of turn.' }],
  }),
  creature('dancing-scimitar', 'Dancing Scimitar', '4', ['Spirit'], 1, 5, 'Flying', kw('flying')),
  { id: 'sol-ring', name: 'Sol Ring', cost: cost('1'), types: ['Artifact'], subtypes: [], abilities: [{ tap: true, produces: 'C', amount: 2, effects: [], text: '{T}: Add {C}{C}.' }], text: '{T}: Add {C}{C}.' },
  { id: 'manalith', name: 'Manalith', cost: cost('3'), types: ['Artifact'], subtypes: [], abilities: [{ tap: true, produces: 'any', effects: [], text: '{T}: Add one mana of any color.' }], text: '{T}: Add one mana of any color.' },
  {
    id: 'fountain-of-youth',
    name: 'Fountain of Youth',
    cost: cost('0'),
    types: ['Artifact'],
    subtypes: [],
    abilities: [{ mana: cost('2'), tap: true, effects: [{ kind: 'gainLife', who: 'you', amount: 1 }], text: '{2}, {T}: You gain 1 life.' }],
    text: '{2}, {T}: You gain 1 life.',
  },
  {
    id: 'rod-of-ruin',
    name: 'Rod of Ruin',
    cost: cost('4'),
    types: ['Artifact'],
    subtypes: [],
    abilities: [{ mana: cost('3'), tap: true, target: { kind: 'any' }, effects: [{ kind: 'damage', amount: 1 }], text: '{3}, {T}: 1 damage to any target.' }],
    text: '{3}, {T}: Rod of Ruin deals 1 damage to any target.',
  },
  {
    id: 'jayemdae-tome',
    name: 'Jayemdae Tome',
    cost: cost('4'),
    types: ['Artifact'],
    subtypes: [],
    abilities: [{ mana: cost('4'), tap: true, effects: [{ kind: 'draw', who: 'you', amount: 1 }], text: '{4}, {T}: Draw a card.' }],
    text: '{4}, {T}: Draw a card.',
  },

  // Artifacts (base set)
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

/** R-CMD-01: a Commander deck — a legendary creature and 99 more cards, one of each but basic lands, within its colours. */
export interface CommanderDeck {
  id: string
  name: string
  /** The commander's card id; it starts in the command zone, not the library. */
  commander: string
  /** Card id → copies; 99 cards in all. */
  cards: [string, number][]
}

const SHARED_ARTIFACTS: [string, number][] = [
  ['sol-ring', 1],
  ['manalith', 1],
  ['fountain-of-youth', 1],
  ['ornithopter', 1],
  ['phyrexian-walker', 1],
  ['wall-of-spears', 1],
  ['yotian-soldier', 1],
  ['dragon-engine', 1],
  ['patagia-golem', 1],
  ['dancing-scimitar', 1],
  ['rod-of-ruin', 1],
  ['jayemdae-tome', 1],
  ['juggernaut', 1],
  ['obsianus-golem', 1],
]

/** R-CMD-01: the two Commander decks. */
export const COMMANDER_DECKS: CommanderDeck[] = [
  {
    id: 'tobias',
    name: "Tobias's Skies",
    commander: 'tobias-andrion',
    cards: [
      ['plains', 19],
      ['island', 18],
      // White
      ['savannah-lions', 1],
      ['tundra-wolves', 1],
      ['elite-vanguard', 1],
      ['suntail-hawk', 1],
      ['white-knight', 1],
      ['youthful-knight', 1],
      ['silvercoat-lion', 1],
      ['pearled-unicorn', 1],
      ['standing-troops', 1],
      ['northern-paladin', 1],
      ['skyhunter-patrol', 1],
      ['pillarfield-ox', 1],
      ['razorfoot-griffin', 1],
      ['wall-of-swords', 1],
      ['ardent-militia', 1],
      ['serra-angel', 1],
      ['swords-to-plowshares', 1],
      ['righteousness', 1],
      ['disenchant', 1],
      ['warriors-honor', 1],
      ['wrath-of-god', 1],
      ['holy-strength', 1],
      ['holy-armor', 1],
      ['blessing', 1],
      ['crusade', 1],
      // Blue
      ['merfolk-of-the-pearl-trident', 1],
      ['storm-crow', 1],
      ['wind-drake', 1],
      ['horned-turtle', 1],
      ['prodigal-sorcerer', 1],
      ['wall-of-air', 1],
      ['phantom-warrior', 1],
      ['wall-of-water', 1],
      ['phantom-monster', 1],
      ['azure-drake', 1],
      ['snapping-drake', 1],
      ['air-elemental', 1],
      ['mahamoti-djinn', 1],
      ['ancestral-recall', 1],
      ['unsummon', 1],
      ['flight', 1],
      ['remove-soul', 1],
      ['counterspell', 1],
      ['boomerang', 1],
      ['cancel', 1],
      ['divination', 1],
      ['inspiration', 1],
      ['braingeyser', 1],
      ...SHARED_ARTIFACTS,
    ],
  },
  {
    id: 'jerrard',
    name: "Jerrard's Stampede",
    commander: 'jerrard-of-the-closed-fist',
    cards: [
      ['mountain', 18],
      ['forest', 19],
      // Red
      ['mons-goblin-raiders', 1],
      ['goblin-balloon-brigade', 1],
      ['raging-goblin', 1],
      ['gray-ogre', 1],
      ['goblin-hero', 1],
      ['bloodrock-cyclops', 1],
      ['granite-gargoyle', 1],
      ['hill-giant', 1],
      ['lightning-elemental', 1],
      ['furnace-whelp', 1],
      ['earth-elemental', 1],
      ['fire-elemental', 1],
      ['shivan-dragon', 1],
      ['lightning-bolt', 1],
      ['shock', 1],
      ['shatter', 1],
      ['volcanic-hammer', 1],
      ['pyroclasm', 1],
      ['trumpet-blast', 1],
      ['stone-rain', 1],
      ['lava-axe', 1],
      ['fireball', 1],
      ['earthquake', 1],
      ['firebreathing', 1],
      // Green
      ['llanowar-elves', 1],
      ['fyndhorn-elves', 1],
      ['elvish-mystic', 1],
      ['birds-of-paradise', 1],
      ['scryb-sprites', 1],
      ['shanodin-dryads', 1],
      ['grizzly-bears', 1],
      ['canopy-spider', 1],
      ['elvish-warrior', 1],
      ['trained-armodon', 1],
      ['giant-spider', 1],
      ['ironroot-treefolk', 1],
      ['durkwood-boars', 1],
      ['spined-wurm', 1],
      ['war-mammoth', 1],
      ['craw-wurm', 1],
      ['giant-growth', 1],
      ['fog', 1],
      ['titanic-growth', 1],
      ['monstrous-growth', 1],
      ['regrowth', 1],
      ['stream-of-life', 1],
      ['hurricane', 1],
      ['overrun', 1],
      ...SHARED_ARTIFACTS,
    ],
  },
]

/** The decks a game may choose from: COMMANDER_DECKS in a Commander game, DECKS otherwise (R-SETUP-02, R-CMD-01). */
export function decksFor(commander: boolean): readonly (Deck | CommanderDeck)[] {
  return commander ? COMMANDER_DECKS : DECKS
}

/** A deck of either kind by id (the ids don't overlap). */
export function findDeck(id: string): Deck | CommanderDeck | undefined {
  return DECKS.find((d) => d.id === id) ?? COMMANDER_DECKS.find((d) => d.id === id)
}

export function isCommanderDeck(deck: Deck | CommanderDeck): deck is CommanderDeck {
  return 'commander' in deck
}

/** Every card in `deck`'s library as a flat list of card ids, in list order (a commander is not part of it). */
export function deckList(deck: Deck | CommanderDeck): string[] {
  return deck.cards.flatMap(([def, n]) => Array.from({ length: n }, () => def))
}

/**
 * R-CMD-01: a card's colour identity — the colours of the mana symbols in
 * its cost and its rules text. For this pool that's its colours plus, for a
 * land or a mana source of one colour, the colour of the mana it makes.
 */
export function colorIdentity(def: string): Color[] {
  const d = cardDef(def)
  const out = new Set<Color>(colorsOf(def))
  for (const a of d.abilities ?? []) {
    if (a.produces && a.produces !== 'any' && a.produces !== 'C') out.add(a.produces)
    for (const k of COLORS) if ((a.mana?.[k] ?? 0) > 0) out.add(k)
  }
  return COLORS.filter((k) => out.has(k))
}

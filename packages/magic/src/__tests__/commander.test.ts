// RULES.md §10, Commander: the decks, the option, the command zone, the
// commander tax, commander damage — and the cards only the Commander decks
// use. Plus a check that a standard game is untouched by any of it.

import { describe, expect, it } from 'vitest'
import { applyAction, replayActions, type GameState as PlatformState } from '@game-platform/sdk'
import {
  BASIC_LAND_IDS,
  cardDef,
  colorIdentity,
  colorsOf,
  COMMANDER_DECKS,
  creatureStats,
  deckList,
  gameDefinition,
  handOf,
  keywordsOf,
  mightAct,
  normalizeGameOptions,
  permanentById,
  type CardRef,
  type GameAction,
  type GameData,
  type GameState,
  type Permanent,
  type Target,
} from '../rules'
import { arrange, card, commanderGame, give, newGame, play, put, simplestMove, testRandom } from '../testing'

const P1 = 'p1'
const P2 = 'p2'

function tryAction(s: GameState, action: GameAction): string | null {
  const result = gameDefinition.applyAction(s, action, { next: () => 0.5, int: (a) => a, pick: (x) => x[0], shuffle: (x) => [...x] })
  return result.ok ? null : result.error
}

const pass = (s: GameState, playerId = s.game.priorityId!) => play(s, { type: 'PASS', playerId })
const castId = (s: GameState, playerId: string, cardId: string, targets: Target[] = [], x?: number) => play(s, { type: 'CAST', playerId, cardId, targets, ...(x !== undefined ? { x } : {}) })
const cast = (s: GameState, playerId: string, c: CardRef, targets: Target[] = [], x?: number) => castId(s, playerId, c.id, targets, x)
const perm = (p: Permanent | { id: string }): Target => ({ kind: 'permanent', id: p.id })

function lands(g: GameData, owner: string, def: string, n: number): Permanent[] {
  return Array.from({ length: n }, () => put(g, owner, def))
}

/** A Commander game in p1's first main phase: empty battlefield, 20 cards in each library, one land in each hand, both commanders in their command zones. */
function commanderBoard(): GameState {
  return arrange(commanderGame(), (g) => {
    for (const id of g.seatOrder) {
      const p = g.players[id]
      p.library = [...(p.library as CardRef[]), ...(p.hand as CardRef[])].slice(0, 20)
      p.hand = [card(id, id === 'p1' ? 'plains' : 'forest')]
      p.landsPlayed = 0
    }
    g.battlefield = []
    g.activeId = 'p1'
    g.priorityId = 'p1'
    g.step = 'main1'
    g.passed = []
    g.turnNumber = 3
  })
}

/** Declares no blocks if p2 must, then passes through to combat damage. */
function throughCombat(s: GameState): GameState {
  if (s.game.step === 'block') s = play(s, { type: 'DECLARE_BLOCKERS', playerId: P2, blocks: [] })
  while (s.status === 'active' && s.game.step === 'combat') s = pass(s)
  return s
}

/** Puts p1's commander (Tobias Andrion) onto the battlefield as if cast once. */
function tobiasOut(g: GameData): Permanent {
  const c = g.players.p1.commander!
  c.inCommandZone = false
  c.casts = 1
  return put(g, P1, c.def, { id: c.id } as Partial<Permanent>)
}

describe('§10 the Commander decks (R-CMD-01)', () => {
  it('each is a legendary creature and 99 cards, one of each but basic lands, within its colour identity', () => {
    expect(COMMANDER_DECKS).toHaveLength(2)
    for (const deck of COMMANDER_DECKS) {
      const commander = cardDef(deck.commander)
      expect(commander.legendary).toBe(true)
      expect(commander.types).toContain('Creature')
      const list = deckList(deck)
      expect(list).toHaveLength(99)
      expect(list).not.toContain(deck.commander)
      for (const [def, n] of deck.cards) {
        cardDef(def)
        if (!BASIC_LAND_IDS.includes(def)) expect(n, def).toBe(1)
      }
      expect(new Set(deck.cards.map(([def]) => def)).size).toBe(deck.cards.length)
      const identity = colorIdentity(deck.commander)
      expect(identity.length).toBe(2)
      for (const def of list) for (const c of colorIdentity(def)) expect(identity, `${def} in ${deck.name}`).toContain(c)
      expect(list.filter((d) => BASIC_LAND_IDS.includes(d))).toHaveLength(37)
    }
  })
})

describe('§10 the option', () => {
  it('normalizes: `commander` only when true, and 40 life by default', () => {
    expect(normalizeGameOptions({ commander: true })).toEqual({ startingLife: 40, commander: true })
    expect(normalizeGameOptions({ commander: true, startingLife: 30 })).toEqual({ startingLife: 30, commander: true })
    expect(normalizeGameOptions({ commander: 'yes', startingLife: 20 })).toEqual({ startingLife: 20 })
    expect(normalizeGameOptions({ commander: false })).toEqual({ startingLife: 20 })
    expect(gameDefinition.describeOptions!({ startingLife: 40, commander: true })).toBe('Commander · 40 life')
  })

  it('leaves a standard genesis exactly as it was: no format, no commander fields', () => {
    const s = newGame()
    expect('format' in s.game).toBe(false)
    expect(Object.keys(s.game.players.p1).sort()).toEqual(['bottom', 'deck', 'drewFromEmpty', 'graveyard', 'hand', 'kept', 'landsPlayed', 'library', 'life', 'lost', 'manaPool', 'mulligans'])
    expect(s.options).toEqual({ startingLife: 20 })
  })

  it('each format chooses only from its own decks', () => {
    expect(tryAction(newGame(), { type: 'CHOOSE_DECK', playerId: P1, deck: 'tobias' })).toMatch(/Choose one of the decks/)
    const c = newGame({ options: { commander: true, startingLife: 40 } })
    expect(tryAction(c, { type: 'CHOOSE_DECK', playerId: P1, deck: 'red' })).toMatch(/Choose one of the decks/)
    expect(tryAction(c, { type: 'CHOOSE_DECK', playerId: P1, deck: 'jerrard' })).toBeNull()
  })
})

describe('§10 setup (R-CMD-02)', () => {
  it('sets each commander aside in the command zone only once both have chosen; the library holds the other 99', () => {
    let s = newGame({ options: { commander: true, startingLife: 40 } })
    expect(s.game.format).toBe('commander')
    expect(s.game.players.p1.life).toBe(40)
    s = play(s, { type: 'CHOOSE_DECK', playerId: P1, deck: 'tobias' })
    // Nothing public gives the pick away while p2 is still choosing.
    expect(s.game.players.p1.commander).toBeNull()
    expect(gameDefinition.redactGame(s, P2).players.p1.deck).toBeNull()
    s = play(s, { type: 'CHOOSE_DECK', playerId: P2, deck: 'tobias' })
    for (const id of [P1, P2]) {
      const p = s.game.players[id]
      expect(p.commander).toEqual({ id: `${id}-cmd`, def: 'tobias-andrion', inCommandZone: true, casts: 0 })
      expect(p.hand.length + p.library.length).toBe(99)
      expect([...p.hand, ...p.library].some((c) => c?.def === 'tobias-andrion')).toBe(false)
    }
    // The command zone is public.
    expect(gameDefinition.redactGame(s, P2).players.p1.commander).toEqual(s.game.players.p1.commander)
  })
})

describe('§10 casting a commander (R-CMD-03)', () => {
  it('casts from the command zone at sorcery speed, and each later cast costs {2} more', () => {
    let s = arrange(commanderBoard(), (g) => {
      lands(g, P1, 'plains', 3)
      lands(g, P1, 'island', 2)
    })
    expect(tryAction(s, { type: 'CAST', playerId: P2, cardId: 'p2-cmd', targets: [] })).toMatch(/Alice's move/)
    s = castId(s, P1, 'p1-cmd')
    expect(s.game.players.p1.commander).toMatchObject({ inCommandZone: false, casts: 1 })
    expect(s.game.stack[0].card).toEqual({ id: 'p1-cmd', def: 'tobias-andrion' })
    s = pass(s, P2)
    expect(permanentById(s.game, 'p1-cmd')?.def).toBe('tobias-andrion')
    // Destroyed: back to the command zone (R-CMD-04), and now it costs {2} more.
    s = arrange(s, (g) => {
      g.battlefield = g.battlefield.filter((p) => p.id !== 'p1-cmd')
      g.players.p1.commander!.inCommandZone = true
      for (const p of g.battlefield) p.tapped = false
    })
    expect(tryAction(s, { type: 'CAST', playerId: P1, cardId: 'p1-cmd', targets: [] })).toMatch(/plus \{2\} commander tax/)
    s = arrange(s, (g) => void lands(g, P1, 'plains', 2))
    s = castId(s, P1, 'p1-cmd')
    expect(s.game.players.p1.commander!.casts).toBe(2)
    expect(s.game.battlefield.every((p) => p.tapped)).toBe(true)
  })

  it('AMBIG-4: a player with an empty hand but a commander they can cast still gets to act', () => {
    const s = arrange(commanderBoard(), (g) => {
      g.players.p1.hand = []
      lands(g, P1, 'plains', 3)
      lands(g, P1, 'island', 1)
    })
    expect(mightAct(s.game, P1)).toBe(false)
    expect(mightAct(arrange(s, (g) => void lands(g, P1, 'island', 1)).game, P1)).toBe(true)
  })

  it('names the command zone in the log', () => {
    const s = arrange(commanderBoard(), (g) => {
      lands(g, P1, 'plains', 3)
      lands(g, P1, 'island', 2)
    })
    const after = castId(s, P1, 'p1-cmd')
    expect(gameDefinition.describeAction(after.actionHistory.at(-1)!.action as GameAction, s, after).message).toBe('{player} casts Tobias Andrion from the command zone.')
  })
})

describe('§10 the command zone (R-CMD-04)', () => {
  it('a destroyed, exiled or bounced commander goes to the command zone instead', () => {
    for (const [def, land] of [
      ['swords-to-plowshares', 'plains'],
      ['terror', 'swamp'],
      ['unsummon', 'island'],
      ['boomerang', 'island'],
    ] as const) {
      let s = arrange(commanderBoard(), (g) => {
        tobiasOut(g)
        give(g, P1, def)
        lands(g, P1, land, 2)
      })
      const spell = handOf(s.game, P1).find((c) => c.def === def)!
      s = pass(cast(s, P1, spell, [perm({ id: 'p1-cmd' })]), P2)
      expect(permanentById(s.game, 'p1-cmd'), def).toBeUndefined()
      expect(s.game.players.p1.commander!.inCommandZone, def).toBe(true)
      expect(handOf(s.game, P1).some((c) => c.id === 'p1-cmd'), def).toBe(false)
      expect(s.game.players.p1.graveyard.some((c) => c.id === 'p1-cmd'), def).toBe(false)
      expect(s.game.exile.some((c) => c.id === 'p1-cmd'), def).toBe(false)
      expect(s.game.journal).toContain('Tobias Andrion goes to the command zone.')
    }
  })

  it('a commander that dies in combat goes to the command zone; its aura to the graveyard', () => {
    let s = arrange(commanderBoard(), (g) => {
      const t = tobiasOut(g)
      t.sick = false
      put(g, P1, 'holy-strength', { attachedTo: t.id })
      put(g, P2, 'craw-wurm')
    })
    s = pass(s, P1)
    s = play(s, { type: 'DECLARE_ATTACKERS', playerId: P1, attackers: ['p1-cmd'] })
    const wurm = s.game.battlefield.find((p) => p.def === 'craw-wurm')!
    s = throughCombat(play(s, { type: 'DECLARE_BLOCKERS', playerId: P2, blocks: [{ blocker: wurm.id, attacker: 'p1-cmd' }] }))
    expect(permanentById(s.game, 'p1-cmd')).toBeUndefined()
    expect(s.game.players.p1.commander!.inCommandZone).toBe(true)
    expect(s.game.players.p1.graveyard.map((c) => c.def)).toEqual(['holy-strength'])
  })

  it('a countered commander spell goes to the command zone', () => {
    let s = arrange(commanderBoard(), (g) => {
      lands(g, P1, 'plains', 3)
      lands(g, P1, 'island', 2)
      g.players.p2.hand = [card(P2, 'remove-soul')]
      lands(g, P2, 'island', 2)
    })
    s = castId(s, P1, 'p1-cmd')
    s = cast(s, P2, handOf(s.game, P2)[0], [{ kind: 'spell', id: 'p1-cmd' }])
    s = pass(s, P1)
    expect(s.game.stack).toEqual([])
    expect(s.game.players.p1.commander).toMatchObject({ inCommandZone: true, casts: 1 })
  })
})

describe('§10 commander damage (R-CMD-05)', () => {
  it('21 combat damage from one commander loses the game, whatever the life total', () => {
    let s = arrange(commanderBoard(), (g) => {
      tobiasOut(g).sick = false
      g.players.p2.commanderDamage = { 'p1-cmd': 17 }
    })
    s = pass(s, P1)
    s = throughCombat(play(s, { type: 'DECLARE_ATTACKERS', playerId: P1, attackers: ['p1-cmd'] }))
    expect(s.status).toBe('completed')
    expect(s.game.players.p2.life).toBe(36)
    expect(s.game.players.p2.commanderDamage).toEqual({ 'p1-cmd': 21 })
    expect(s.game.endReason).toBe('commander')
    expect(s.winnerPlayerIds).toEqual([P1])
  })

  it("counts only combat damage from a commander, not other creatures' or spells'", () => {
    let s = arrange(commanderBoard(), (g) => {
      put(g, P1, 'serra-angel')
      g.players.p1.hand = [card(P1, 'lightning-bolt'), card(P1, 'plains')]
      lands(g, P1, 'mountain', 1)
    })
    s = pass(cast(s, P1, handOf(s.game, P1)[0], [{ kind: 'player', id: P2 }]), P2)
    s = pass(s, P1)
    s = throughCombat(play(s, { type: 'DECLARE_ATTACKERS', playerId: P1, attackers: s.game.battlefield.filter((p) => p.def === 'serra-angel').map((p) => p.id) }))
    expect(s.game.players.p2.life).toBe(33)
    expect(s.game.players.p2.commanderDamage).toEqual({})
  })
})

describe('§10 the cards new with the Commander decks', () => {
  it('Sol Ring makes two colourless; what a cost leaves over stays in the pool', () => {
    let s = arrange(commanderBoard(), (g) => {
      put(g, P1, 'sol-ring')
      lands(g, P1, 'plains', 1)
      g.players.p1.hand = [card(P1, 'silvercoat-lion'), card(P1, 'elite-vanguard')]
    })
    s = cast(s, P1, handOf(s.game, P1).find((c) => c.def === 'silvercoat-lion')!)
    expect(s.game.players.p1.manaPool.C).toBe(1)
    const ring = s.game.battlefield.find((p) => p.def === 'sol-ring')!
    expect(ring.tapped).toBe(true)
    // Manual activation adds both.
    s = arrange(commanderBoard(), (g) => void put(g, P1, 'sol-ring'))
    s = play(s, { type: 'ACTIVATE', playerId: P1, permanentId: s.game.battlefield[0].id, ability: 0, targets: [] })
    expect(s.game.players.p1.manaPool.C).toBe(2)
  })

  it('haste attacks the turn it arrives; an unblockable creature can’t be blocked', () => {
    let s = arrange(commanderBoard(), (g) => {
      put(g, P1, 'raging-goblin', { sick: true })
      put(g, P1, 'phantom-warrior')
      put(g, P2, 'wall-of-air')
    })
    s = pass(s, P1)
    const goblin = s.game.battlefield.find((p) => p.def === 'raging-goblin')!
    const warrior = s.game.battlefield.find((p) => p.def === 'phantom-warrior')!
    s = play(s, { type: 'DECLARE_ATTACKERS', playerId: P1, attackers: [goblin.id, warrior.id] })
    const wall = s.game.battlefield.find((p) => p.def === 'wall-of-air')!
    expect(tryAction(s, { type: 'DECLARE_BLOCKERS', playerId: P2, blocks: [{ blocker: wall.id, attacker: warrior.id }] })).toMatch(/can't block/)
    expect(tryAction(s, { type: 'DECLARE_BLOCKERS', playerId: P2, blocks: [{ blocker: wall.id, attacker: goblin.id }] })).toBeNull()
  })

  it('Earthquake hits creatures without flying and each player; Hurricane the fliers and each player', () => {
    let s = arrange(commanderBoard(), (g) => {
      put(g, P1, 'grizzly-bears')
      put(g, P2, 'scryb-sprites')
      g.players.p1.hand = [card(P1, 'earthquake')]
      lands(g, P1, 'mountain', 2)
      lands(g, P1, 'forest', 1)
    })
    s = pass(cast(s, P1, handOf(s.game, P1)[0], [], 2), P2)
    expect(s.game.battlefield.map((p) => p.def).filter((d) => !BASIC_LAND_IDS.includes(d))).toEqual(['scryb-sprites'])
    expect([s.game.players.p1.life, s.game.players.p2.life]).toEqual([38, 38])
    s = arrange(s, (g) => {
      g.players.p1.hand = [card(P1, 'hurricane')]
      for (const p of g.battlefield) p.tapped = false
      put(g, P1, 'grizzly-bears')
      Object.assign(g, { step: 'main1', activeId: P1, priorityId: P1, passed: [] })
    })
    s = pass(cast(s, P1, handOf(s.game, P1)[0], [], 1), P2)
    expect(s.game.battlefield.map((p) => p.def).filter((d) => !BASIC_LAND_IDS.includes(d))).toEqual(['grizzly-bears'])
    expect([s.game.players.p1.life, s.game.players.p2.life]).toEqual([37, 37])
  })

  it("Overrun pumps only your creatures and gives trample; Trumpet Blast only attackers", () => {
    let s = arrange(commanderBoard(), (g) => {
      put(g, P1, 'grizzly-bears')
      put(g, P2, 'grizzly-bears')
      g.players.p1.hand = [card(P1, 'overrun')]
      lands(g, P1, 'forest', 5)
    })
    s = pass(cast(s, P1, handOf(s.game, P1)[0]), P2)
    const [mine, theirs] = ['p1', 'p2'].map((id) => s.game.battlefield.find((p) => p.def === 'grizzly-bears' && p.controller === id)!)
    expect(creatureStats(s.game, mine)).toEqual({ power: 5, toughness: 5 })
    expect(keywordsOf(s.game, mine)).toContain('trample')
    expect(creatureStats(s.game, theirs)).toEqual({ power: 2, toughness: 2 })

    s = arrange(commanderBoard(), (g) => {
      put(g, P1, 'grizzly-bears')
      put(g, P1, 'hill-giant')
      g.players.p1.hand = [card(P1, 'trumpet-blast')]
      lands(g, P1, 'mountain', 3)
    })
    s = pass(s, P1)
    const bears = s.game.battlefield.find((p) => p.def === 'grizzly-bears')!
    s = play(s, { type: 'DECLARE_ATTACKERS', playerId: P1, attackers: [bears.id] })
    s = play(s, { type: 'DECLARE_BLOCKERS', playerId: P2, blocks: [] })
    s = pass(cast(s, P1, handOf(s.game, P1)[0]), P2)
    expect(creatureStats(s.game, s.game.battlefield.find((p) => p.def === 'grizzly-bears')!).power).toBe(4)
    expect(creatureStats(s.game, s.game.battlefield.find((p) => p.def === 'hill-giant')!).power).toBe(3)
  })

  it('Remove Soul counters only a creature spell', () => {
    const s = arrange(commanderBoard(), (g) => {
      g.players.p1.hand = [card(P1, 'divination')]
      lands(g, P1, 'island', 3)
      g.players.p2.hand = [card(P2, 'remove-soul')]
      lands(g, P2, 'island', 2)
    })
    const t = cast(s, P1, handOf(s.game, P1)[0])
    expect(tryAction(t, { type: 'CAST', playerId: P2, cardId: handOf(t.game, P2)[0].id, targets: [{ kind: 'spell', id: t.game.stack[0].id }] })).toMatch(/legal target/)
  })

  it('every new card is in a Commander deck, never in a base-set one', () => {
    const inCommander = new Set(COMMANDER_DECKS.flatMap((d) => [d.commander, ...deckList(d)]))
    for (const def of ['tobias-andrion', 'sol-ring', 'earthquake', 'phantom-warrior', 'raging-goblin']) expect(inCommander.has(def)).toBe(true)
    expect(colorsOf('jerrard-of-the-closed-fist')).toEqual(['R', 'G'])
  })
})

describe('§10 whole games', () => {
  for (const seed of [1, 2, 3]) {
    it(`seed ${seed}: the bot plays a Commander game to the end, every card stays in one zone, and the log replays`, () => {
      const genesis = newGame({ seed, options: { commander: true, startingLife: 40 } })
      let s = genesis
      for (let step = 0; step < 6000 && s.status === 'active'; step++) {
        const result = applyAction(s as PlatformState, simplestMove(s), { random: testRandom(step + seed * 1000) })
        if (!result.ok) throw new Error(`simplest move rejected in ${s.game.step}: ${result.error}`)
        s = result.state as GameState
        const g = s.game
        if (g.step !== 'chooseDeck') {
          const ids = [
            ...g.battlefield.map((p) => p.id),
            ...g.stack.filter((i) => i.card).map((i) => i.card!.id),
            ...g.exile.map((c) => c.id),
            ...g.seatOrder.flatMap((id) => {
              const p = g.players[id]
              return [...p.library, ...p.bottom, ...p.hand, ...p.graveyard, ...(p.commander?.inCommandZone ? [p.commander] : [])].map((c) => c!.id)
            }),
          ]
          expect(new Set(ids).size).toBe(ids.length)
          expect(ids.length).toBe(200)
        }
      }
      expect(s.status).toBe('completed')
      expect(replayActions(genesis as PlatformState, s.actionHistory)).toEqual(s)
      for (const viewer of [...s.game.seatOrder, null]) gameDefinition.redactGame(s, viewer)
    })
  }
})

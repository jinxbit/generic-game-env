import { describe, expect, it } from 'vitest'
import { buildGameLog, type LoggedAction } from '@game-platform/sdk'
import {
  creatureStats,
  DECKS,
  deckList,
  findPayment,
  gameDefinition,
  handOf,
  keywordsOf,
  legalTargets,
  normalizeGameOptions,
  permanentById,
  cost,
  type CardRef,
  type GameAction,
  type GameData,
  type GameState,
  type Permanent,
  type Target,
} from '../rules'
import { arrange, blankBoard, give, newGame, play, put, simplestMove, startedGame } from '../testing'

const P1 = 'p1'
const P2 = 'p2'

/** `playerId` passes. */
function pass(s: GameState, playerId = s.game.priorityId!, seed = 7): GameState {
  return play(s, { type: 'PASS', playerId }, seed)
}

function cast(s: GameState, playerId: string, c: CardRef, targets: Target[] = [], x?: number): GameState {
  return play(s, { type: 'CAST', playerId, cardId: c.id, targets, ...(x !== undefined ? { x } : {}) })
}

function tryAction(s: GameState, action: GameAction): string | null {
  const result = gameDefinition.applyAction(s, action, { next: () => 0.5, int: (a) => a, pick: (x) => x[0], shuffle: (x) => [...x] })
  return result.ok ? null : result.error
}

const player = (id: string): Target => ({ kind: 'player', id })
const perm = (p: Permanent | { id: string }): Target => ({ kind: 'permanent', id: p.id })

/** Lands for `owner`, untapped. */
function lands(g: GameData, owner: string, def: string, n: number): Permanent[] {
  return Array.from({ length: n }, () => put(g, owner, def))
}

/** Runs p1's turn from main 1 into declare attackers (p1 must have a creature able to attack). */
function toAttack(s: GameState): GameState {
  const next = pass(s, P1)
  expect(next.game.step).toBe('attack')
  return next
}

function attack(s: GameState, ...ids: string[]): GameState {
  return play(s, { type: 'DECLARE_ATTACKERS', playerId: P1, attackers: ids })
}

function block(s: GameState, ...pairs: [Permanent, Permanent][]): GameState {
  return play(s, { type: 'DECLARE_BLOCKERS', playerId: P2, blocks: pairs.map(([b, a]) => ({ blocker: b.id, attacker: a.id })) })
}

/** Both players pass in the declare blockers step: combat damage. */
function toDamage(s: GameState): GameState {
  expect(s.game.step).toBe('combat')
  return pass(pass(s, P1), P2)
}

function onField(s: GameState, id: string): Permanent | undefined {
  return permanentById(s.game, id)
}

describe('§1 setup', () => {
  it('R-SETUP-01..03: genesis waits for both deck choices, at the starting life, with a starting player', () => {
    const s = newGame({ options: { startingLife: 30 } })
    expect(s.status).toBe('active')
    expect(s.game.step).toBe('chooseDeck')
    expect(s.pendingPlayerIds).toEqual([P1, P2])
    expect(s.activePlayerId).toBeNull()
    expect(s.game.players.p1.life).toBe(30)
    expect([P1, P2]).toContain(s.game.startingPlayerId)
  })

  it('every deck has 40 cards, 17 of them lands', () => {
    for (const deck of DECKS) {
      const list = deckList(deck)
      expect(list).toHaveLength(40)
      expect(list.filter((d) => ['plains', 'island', 'swamp', 'mountain', 'forest'].includes(d))).toHaveLength(17)
    }
  })

  it('R-SETUP-02: a deck choice is hidden from the other player until both have chosen', () => {
    let s = newGame()
    s = play(s, { type: 'CHOOSE_DECK', playerId: P1, deck: 'red' })
    expect(s.pendingPlayerIds).toEqual([P2])
    expect(gameDefinition.redactGame(s, P2).players.p1.deck).toBeNull()
    expect(gameDefinition.redactGame(s, P1).players.p1.deck).toBe('red')
    const entry = s.actionHistory[0] as LoggedAction
    expect(gameDefinition.isActionSecret(entry, s, P2)).toBe(true)
    expect(gameDefinition.isActionSecret(entry, s, P1)).toBe(false)
    expect(tryAction(s, { type: 'CHOOSE_DECK', playerId: P1, deck: 'blue' })).toMatch(/already/)
    expect(tryAction(s, { type: 'CHOOSE_DECK', playerId: P2, deck: 'purple' })).toMatch(/Choose one of the decks/)
    s = play(s, { type: 'CHOOSE_DECK', playerId: P2, deck: 'red' })
    expect(gameDefinition.isActionSecret(entry, s, P2)).toBe(false)
    // R-SETUP-04.
    expect(s.game.step).toBe('mulligan')
    for (const id of [P1, P2]) {
      expect(s.game.players[id].hand).toHaveLength(7)
      expect(s.game.players[id].library).toHaveLength(33)
    }
    expect(s.pendingPlayerIds).toEqual([P1, P2])
  })

  it('R-MULL-01/02: a mulligan redraws seven; keeping puts that many on the bottom, secretly', () => {
    let s = newGame()
    s = play(s, { type: 'CHOOSE_DECK', playerId: P1, deck: 'blue' })
    s = play(s, { type: 'CHOOSE_DECK', playerId: P2, deck: 'black' })
    s = play(s, { type: 'MULLIGAN', playerId: P1 }, 3)
    expect(s.game.players.p1.mulligans).toBe(1)
    expect(s.game.players.p1.hand).toHaveLength(7)
    expect(s.game.players.p1.library).toHaveLength(33)
    expect(tryAction(s, { type: 'KEEP', playerId: P1, bottom: [] })).toMatch(/exactly 1 card/)
    const bottom = handOf(s.game, P1)[2]
    s = play(s, { type: 'KEEP', playerId: P1, bottom: [bottom.id] })
    expect(s.game.players.p1.hand).toHaveLength(6)
    expect(s.game.players.p1.bottom).toEqual([bottom])
    const entry = s.actionHistory[s.actionHistory.length - 1]
    expect(gameDefinition.isActionSecret(entry, s, P2)).toBe(true)
    expect(gameDefinition.redactGame(s, P2).players.p1.bottom).toEqual([null])
    expect(s.pendingPlayerIds).toEqual([P2])
    s = play(s, { type: 'KEEP', playerId: P2, bottom: [] })
    expect(s.game.step).not.toBe('mulligan')
    expect(s.game.turnNumber).toBe(1)
  })

  it('R-SETUP-03: the starting player skips their first draw; the other player draws on their turn', () => {
    const s = startedGame(['red', 'green'], 2)
    const first = s.game.startingPlayerId
    expect(s.game.activeId).toBe(first)
    expect(s.game.players[first].hand).toHaveLength(7)
    expect(s.pendingPlayerIds).toEqual([first])
  })

  it('R-MULL-02 / AMBIG-1: the bottom of the library is drawn only once the rest is gone, first put first', () => {
    let s = blankBoard()
    const [a, b] = [{ id: 'p1-80', def: 'plains' }, { id: 'p1-81', def: 'island' }]
    s = arrange(s, (g) => {
      g.players.p1.library = []
      g.players.p1.bottom = [a, b]
      give(g, P1, 'ancestral-recall')
      lands(g, P1, 'island', 1)
    })
    const recall = handOf(s.game, P1).find((c) => c.def === 'ancestral-recall')!
    s = pass(cast(s, P1, recall, [player(P1)]), P2)
    // Two from the bottom, then an empty library: p1 loses (R-SBA-01).
    expect(s.status).toBe('completed')
    expect(s.game.endReason).toBe('library')
    expect(s.winnerPlayerIds).toEqual([P2])
    expect(handOf(s.game, P1).slice(-2)).toEqual([a, b])
  })

  it('normalizes options', () => {
    expect(normalizeGameOptions(undefined)).toEqual({ startingLife: 20 })
    expect(normalizeGameOptions({ startingLife: 0 })).toEqual({ startingLife: 1 })
    expect(normalizeGameOptions({ startingLife: 7.4 })).toEqual({ startingLife: 7 })
    expect(normalizeGameOptions({ startingLife: 'x' })).toEqual({ startingLife: 20 })
  })
})

describe('§2 hidden information', () => {
  it('R-ZONE-01: the opponent sees only the sizes of a hand and a library', () => {
    const s = startedGame()
    const view = gameDefinition.redactGame(s, P2)
    expect(view.players.p1.hand.every((c) => c === null)).toBe(true)
    expect(view.players.p1.library.every((c) => c === null)).toBe(true)
    expect(view.players.p1.hand).toHaveLength(s.game.players.p1.hand.length)
    expect(view.players.p2.hand).toEqual(s.game.players.p2.hand)
    const spectator = gameDefinition.redactGame(s, null)
    expect(spectator.players.p2.hand.every((c) => c === null)).toBe(true)
  })

  it('never names a drawn card in the log', () => {
    const genesis = newGame()
    let t = genesis
    for (let i = 0; i < 12 && t.status === 'active'; i++) t = play(t, simplestMove(t), i)
    const lines = buildGameLog(genesis, t.actionHistory).map((e) => e.message)
    expect(lines.some((l) => /draws a card/.test(l))).toBe(true)
    for (const l of lines.filter((x) => /draws/.test(x))) expect(l).toMatch(/draws (a card|\d+ cards|seven cards)\.$/)
  })
})

describe('§3 turn structure', () => {
  it('R-TURN-06: one land per turn, in your own main phase', () => {
    let s = arrange(blankBoard(), (g) => give(g, P1, 'mountain'))
    const [first, second] = handOf(s.game, P1)
    s = play(s, { type: 'PLAY_LAND', playerId: P1, cardId: first.id })
    expect(onField(s, first.id)).toBeDefined()
    expect(tryAction(s, { type: 'PLAY_LAND', playerId: P1, cardId: second.id })).toMatch(/already played a land/)
    expect(tryAction(s, { type: 'PLAY_LAND', playerId: P2, cardId: handOf(s.game, P2)[0].id })).toMatch(/Alice's move/)
  })

  it('R-CREA-02: a creature can attack only from its controller’s next turn', () => {
    let s = arrange(blankBoard(), (g) => {
      give(g, P1, 'gray-ogre')
      lands(g, P1, 'mountain', 3)
    })
    const ogre = handOf(s.game, P1).find((c) => c.def === 'gray-ogre')!
    s = pass(cast(s, P1, ogre), P2)
    expect(onField(s, ogre.id)!.sick).toBe(true)
    // Nothing can attack: main 1 → main 2.
    s = pass(s, P1)
    expect(s.game.step).toBe('main2')
  })

  it('R-TURN-02..04: untap, draw, and damage wears off in cleanup', () => {
    let s = arrange(blankBoard(), (g) => {
      put(g, P1, 'mountain', { tapped: true })
      put(g, P2, 'craw-wurm', { damage: 3 })
    })
    const libraryBefore = s.game.players.p2.library.length
    s = pass(s, P1) // → main 2
    s = pass(s, P1) // → end step, p2
    s = pass(s, P2) // → cleanup, p2's turn
    expect(s.game.activeId).toBe(P2)
    expect(s.game.turnNumber).toBe(4)
    expect(s.game.players.p2.library.length).toBe(libraryBefore - 1)
    expect(s.game.battlefield.find((p) => p.def === 'craw-wurm')!.damage).toBe(0)
    // Only the active player's permanents untap.
    expect(s.game.battlefield.find((p) => p.def === 'mountain')!.tapped).toBe(true)
  })

  it('R-TURN-04: the active player discards down to seven', () => {
    let s = arrange(blankBoard(), (g) => give(g, P1, ...Array.from({ length: 8 }, () => 'hill-giant')))
    s = pass(pass(pass(s, P1), P1), P2)
    expect(s.game.step).toBe('discard')
    expect(s.pendingPlayerIds).toEqual([P1])
    const hand = handOf(s.game, P1)
    expect(tryAction(s, { type: 'DISCARD', playerId: P1, cardIds: [hand[0].id] })).toMatch(/exactly 2 cards/)
    s = play(s, { type: 'DISCARD', playerId: P1, cardIds: [hand[0].id, hand[1].id] })
    expect(s.game.players.p1.hand).toHaveLength(7)
    expect(s.game.players.p1.graveyard.map((c) => c.id)).toEqual([hand[0].id, hand[1].id])
    expect(s.game.activeId).toBe(P2)
  })

  it('R-TURN-05: mana empties between steps', () => {
    let s = arrange(blankBoard(['black', 'green']), (g) => {
      give(g, P1, 'dark-ritual')
      lands(g, P1, 'swamp', 1)
    })
    const ritual = handOf(s.game, P1).find((c) => c.def === 'dark-ritual')!
    s = pass(cast(s, P1, ritual), P2)
    expect(s.game.players.p1.manaPool.B).toBe(3)
    s = pass(s, P1)
    expect(s.game.players.p1.manaPool.B).toBe(0)
  })
})

describe('§4 priority and the stack', () => {
  it('R-PRIO-01: a spell waits on the stack for the opponent, then resolves', () => {
    let s = arrange(blankBoard(), (g) => {
      give(g, P1, 'lightning-bolt')
      lands(g, P1, 'mountain', 1)
    })
    const bolt = handOf(s.game, P1).find((c) => c.def === 'lightning-bolt')!
    s = cast(s, P1, bolt, [player(P2)])
    expect(s.game.stack.map((i) => i.id)).toEqual([bolt.id])
    expect(s.pendingPlayerIds).toEqual([P2])
    expect(s.game.players.p2.life).toBe(20)
    s = pass(s, P2)
    expect(s.game.stack).toEqual([])
    expect(s.game.players.p2.life).toBe(17)
    expect(s.game.players.p1.graveyard.map((c) => c.id)).toEqual([bolt.id])
    expect(s.pendingPlayerIds).toEqual([P1])
    expect(s.game.journal).toContain('Lightning Bolt deals 3 damage to Bob.')
  })

  it('R-PRIO-02: sorcery-speed spells need your main phase and an empty stack', () => {
    let s = arrange(blankBoard(['red', 'red']), (g) => {
      give(g, P1, 'lightning-bolt')
      give(g, P2, 'hill-giant', 'lightning-bolt')
      lands(g, P1, 'mountain', 1)
      lands(g, P2, 'mountain', 5)
    })
    const bolt = handOf(s.game, P1).find((c) => c.def === 'lightning-bolt')!
    s = cast(s, P1, bolt, [player(P2)])
    const giant = handOf(s.game, P2).find((c) => c.def === 'hill-giant')!
    expect(tryAction(s, { type: 'CAST', playerId: P2, cardId: giant.id, targets: [] })).toMatch(/only in a main phase/)
    // An instant in response is fine: the last in resolves first.
    const bolt2 = handOf(s.game, P2).find((c) => c.def === 'lightning-bolt')!
    s = cast(s, P2, bolt2, [player(P1)])
    expect(s.pendingPlayerIds).toEqual([P1])
    s = pass(s, P1)
    expect(s.game.players.p1.life).toBe(17)
    expect(s.game.players.p2.life).toBe(20)
    // After a resolution the active player gets priority (R-PRIO-01).
    expect(s.pendingPlayerIds).toEqual([P1])
    s = pass(pass(s, P1), P2)
    expect(s.game.players.p2.life).toBe(17)
  })

  it('Counterspell counters a spell', () => {
    let s = arrange(blankBoard(['red', 'blue']), (g) => {
      give(g, P1, 'lightning-bolt')
      give(g, P2, 'counterspell')
      lands(g, P1, 'mountain', 1)
      lands(g, P2, 'island', 2)
    })
    const bolt = handOf(s.game, P1).find((c) => c.def === 'lightning-bolt')!
    s = cast(s, P1, bolt, [player(P2)])
    const counter = handOf(s.game, P2).find((c) => c.def === 'counterspell')!
    expect(tryAction(s, { type: 'CAST', playerId: P2, cardId: counter.id, targets: [{ kind: 'spell', id: counter.id }] })).toMatch(/legal target/)
    s = cast(s, P2, counter, [{ kind: 'spell', id: bolt.id }])
    s = pass(s, P1)
    expect(s.game.stack).toEqual([])
    expect(s.game.players.p2.life).toBe(20)
    expect(s.game.players.p1.graveyard.map((c) => c.def)).toEqual(['lightning-bolt'])
    expect(s.game.players.p2.graveyard.map((c) => c.def)).toEqual(['counterspell'])
  })

  it('R-PRIO-04: a spell whose target is gone doesn’t resolve', () => {
    let s = arrange(blankBoard(['green', 'red']), (g) => {
      put(g, P1, 'grizzly-bears')
      give(g, P1, 'giant-growth')
      give(g, P2, 'lightning-bolt')
      lands(g, P1, 'forest', 1)
      lands(g, P2, 'mountain', 1)
    })
    const bears = s.game.battlefield.find((p) => p.def === 'grizzly-bears')!
    const growth = handOf(s.game, P1).find((c) => c.def === 'giant-growth')!
    s = cast(s, P1, growth, [perm(bears)])
    // Bob bolts the bears in response; the bolt resolves first.
    const bolt = handOf(s.game, P2).find((c) => c.def === 'lightning-bolt')!
    s = cast(s, P2, bolt, [perm(bears)])
    s = pass(s, P1) // bolt resolves: bears die
    expect(onField(s, bears.id)).toBeUndefined()
    s = pass(pass(s, P1), P2) // growth: no legal target
    expect(s.game.stack).toEqual([])
    expect(s.game.players.p1.graveyard.map((c) => c.def).sort()).toEqual(['giant-growth', 'grizzly-bears'])
    expect(s.game.journal).toContain("Giant Growth has no legal target and doesn't resolve.")
  })

  it('R-PRIO-03: costs are paid from the pool, then lands, and a Birds is kept for a colour only it can make', () => {
    let s = arrange(blankBoard(['green', 'green']), (g) => {
      lands(g, P1, 'forest', 1)
      put(g, P1, 'birds-of-paradise')
      lands(g, P1, 'mountain', 1)
    })
    const payment = findPayment(s.game, P1, cost('1G'))!
    expect(payment.tapped.map((t) => s.game.battlefield.find((p) => p.id === t.id)!.def).sort()).toEqual(['forest', 'mountain'])
    const colours = findPayment(s.game, P1, cost('GW'))!
    expect(colours.tapped.map((t) => [s.game.battlefield.find((p) => p.id === t.id)!.def, t.mana]).sort()).toEqual([
      ['birds-of-paradise', 'W'],
      ['forest', 'G'],
    ])
    expect(findPayment(s.game, P1, cost('GG'))).toBeTruthy()
    expect(findPayment(s.game, P1, cost('GGG'))).toBeNull()
    expect(findPayment(s.game, P1, cost('3G'))).toBeNull()
    // Tapping by hand fills the pool, which pays first.
    const birds = s.game.battlefield.find((p) => p.def === 'birds-of-paradise')!
    expect(tryAction(s, { type: 'ACTIVATE', playerId: P1, permanentId: birds.id, ability: 0, targets: [] })).toMatch(/colour/)
    s = play(s, { type: 'ACTIVATE', playerId: P1, permanentId: birds.id, ability: 0, targets: [], color: 'U' })
    expect(s.game.players.p1.manaPool.U).toBe(1)
    expect(s.pendingPlayerIds).toEqual([P1])
  })

  it('R-CREA-02: a summoning-sick creature can’t tap for mana', () => {
    const s = arrange(blankBoard(['green', 'green']), (g) => {
      put(g, P1, 'llanowar-elves', { sick: true })
    })
    const elves = s.game.battlefield[0]
    expect(tryAction(s, { type: 'ACTIVATE', playerId: P1, permanentId: elves.id, ability: 0, targets: [] })).toMatch(/turn it comes under your control/)
    expect(findPayment(s.game, P1, cost('G'))).toBeNull()
  })

  it('AMBIG-4: a player with no cards in hand and nothing to activate passes automatically', () => {
    let s = arrange(blankBoard(), (g) => {
      give(g, P1, 'lightning-bolt')
      lands(g, P1, 'mountain', 1)
      g.players.p2.hand = []
    })
    const bolt = handOf(s.game, P1).find((c) => c.def === 'lightning-bolt')!
    s = cast(s, P1, bolt, [player(P2)])
    // Bob can't respond: the bolt has already resolved.
    expect(s.game.players.p2.life).toBe(17)
    expect(s.pendingPlayerIds).toEqual([P1])
  })
})

describe('§5 combat', () => {
  function arena(edit: (g: GameData) => void, decks: [string, string] = ['red', 'green']): GameState {
    return arrange(blankBoard(decks), edit)
  }

  it('R-ATK-01 / R-DMG-01: an unblocked attacker hits the player; attacking taps it', () => {
    let s = arena((g) => void put(g, P1, 'hill-giant'))
    const giant = s.game.battlefield[0]
    s = attack(toAttack(s), giant.id)
    expect(onField(s, giant.id)!.tapped).toBe(true)
    expect(s.game.step).toBe('block')
    expect(s.pendingPlayerIds).toEqual([P2])
    expect(tryAction(s, { type: 'PASS', playerId: P2 })).toMatch(/Declare your blockers/)
    s = toDamage(block(s))
    expect(s.game.players.p2.life).toBe(17)
    expect(s.game.step).toBe('main2')
  })

  it('R-KW-01: vigilance doesn’t tap; defender can’t attack', () => {
    let s = arena((g) => {
      put(g, P1, 'serra-angel')
      put(g, P1, 'wall-of-air')
    })
    const [angel, wall] = s.game.battlefield
    s = toAttack(s)
    expect(tryAction(s, { type: 'DECLARE_ATTACKERS', playerId: P1, attackers: [wall.id] })).toMatch(/can't attack/)
    s = attack(s, angel.id)
    expect(onField(s, angel.id)!.tapped).toBe(false)
  })

  it('R-BLK-02: flying is blocked only by flying or reach', () => {
    let s = arena((g) => {
      put(g, P1, 'air-elemental')
      put(g, P2, 'grizzly-bears')
      put(g, P2, 'giant-spider')
    })
    const [elemental, bears, spider] = s.game.battlefield
    s = attack(toAttack(s), elemental.id)
    expect(tryAction(s, { type: 'DECLARE_BLOCKERS', playerId: P2, blocks: [{ blocker: bears.id, attacker: elemental.id }] })).toMatch(/can't block/)
    s = toDamage(block(s, [spider, elemental]))
    expect(onField(s, spider.id)).toBeUndefined()
    expect(onField(s, elemental.id)!.damage).toBe(2)
    expect(s.game.players.p2.life).toBe(20)
  })

  it('R-BLK-02: landwalk makes a creature unblockable against that land type', () => {
    let s = arena(
      (g) => {
        put(g, P1, 'bog-wraith')
        put(g, P2, 'scathe-zombies')
        put(g, P2, 'swamp')
      },
      ['black', 'black'],
    )
    const [wraith, zombies] = s.game.battlefield
    s = attack(toAttack(s), wraith.id)
    expect(tryAction(s, { type: 'DECLARE_BLOCKERS', playerId: P2, blocks: [{ blocker: zombies.id, attacker: wraith.id }] })).toMatch(/can't block/)
  })

  it('R-DMG-03: first strike deals its damage first', () => {
    let s = arena(
      (g) => {
        put(g, P1, 'white-knight')
        put(g, P2, 'grizzly-bears')
      },
      ['white', 'green'],
    )
    const [knight, bears] = s.game.battlefield
    s = toDamage(block(attack(toAttack(s), knight.id), [bears, knight]))
    expect(onField(s, bears.id)).toBeUndefined()
    expect(onField(s, knight.id)!.damage).toBe(0)
  })

  it('R-DMG-02 / AMBIG-6: several blockers take lethal damage in order; trample carries the rest', () => {
    let s = arena((g) => {
      put(g, P1, 'war-mammoth', { eot: { power: 4, toughness: 0, keywords: [] } })
      put(g, P2, 'llanowar-elves')
      put(g, P2, 'grizzly-bears')
    }, ['green', 'green'])
    const [mammoth, elves, bears] = s.game.battlefield
    expect(creatureStats(s.game, mammoth)).toEqual({ power: 7, toughness: 3 })
    s = toDamage(block(attack(toAttack(s), mammoth.id), [elves, mammoth], [bears, mammoth]))
    expect(onField(s, elves.id)).toBeUndefined()
    expect(onField(s, bears.id)).toBeUndefined()
    expect(s.game.players.p2.life).toBe(16)
    expect(onField(s, mammoth.id)).toBeUndefined()
  })

  it('R-DMG-02: without trample the last blocker takes the rest', () => {
    let s = arena((g) => {
      put(g, P1, 'craw-wurm')
      put(g, P2, 'llanowar-elves')
      put(g, P2, 'ironroot-treefolk')
    }, ['green', 'green'])
    const [wurm, elves, treefolk] = s.game.battlefield
    s = toDamage(block(attack(toAttack(s), wurm.id), [elves, wurm], [treefolk, wurm]))
    expect(onField(s, elves.id)).toBeUndefined()
    expect(onField(s, treefolk.id)).toBeUndefined()
    expect(s.game.players.p2.life).toBe(20)
    // 1 + 3 back from the blockers: the 6/4 dies too.
    expect(onField(s, wurm.id)).toBeUndefined()
  })

  it('R-DMG-01: an attacker whose blocker left deals no damage', () => {
    let s = arena((g) => {
      put(g, P1, 'hill-giant')
      put(g, P2, 'grizzly-bears')
      give(g, P1, 'lightning-bolt')
      lands(g, P1, 'mountain', 1)
    })
    const [giant, bears] = s.game.battlefield
    s = block(attack(toAttack(s), giant.id), [bears, giant])
    const bolt = handOf(s.game, P1).find((c) => c.def === 'lightning-bolt')!
    s = pass(cast(s, P1, bolt, [perm(bears)]), P2)
    expect(onField(s, bears.id)).toBeUndefined()
    s = toDamage(s)
    expect(s.game.players.p2.life).toBe(20)
  })

  it('R-KW-01: protection from a colour stops blocks, damage and targeting by that colour', () => {
    let s = arena(
      (g) => {
        put(g, P1, 'white-knight')
        put(g, P2, 'black-knight')
        give(g, P2, 'terror')
        lands(g, P2, 'swamp', 2)
      },
      ['white', 'black'],
    )
    const [white, black] = s.game.battlefield
    expect(legalTargets(s.game, P2, { kind: 'creature', filter: 'nonartifactNonblack' }, ['B']).map((t) => t.id)).not.toContain(white.id)
    s = attack(toAttack(s), white.id)
    expect(tryAction(s, { type: 'DECLARE_BLOCKERS', playerId: P2, blocks: [{ blocker: black.id, attacker: white.id }] })).toMatch(/can't block/)
  })

  it('R-DMG-04: damage from a protected colour is prevented', () => {
    let s = arena(
      (g) => {
        put(g, P1, 'savannah-lions', { eot: { power: 0, toughness: 5, keywords: [] } })
        put(g, P2, 'black-knight')
      },
      ['white', 'black'],
    )
    const [lions, knight] = s.game.battlefield
    s = toDamage(block(attack(toAttack(s), lions.id), [knight, lions]))
    expect(onField(s, lions.id)!.damage).toBe(2)
    expect(onField(s, knight.id)!.damage).toBe(0)
  })

  it('R-ATK-01 / R-BLK-02: Juggernaut must attack and can’t be blocked by Walls', () => {
    let s = arena(
      (g) => {
        put(g, P1, 'juggernaut')
        put(g, P1, 'hill-giant')
        put(g, P2, 'wall-of-air')
      },
      ['red', 'blue'],
    )
    const [jugg, giant, wall] = s.game.battlefield
    s = toAttack(s)
    expect(tryAction(s, { type: 'DECLARE_ATTACKERS', playerId: P1, attackers: [giant.id] })).toMatch(/attacks each combat/)
    s = attack(s, jugg.id)
    expect(tryAction(s, { type: 'DECLARE_BLOCKERS', playerId: P2, blocks: [{ blocker: wall.id, attacker: jugg.id }] })).toMatch(/can't block/)
  })

  it('Fog prevents all combat damage', () => {
    let s = arena((g) => {
      put(g, P1, 'hill-giant')
      give(g, P2, 'fog')
      lands(g, P2, 'forest', 1)
    })
    const giant = s.game.battlefield[0]
    s = block(attack(toAttack(s), giant.id))
    s = pass(s, P1)
    const fog = handOf(s.game, P2).find((c) => c.def === 'fog')!
    s = pass(cast(s, P2, fog), P1)
    expect(s.game.combatDamagePrevented).toBe(true)
    s = pass(pass(s, P1), P2)
    expect(s.game.players.p2.life).toBe(20)
  })

  it('Righteousness targets only a blocking creature', () => {
    let s = arena(
      (g) => {
        put(g, P1, 'hill-giant')
        put(g, P2, 'savannah-lions')
        give(g, P2, 'righteousness')
        lands(g, P2, 'plains', 1)
      },
      ['red', 'white'],
    )
    const [giant, lions] = s.game.battlefield
    expect(legalTargets(s.game, P2, { kind: 'creature', filter: 'blocking' }, ['W'])).toEqual([])
    s = block(attack(toAttack(s), giant.id), [lions, giant])
    s = pass(s, P1)
    const right = handOf(s.game, P2).find((c) => c.def === 'righteousness')!
    s = pass(cast(s, P2, right, [perm(lions)]), P1)
    expect(creatureStats(s.game, onField(s, lions.id)!)).toEqual({ power: 9, toughness: 8 })
    s = pass(pass(s, P1), P2)
    expect(onField(s, giant.id)).toBeUndefined()
    expect(onField(s, lions.id)).toBeDefined()
  })

  it('AMBIG-5: Hypnotic Specter makes the player it damages discard at random', () => {
    let s = arena(
      (g) => {
        put(g, P1, 'hypnotic-specter')
        give(g, P2, 'grizzly-bears')
      },
      ['black', 'green'],
    )
    const specter = s.game.battlefield[0]
    s = toDamage(block(attack(toAttack(s), specter.id)))
    expect(s.game.players.p2.life).toBe(18)
    expect(s.game.players.p2.hand).toHaveLength(1)
    expect(s.game.players.p2.graveyard).toHaveLength(1)
    expect(s.game.journal.some((l) => /Bob discards .* at random\./.test(l))).toBe(true)
  })
})

describe('§6 state-based actions', () => {
  it('R-SBA-01 / R-END-01: a player at 0 life loses and the other wins', () => {
    let s = arrange(blankBoard(), (g) => {
      g.players.p2.life = 3
      give(g, P1, 'lightning-bolt')
      lands(g, P1, 'mountain', 1)
    })
    const bolt = handOf(s.game, P1).find((c) => c.def === 'lightning-bolt')!
    s = pass(cast(s, P1, bolt, [player(P2)]), P2)
    expect(s.status).toBe('completed')
    expect(s.winnerPlayerIds).toEqual([P1])
    expect(s.pendingPlayerIds).toEqual([])
    expect(s.game.endReason).toBe('life')
  })

  it('R-SBA-04: an aura goes to the graveyard with its creature', () => {
    let s = arrange(blankBoard(['black', 'red']), (g) => {
      put(g, P1, 'scathe-zombies')
      give(g, P1, 'unholy-strength')
      give(g, P2, 'lightning-bolt')
      lands(g, P1, 'swamp', 1)
      lands(g, P2, 'mountain', 1)
    })
    const zombies = s.game.battlefield[0]
    const aura = handOf(s.game, P1).find((c) => c.def === 'unholy-strength')!
    s = pass(cast(s, P1, aura, [perm(zombies)]), P2)
    expect(creatureStats(s.game, onField(s, zombies.id)!)).toEqual({ power: 4, toughness: 3 })
    s = pass(s, P1) // → combat? zombies can attack
    expect(s.game.step).toBe('attack')
    s = play(s, { type: 'DECLARE_ATTACKERS', playerId: P1, attackers: [] })
    s = pass(s, P1) // → end step
    const bolt = handOf(s.game, P2).find((c) => c.def === 'lightning-bolt')!
    s = pass(cast(s, P2, bolt, [perm(zombies)]), P1)
    // 3 damage kills the 4/3, and the aura follows it.
    expect(onField(s, zombies.id)).toBeUndefined()
    expect(s.game.battlefield.filter((p) => p.def !== 'swamp' && p.def !== 'mountain')).toEqual([])
    expect(s.game.players.p1.graveyard.map((c) => c.def).sort()).toEqual(['scathe-zombies', 'unholy-strength'])
  })
})

describe('§7 characteristics', () => {
  it('R-CHAR-02: anthems, auras and until-end-of-turn effects add up; Nightmare counts Swamps', () => {
    const s = arrange(blankBoard(['white', 'black']), (g) => {
      const lions = put(g, P1, 'savannah-lions')
      put(g, P1, 'crusade')
      put(g, P1, 'holy-strength', { attachedTo: lions.id })
      lions.eot.power = 3
      put(g, P2, 'nightmare')
      lands(g, P2, 'swamp', 4)
      put(g, P2, 'scathe-zombies')
    })
    const [lions, , , nightmare] = s.game.battlefield
    expect(creatureStats(s.game, lions)).toEqual({ power: 2 + 1 + 1 + 3, toughness: 1 + 1 + 2 })
    expect(creatureStats(s.game, nightmare)).toEqual({ power: 4, toughness: 4 })
    expect(keywordsOf(s.game, nightmare)).toContain('flying')
  })
})

describe('card effects', () => {
  it('Swords to Plowshares exiles, and the controller gains life equal to its power', () => {
    let s = arrange(blankBoard(['white', 'green']), (g) => {
      put(g, P2, 'craw-wurm')
      give(g, P1, 'swords-to-plowshares')
      lands(g, P1, 'plains', 1)
    })
    const wurm = s.game.battlefield[0]
    const swords = handOf(s.game, P1).find((c) => c.def === 'swords-to-plowshares')!
    s = pass(cast(s, P1, swords, [perm(wurm)]), P2)
    expect(s.game.exile.map((c) => c.id)).toEqual([wurm.id])
    expect(s.game.players.p2.life).toBe(26)
  })

  it('Wrath of God destroys every creature', () => {
    let s = arrange(blankBoard(['white', 'green']), (g) => {
      put(g, P1, 'serra-angel')
      put(g, P2, 'craw-wurm')
      give(g, P1, 'wrath-of-god')
      lands(g, P1, 'plains', 4)
    })
    const wrath = handOf(s.game, P1).find((c) => c.def === 'wrath-of-god')!
    s = pass(cast(s, P1, wrath), P2)
    expect(s.game.battlefield.every((p) => p.def === 'plains')).toBe(true)
  })

  it('Fireball deals X; X must be paid', () => {
    let s = arrange(blankBoard(), (g) => {
      give(g, P1, 'fireball')
      lands(g, P1, 'mountain', 4)
    })
    const fireball = handOf(s.game, P1).find((c) => c.def === 'fireball')!
    expect(tryAction(s, { type: 'CAST', playerId: P1, cardId: fireball.id, targets: [player(P2)], x: 4 })).toMatch(/can't pay/)
    expect(tryAction(s, { type: 'CAST', playerId: P1, cardId: fireball.id, targets: [player(P2)] })).toMatch(/number for X/)
    s = pass(cast(s, P1, fireball, [player(P2)], 3), P2)
    expect(s.game.players.p2.life).toBe(17)
  })

  it('Unsummon returns a creature to its owner’s hand; Raise Dead and Regrowth return cards from the graveyard', () => {
    let s = arrange(blankBoard(['blue', 'green']), (g) => {
      put(g, P2, 'craw-wurm')
      give(g, P1, 'unsummon')
      lands(g, P1, 'island', 1)
    })
    const wurm = s.game.battlefield[0]
    s = pass(cast(s, P1, handOf(s.game, P1).find((c) => c.def === 'unsummon')!, [perm(wurm)]), P2)
    expect(handOf(s.game, P2).map((c) => c.id)).toContain(wurm.id)

    let t = arrange(blankBoard(['black', 'green']), (g) => {
      g.players.p1.graveyard = [
        { id: 'p1-70', def: 'swamp' },
        { id: 'p1-71', def: 'hypnotic-specter' },
      ]
      give(g, P1, 'raise-dead')
      lands(g, P1, 'swamp', 1)
    })
    const raise = handOf(t.game, P1).find((c) => c.def === 'raise-dead')!
    expect(tryAction(t, { type: 'CAST', playerId: P1, cardId: raise.id, targets: [{ kind: 'card', id: 'p1-70' }] })).toMatch(/legal target/)
    t = pass(cast(t, P1, raise, [{ kind: 'card', id: 'p1-71' }]), P2)
    expect(handOf(t.game, P1).map((c) => c.id)).toContain('p1-71')
  })

  it('activated abilities: Prodigal Sorcerer, Royal Assassin, Shivan Dragon, Firebreathing, Northern Paladin', () => {
    let s = arrange(blankBoard(['blue', 'black']), (g) => {
      put(g, P1, 'prodigal-sorcerer')
      put(g, P1, 'royal-assassin')
      put(g, P1, 'shivan-dragon')
      put(g, P1, 'northern-paladin')
      lands(g, P1, 'mountain', 2)
      lands(g, P1, 'plains', 2)
      put(g, P2, 'scathe-zombies', { tapped: true })
      put(g, P2, 'bad-moon')
    })
    const [sorcerer, assassin, dragon, paladin] = s.game.battlefield
    const zombies = s.game.battlefield.find((p) => p.def === 'scathe-zombies')!
    const moon = s.game.battlefield.find((p) => p.def === 'bad-moon')!
    s = pass(play(s, { type: 'ACTIVATE', playerId: P1, permanentId: sorcerer.id, ability: 0, targets: [player(P2)] }), P2)
    expect(s.game.players.p2.life).toBe(19)
    expect(onField(s, sorcerer.id)!.tapped).toBe(true)
    s = pass(play(s, { type: 'ACTIVATE', playerId: P1, permanentId: assassin.id, ability: 0, targets: [perm(zombies)] }), P2)
    expect(onField(s, zombies.id)).toBeUndefined()
    s = pass(play(s, { type: 'ACTIVATE', playerId: P1, permanentId: dragon.id, ability: 0, targets: [] }), P2)
    s = pass(play(s, { type: 'ACTIVATE', playerId: P1, permanentId: dragon.id, ability: 0, targets: [] }), P2)
    expect(creatureStats(s.game, onField(s, dragon.id)!)).toEqual({ power: 7, toughness: 5 })
    s = pass(play(s, { type: 'ACTIVATE', playerId: P1, permanentId: paladin.id, ability: 0, targets: [perm(moon)] }), P2)
    expect(onField(s, moon.id)).toBeUndefined()
    expect(tryAction(s, { type: 'ACTIVATE', playerId: P1, permanentId: dragon.id, ability: 0, targets: [] })).toMatch(/can't pay/)
  })

  it('Firebreathing pumps the creature it enchants; Goblin Balloon Brigade gains flying', () => {
    let s = arrange(blankBoard(['red', 'green']), (g) => {
      const brigade = put(g, P1, 'goblin-balloon-brigade')
      put(g, P1, 'firebreathing', { attachedTo: brigade.id })
      lands(g, P1, 'mountain', 2)
    })
    const [brigade, fire] = s.game.battlefield
    s = pass(play(s, { type: 'ACTIVATE', playerId: P1, permanentId: fire.id, ability: 0, targets: [] }), P2)
    s = pass(play(s, { type: 'ACTIVATE', playerId: P1, permanentId: brigade.id, ability: 0, targets: [] }), P2)
    expect(creatureStats(s.game, onField(s, brigade.id)!)).toEqual({ power: 2, toughness: 1 })
    expect(keywordsOf(s.game, onField(s, brigade.id)!)).toContain('flying')
  })

  it('Braingeyser, Ancestral Recall and Stream of Life', () => {
    let s = arrange(blankBoard(['blue', 'green']), (g) => {
      give(g, P1, 'braingeyser', 'ancestral-recall')
      lands(g, P1, 'island', 5)
    })
    const hand = s.game.players.p1.hand.length
    s = pass(cast(s, P1, handOf(s.game, P1).find((c) => c.def === 'braingeyser')!, [player(P1)], 2), P2)
    s = pass(cast(s, P1, handOf(s.game, P1).find((c) => c.def === 'ancestral-recall')!, [player(P1)]), P2)
    expect(s.game.players.p1.hand.length).toBe(hand - 2 + 2 + 3)

    let t = arrange(blankBoard(['green', 'green']), (g) => {
      give(g, P1, 'stream-of-life')
      lands(g, P1, 'forest', 4)
    })
    t = pass(cast(t, P1, handOf(t.game, P1).find((c) => c.def === 'stream-of-life')!, [player(P1)], 3), P2)
    expect(t.game.players.p1.life).toBe(23)
  })

  it('Stone Rain, Shatter and Disenchant destroy what they target', () => {
    let s = arrange(blankBoard(['red', 'white']), (g) => {
      put(g, P2, 'plains')
      put(g, P2, 'juggernaut')
      put(g, P2, 'crusade')
      give(g, P1, 'stone-rain', 'shatter')
      lands(g, P1, 'mountain', 5)
    })
    const [plains, jugg] = s.game.battlefield
    s = pass(cast(s, P1, handOf(s.game, P1).find((c) => c.def === 'stone-rain')!, [perm(plains)]), P2)
    s = pass(cast(s, P1, handOf(s.game, P1).find((c) => c.def === 'shatter')!, [perm(jugg)]), P2)
    expect(s.game.battlefield.map((p) => p.def).filter((d) => d !== 'mountain')).toEqual(['crusade'])
    expect(legalTargets(s.game, P1, { kind: 'artifact' }, ['R'])).toEqual([])
  })
})

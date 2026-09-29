// Mana: pools, sources and automatic payment (RULES.md R-PRIO-03,
// R-TURN-05). Pure functions of `GameData`; `payCost` is the only one that
// changes it.

import { cardDef } from './cards.ts'
import type { Color, GameData, ManaCost, ManaPool, ManaType, Permanent, PlayerId } from './types.ts'

export const MANA_TYPES: ManaType[] = ['W', 'U', 'B', 'R', 'G', 'C']
export const COLORS: Color[] = ['W', 'U', 'B', 'R', 'G']

export function emptyPool(): ManaPool {
  return { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }
}

export function poolTotal(pool: ManaPool): number {
  return MANA_TYPES.reduce((n, k) => n + pool[k], 0)
}

/** `{G}{G}{B}` for a pool, or '' when it's empty. */
export function poolLabel(pool: ManaPool): string {
  return MANA_TYPES.map((k) => `{${k}}`.repeat(pool[k])).join('')
}

/** The index of `permanent`'s mana ability, or -1. */
export function manaAbilityIndex(permanent: Permanent): number {
  return (cardDef(permanent.def).abilities ?? []).findIndex((a) => a.produces !== undefined)
}

/** R-CREA-02: may `permanent` pay a {T} cost right now? */
export function canTap(permanent: Permanent): boolean {
  if (permanent.tapped) return false
  return !(permanent.sick && cardDef(permanent.def).types.includes('Creature'))
}

/** What each untapped mana source `playerId` controls could add, lands first (R-PRIO-03). */
export function manaSources(game: GameData, playerId: PlayerId, exclude: string | null = null): { id: string; colors: ManaType[] }[] {
  const sources: { id: string; colors: ManaType[]; land: boolean }[] = []
  for (const p of game.battlefield) {
    if (p.controller !== playerId || p.id === exclude || !canTap(p)) continue
    const index = manaAbilityIndex(p)
    if (index < 0) continue
    const produces = cardDef(p.def).abilities![index].produces!
    sources.push({ id: p.id, colors: produces === 'any' ? [...COLORS] : [produces], land: cardDef(p.def).types.includes('Land') })
  }
  return [...sources.filter((s) => s.land), ...sources.filter((s) => !s.land)].map(({ id, colors }) => ({ id, colors }))
}

export interface Payment {
  /** Mana taken from the pool. */
  fromPool: ManaPool
  /** Sources tapped, and the mana each added. */
  tapped: { id: string; mana: ManaType }[]
}

/**
 * A way for `playerId` to pay `cost` (with X = `x`): mana in their pool
 * first, then untapped sources, lands before creatures — or null if they
 * can't. Coloured symbols are matched to mana by augmenting paths, so a
 * source that could make several colours (Birds of Paradise) is never
 * wasted on a symbol a land could have paid.
 */
export function findPayment(game: GameData, playerId: PlayerId, cost: ManaCost, x = 0, exclude: string | null = null): Payment | null {
  const pool = game.players[playerId].manaPool
  type Unit = { pool: ManaType } | { source: string; colors: ManaType[] }
  const units: Unit[] = []
  for (const k of MANA_TYPES) for (let i = 0; i < pool[k]; i++) units.push({ pool: k })
  for (const s of manaSources(game, playerId, exclude)) units.push({ source: s.id, colors: s.colors })
  const canMake = (u: Unit, color: ManaType) => ('pool' in u ? u.pool === color : u.colors.includes(color))

  const slots: Color[] = COLORS.flatMap((k) => Array.from({ length: cost[k] ?? 0 }, () => k))
  const generic = cost.generic + (cost.x ? x : 0)
  if (units.length < slots.length + generic) return null

  // Coloured symbols: bipartite matching, slot → unit.
  const unitOfSlot: number[] = slots.map(() => -1)
  const slotOfUnit: number[] = units.map(() => -1)
  const augment = (slot: number, seen: boolean[]): boolean => {
    for (let u = 0; u < units.length; u++) {
      if (seen[u] || !canMake(units[u], slots[slot])) continue
      seen[u] = true
      if (slotOfUnit[u] === -1 || augment(slotOfUnit[u], seen)) {
        slotOfUnit[u] = slot
        unitOfSlot[slot] = u
        return true
      }
    }
    return false
  }
  for (let s = 0; s < slots.length; s++) if (!augment(s, units.map(() => false))) return null

  // Generic: whatever's left, in preference order (pool, lands, creatures).
  const fromPool = emptyPool()
  const tapped: { id: string; mana: ManaType }[] = []
  const spend = (u: number, mana: ManaType) => {
    const unit = units[u]
    if ('pool' in unit) fromPool[unit.pool]++
    else tapped.push({ id: unit.source, mana })
  }
  slots.forEach((color, s) => spend(unitOfSlot[s], color))
  let left = generic
  for (let u = 0; u < units.length && left > 0; u++) {
    if (slotOfUnit[u] !== -1) continue
    const unit = units[u]
    spend(u, 'pool' in unit ? unit.pool : unit.colors[0])
    left--
  }
  return left === 0 ? { fromPool, tapped } : null
}

/** Pays `cost` for `playerId` (see findPayment); returns false, changing nothing, if they can't. */
export function payCost(game: GameData, playerId: PlayerId, cost: ManaCost, x = 0, exclude: string | null = null): boolean {
  const payment = findPayment(game, playerId, cost, x, exclude)
  if (!payment) return false
  const pool = game.players[playerId].manaPool
  for (const k of MANA_TYPES) pool[k] -= payment.fromPool[k]
  for (const t of payment.tapped) {
    const p = game.battlefield.find((q) => q.id === t.id)!
    p.tapped = true
  }
  return true
}

/** The most X `playerId` could pay for `cost` right now. */
export function maxX(game: GameData, playerId: PlayerId, cost: ManaCost): number {
  if (!cost.x) return 0
  let x = 0
  while (x < 99 && findPayment(game, playerId, cost, x + 1)) x++
  return findPayment(game, playerId, cost, x) ? x : -1
}

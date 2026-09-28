// Read-only queries over the board data (./data/board.ts). Every rule that
// needs to know about a country goes through here, so no logic names a
// country or hard-codes a square (RULES.md: "Never hard-code board or card
// content in logic").

import { ARROWS, COUNTRIES, TAX_HAVENS, type CountryDef, type Industry, type ZoneId } from './data/board.ts'
import type { Affiliation, CountryId, CountryState, GameData, PlayerId } from './types.ts'

export { TAX_HAVENS }

const BY_ID: ReadonlyMap<string, CountryDef> = new Map(COUNTRIES.map((c) => [c.id, c]))
const ARROW_SET: ReadonlySet<string> = new Set(ARROWS.map(([from, to]) => `${from}>${to}`))

export function countryDef(id: CountryId): CountryDef {
  const def = BY_ID.get(id)
  if (!def) throw new Error(`Unknown country: ${id}`)
  return def
}

export function isCountry(id: unknown): id is CountryId {
  return typeof id === 'string' && BY_ID.has(id)
}

export const countryName = (id: CountryId): string => BY_ID.get(id)?.name ?? id

export const MAJOR_COUNTRIES: readonly CountryId[] = COUNTRIES.filter((c) => c.isMajor).map((c) => c.id)

export function countriesInZone(zone: ZoneId): CountryDef[] {
  return COUNTRIES.filter((c) => c.zone === zone)
}

/** R-COMP-09: an arrow A → B as printed, or Tax Havens → anywhere. Nothing leads into Tax Havens. */
export function arrowExists(from: CountryId, to: CountryId): boolean {
  if (to === TAX_HAVENS || from === to) return false
  if (from === TAX_HAVENS) return true
  return ARROW_SET.has(`${from}>${to}`)
}

/** A country's camp for movement and Power Plays: its affiliation, which is 'BATTLEGROUND' while it holds its zone's marker. */
export function affiliationOf(game: GameData, id: CountryId): Affiliation {
  return game.countries[id].affiliation
}

/**
 * R-COMP-09: may a loose cube move A → B? Needs the arrow, and either the
 * same camp (NATO→NATO, SCO→SCO), a battleground B from a NATO/SCO A, or Tax
 * Havens as A. Never out of a battleground, never into Tax Havens.
 */
export function moveAllowed(game: GameData, from: CountryId, to: CountryId): boolean {
  if (!isCountry(from) || !isCountry(to) || !arrowExists(from, to)) return false
  if (from === TAX_HAVENS) return true
  const a = affiliationOf(game, from)
  const b = affiliationOf(game, to)
  if (a === 'BATTLEGROUND' || a === 'NONE') return false
  if (b === 'BATTLEGROUND') return true
  return a === b
}

/** How much a square counts for Earnings and end-game scoring: 2 for the R&D square or a fortified one (R-EARN-04, ⚑ ACCUM_RD). */
export function squareWeight(game: GameData, country: CountryId, square: number): number {
  const s = game.countries[country].squares[square]
  const isRd = game.rdSquare !== null && game.rdSquare.country === country && game.rdSquare.square === square
  return isRd || s.fortified ? 2 : 1
}

/** A player's weighted squares in one industry, across the whole board including the Tax Havens FIN square. */
export function industrySquares(game: GameData, playerId: PlayerId, industry: Industry): number {
  let total = 0
  for (const def of COUNTRIES) {
    const country = game.countries[def.id]
    def.squares.forEach((squareIndustry, index) => {
      if (squareIndustry === industry && country.squares[index].occupant === playerId) total += squareWeight(game, def.id, index)
    })
  }
  return total
}

/** The single player with strictly the most (weighted) squares, or null on a tie or when nobody has any (R-EARN-05, [AMBIG-15]). */
export function marketLeader(counts: Record<PlayerId, number>): PlayerId | null {
  let best = 0
  let leader: PlayerId | null = null
  let tied = false
  for (const [id, count] of Object.entries(counts)) {
    if (count > best) {
      best = count
      leader = id
      tied = false
    } else if (count === best && count > 0) {
      tied = true
    }
  }
  return tied ? null : leader
}

export const looseOf = (country: CountryState, playerId: PlayerId): number => country.loose[playerId] ?? 0
export const defendersOf = (country: CountryState, playerId: PlayerId): number => country.defenders[playerId] ?? 0

/** Every country's id, Tax Havens included. */
export const ALL_COUNTRY_IDS: readonly CountryId[] = COUNTRIES.map((c) => c.id)

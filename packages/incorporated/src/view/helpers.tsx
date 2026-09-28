// Pure helpers shared by the view components — no React state, no rules.

import type { SeatInfo } from '@game-platform/sdk/ui'
import { CORPORATIONS, COUNTRIES, countryDef, countryName, PHASE_LABELS, TAX_HAVENS, ZONES } from '../rules.ts'
import type { GameState } from '../rules.ts'
import type { CountryId, CubeRef, GameAction, GameData, PhaseId, PlayerId, Prompt, ZoneId } from '../types.ts'

export const PHASE_NAMES: Record<PhaseId, string> = { ...PHASE_LABELS, ended: 'Game over' }

export const BTN = 'rounded-md border border-neutral-700 px-3 py-1.5 text-sm hover:border-indigo-400 disabled:cursor-not-allowed disabled:opacity-50'
export const BTN_PRIMARY = 'rounded-md border border-indigo-500 bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50'
export const BTN_SELECTED = 'rounded-md border border-indigo-400 bg-indigo-600/30 px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50'
export const INPUT = 'rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 disabled:opacity-50'

export function corpDef(game: GameData, playerId: PlayerId) {
  const corp = game.players[playerId]?.corp
  return CORPORATIONS.find((c) => c.id === corp) ?? null
}

/** A player's corporation colour (the board's cube colour), falling back to their seat colour. */
export function corpColour(game: GameData, players: SeatInfo[], playerId: PlayerId): string {
  return corpDef(game, playerId)?.colour ?? players.find((p) => p.id === playerId)?.color ?? '#737373'
}

export function displayNameOf(players: SeatInfo[], playerId: PlayerId): string {
  return players.find((p) => p.id === playerId)?.display_name ?? 'Unknown'
}

/** "Alice (Giant Squid)". */
export function playerLabel(game: GameData, players: SeatInfo[], playerId: PlayerId): string {
  const corp = corpDef(game, playerId)
  return corp ? `${displayNameOf(players, playerId)} (${corp.name})` : displayNameOf(players, playerId)
}

export function squareLabel(country: CountryId, square: number): string {
  return `${countryDef(country).squares[square] ?? '?'} #${square + 1}`
}

export function cubeRefLabel(ref: CubeRef): string {
  return 'loose' in ref ? `${countryName(ref.country)}: loose cube` : `${countryName(ref.country)}: ${squareLabel(ref.country, ref.square)}`
}

/** Board countries in display order: zone by zone, Tax Havens last. */
export function boardCountryIds(): CountryId[] {
  return [...ZONES.flatMap((zone) => countryIdsInZone(zone)), TAX_HAVENS]
}

export function countryIdsInZone(zone: ZoneId): CountryId[] {
  return COUNTRIES.filter((c) => c.zone === zone).map((c) => c.id)
}

/** Countries (not Tax Havens) where an executive may defend. */
export function defendableCountries(): CountryId[] {
  return boardCountryIds().filter((id) => id !== TAX_HAVENS)
}

export function signedBop(bop: number): string {
  if (bop === 0) return '0 (even)'
  return bop > 0 ? `NATO +${bop}` : `SCO +${-bop}`
}

export function money(amount: number): string {
  return `$${amount}`
}

/** What every prompt's controls receive. */
export interface ControlProps {
  state: GameState
  players: SeatInfo[]
  me: PlayerId
  submitting: boolean
  send: (action: GameAction) => void
}

export type PromptOf<K extends Prompt['kind']> = Extract<Prompt, { kind: K }>

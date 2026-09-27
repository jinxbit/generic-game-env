// Moving cubes on and off the board, and moving sliders with their side
// effects — the primitives the phase modules share.

import { countryDef, countryName, looseOf, TAX_HAVENS } from './board.ts'
import { activeSeats, fail, note, player, type Ctx } from './context.ts'
import { moveSlider } from './sliders.ts'
import type { CountryId, CubeRef, PlayerId, SliderId } from './types.ts'

/** Empties a square: a player's cube goes back to their supply; a lock cube just leaves. */
export function clearSquare(ctx: Ctx, country: CountryId, square: number): void {
  const s = ctx.g.countries[country].squares[square]
  if (s.occupant !== null && s.occupant !== 'LOCK') player(ctx, s.occupant).supply += 1
  s.occupant = null
}

/** Puts one of `playerId`'s supply cubes on a square, displacing whatever was there. The caller checks legality and supply. */
export function occupySquare(ctx: Ctx, playerId: PlayerId, country: CountryId, square: number): void {
  clearSquare(ctx, country, square)
  player(ctx, playerId).supply -= 1
  ctx.g.countries[country].squares[square].occupant = playerId
}

export function addLoose(ctx: Ctx, playerId: PlayerId, country: CountryId, count: number): void {
  if (count <= 0) return
  const c = ctx.g.countries[country]
  c.loose[playerId] = looseOf(c, playerId) + count
  player(ctx, playerId).supply -= count
}

export function removeLoose(ctx: Ctx, playerId: PlayerId, country: CountryId, count = 1): void {
  const c = ctx.g.countries[country]
  const have = looseOf(c, playerId)
  if (have < count) fail(`No loose cube of yours in ${countryName(country)}.`)
  if (have === count) delete c.loose[playerId]
  else c.loose[playerId] = have - count
  player(ctx, playerId).supply += count
}

/** The cubes a player could give up in these countries: each unfortified square they hold, plus their loose cubes (⚑ ACCUM_RD: fortified squares can't be removed). */
export function removableCubes(ctx: Ctx, playerId: PlayerId, countries: CountryId[]): CubeRef[] {
  const refs: CubeRef[] = []
  for (const country of countries) {
    const c = ctx.g.countries[country]
    c.squares.forEach((s, square) => {
      if (s.occupant === playerId && !s.fortified) refs.push({ country, square })
    })
    for (let i = 0; i < looseOf(c, playerId); i++) refs.push({ country, loose: true })
  }
  return refs
}

/** Removes the listed cubes (each must be one of `options`), returning them to supply. */
export function removeCubeRefs(ctx: Ctx, playerId: PlayerId, refs: CubeRef[], options: CubeRef[]): void {
  const remaining = [...options]
  for (const ref of refs) {
    const index = remaining.findIndex((o) => o.country === ref?.country && ('loose' in o ? 'loose' in ref && ref.loose === true : 'square' in ref && ref.square === o.square))
    if (index < 0) fail('You can only remove your own cubes from the listed places.')
    remaining.splice(index, 1)
  }
  for (const ref of refs) {
    if ('loose' in ref) removeLoose(ctx, playerId, ref.country)
    else clearSquare(ctx, ref.country, ref.square)
  }
}

export function describeCube(ref: CubeRef): string {
  if ('loose' in ref) return `a loose cube in ${countryName(ref.country)}`
  return `the ${countryDef(ref.country).squares[ref.square]} square in ${countryName(ref.country)}`
}

/** Tax Havens and the country — where ⚑ FREE_CUBES sale costs come from. */
export const saleCostCountries = (country: CountryId): CountryId[] => (country === TAX_HAVENS ? [TAX_HAVENS] : [country, TAX_HAVENS])

/**
 * Moves a slider by `delta`, clamped. With ⚑ QE_HYPERINFLATION, pushing
 * Interest past an end pays out: past $20 every player loses $1 per bond,
 * past $11 every player gains $1 per bond (once per push).
 */
export function shiftSlider(ctx: Ctx, slider: SliderId, delta: number): void {
  const { sliders, overflow } = moveSlider(ctx.g.sliders, slider, delta)
  ctx.g.sliders = sliders
  if (slider !== 'interest' || overflow === 0 || !ctx.options.qeHyperinflation) return
  for (const id of activeSeats(ctx)) {
    const p = player(ctx, id)
    if (p.bonds === 0) continue
    p.cash = Math.max(0, (p.cash ?? 0) + (overflow < 0 ? -p.bonds : p.bonds))
  }
  note(ctx, overflow < 0 ? 'QE: Interest pushed past $20 — every player loses $1 per bond.' : 'Hyperinflation: Interest pushed past its far end — every player gains $1 per bond.')
}

/** Balance of Power one step toward `camp`. */
export function bopToward(ctx: Ctx, camp: 'NATO' | 'SCO'): void {
  shiftSlider(ctx, 'bop', camp === 'NATO' ? 1 : -1)
}


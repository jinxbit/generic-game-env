// The four sliders (RULES.md §1.2). Growth and Interest are stored as track
// indices (0 = leftmost); Stress and Balance of Power as signed integers.
// Every move is clamped at the track ends (⚑ QE_HYPERINFLATION reports how
// far a move was pushed past the Interest ends).

import { AMBIGUITY_DEFAULTS } from './ambiguities.ts'
import type { SliderId } from './data/outlookCards.ts'

/** Growth % per index [RECON]. Payoffs revealed = index + 1 (R-OUT-03). */
export const GROWTH_TRACK: readonly number[] = AMBIGUITY_DEFAULTS.growthTrackHasZero ? [-3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7] : [-3, -2, -1, 1, 2, 3, 4, 5, 6, 7]

/** Loan value per bond, index 0 = $20 (easy money), rightwards tighter. */
export const INTEREST_TRACK: readonly number[] = [20, 19, 18, 17, 16, 15, 14, 13, 12, 11]

export const STRESS_RANGE = { min: -2, max: 2 }

/** Positive = NATO. ±3 are the printed positions; the end-caps are ±AMBIG-2. */
export const BOP_RANGE = { min: -AMBIGUITY_DEFAULTS.balanceOfPowerEndCap, max: AMBIGUITY_DEFAULTS.balanceOfPowerEndCap }

export interface Sliders {
  /** Index into GROWTH_TRACK. */
  growth: number
  /** Index into INTEREST_TRACK. */
  interest: number
  stress: number
  bop: number
}

export function sliderRange(slider: SliderId): { min: number; max: number } {
  switch (slider) {
    case 'growth':
      return { min: 0, max: GROWTH_TRACK.length - 1 }
    case 'interest':
      return { min: 0, max: INTEREST_TRACK.length - 1 }
    case 'stress':
      return STRESS_RANGE
    case 'bop':
      return BOP_RANGE
  }
}

/** The slider moved by `delta`, clamped, plus how many steps were lost to the clamp (signed like `delta`). */
export function moveSlider(sliders: Sliders, slider: SliderId, delta: number): { sliders: Sliders; overflow: number } {
  const { min, max } = sliderRange(slider)
  const target = sliders[slider] + delta
  const clamped = Math.max(min, Math.min(max, target))
  return { sliders: { ...sliders, [slider]: clamped }, overflow: target - clamped }
}

export const growthPercent = (sliders: Sliders): number => GROWTH_TRACK[sliders.growth]
export const interestValue = (sliders: Sliders): number => INTEREST_TRACK[sliders.interest]
export const payoffsToReveal = (sliders: Sliders): number => sliders.growth + 1

/** Growth index for a percentage on the track — for setup and tests. */
export function growthIndexOf(percent: number): number {
  const index = GROWTH_TRACK.indexOf(percent)
  if (index < 0) throw new Error(`${percent}% is not on the Growth track`)
  return index
}

/** Interest index for a loan value — for setup and tests. */
export function interestIndexOf(value: number): number {
  const index = INTEREST_TRACK.indexOf(value)
  if (index < 0) throw new Error(`$${value} is not on the Interest track`)
  return index
}

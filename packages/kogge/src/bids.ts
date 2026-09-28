// Turn-order bids (R-AUC-02..05): how strong a bid is and whether a player
// can still make one. Pure helpers, shared by the rules and the view.

import { SINGLE_MARKER_IS_SET } from './ambiguities.ts'

/** A comparable key: [is a set, set size or sum, set number]. Higher is stronger. */
export function bidStrength(markers: readonly number[]): [number, number, number] {
  const isSet = markers.length > 0 && markers.every((m) => m === markers[0]) && (markers.length >= 2 || SINGLE_MARKER_IS_SET)
  if (isSet) return [1, markers.length, markers[0]] // R-AUC-03a/b
  return [0, markers.reduce((a, b) => a + b, 0), 0] // R-AUC-03c
}

/** Positive when `a` beats `b`, negative when `b` beats `a`, 0 on equal strength. */
export function compareBids(a: readonly number[], b: readonly number[]): number {
  const [x, y] = [bidStrength(a), bidStrength(b)]
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]
  return 0
}

export function sortedBid(markers: readonly number[]): number[] {
  return [...markers].sort((a, b) => a - b)
}

/** R-AUC-04: the same multiset of markers. */
export function sameBid(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false
  const [x, y] = [sortedBid(a), sortedBid(b)]
  return x.every((v, i) => v === y[i])
}

export function describeBid(markers: readonly number[]): string {
  const [isSet, size] = bidStrength(markers)
  const list = sortedBid(markers).join('+')
  return isSet ? `${list} (set of ${size})` : `${list} (sum ${size})`
}

/**
 * R-AUC-05: whether a hand (count per value) has any non-empty bid not among
 * `taken`. Only enumerates when the hand is small enough for that to matter.
 */
export function canBid(hand: readonly number[], taken: readonly (readonly number[])[]): boolean {
  let combos = 1
  for (const count of hand) {
    combos *= count + 1
    if (combos - 1 > taken.length) return true
  }
  if (combos - 1 === 0) return false
  // Every sub-multiset of the hand, checked against the bids already made.
  const values = hand.flatMap((count, value) => (count > 0 ? [value] : []))
  const walk = (i: number, picked: number[]): boolean => {
    if (i === values.length) return picked.length > 0 && !taken.some((bid) => sameBid(bid, picked))
    const value = values[i]
    for (let n = 0; n <= hand[value]; n++) {
      if (walk(i + 1, [...picked, ...Array<number>(n).fill(value)])) return true
    }
    return false
  }
  return walk(0, [])
}

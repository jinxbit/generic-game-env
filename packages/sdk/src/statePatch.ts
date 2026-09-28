/**
 * A structural patch between two JSON-compatible values of the same shape —
 * how a hidden-information game's per-player view moves from one log entry
 * to the next (./viewLog.ts). Each log entry carries, for every viewer, the
 * patch from their view before it to their view after it, so a client
 * rebuilds its own view entry by entry without ever holding the true state
 * or running the rules.
 *
 * Deliberately not RFC 6902 (JSON Patch): every diff here runs between two
 * views of the same `GameState`-shaped object for the same viewer, so a
 * format that mirrors the source shape needs no path strings and is simpler
 * to generate and apply correctly. `null` means nothing changed.
 *
 * First written for issue #648's state-patch delta, which was reverted for
 * the extra database round trips its snapshot buffer cost, not for this
 * code: measured at 0.02 ms per diff on real late-game states. Here the
 * patches are computed from states already in memory at write time and
 * stored in the same row write, so they cost no round trip at all.
 *
 * Patches are stored and sent as JSON, so they follow JSON's rules: an
 * object key whose value is `undefined` is the same as an absent key, and
 * is diffed that way — a `{v: undefined}` node would arrive as `{}`.
 */
/**
 * Compact on purpose — patches are most of what a hidden-information game
 * sends per move. `{v}` replaces a value outright; `{o, u?}` patches an
 * object (`o`: changed keys, `u`: removed keys); `{a, s}` patches an array
 * of new length `a` at the indices in `s`. Whenever a partial patch would be
 * no smaller than the new value itself, the value is sent instead.
 */
export type StatePatchNode =
  | { v: unknown }
  | { o: Record<string, StatePatchNode>; u?: string[] }
  | { a: number; s: Record<number, StatePatchNode> }

export type StatePatch = StatePatchNode | null

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Structural equality over JSON-compatible values — used only to decide whether a leaf actually changed. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]))
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = definedKeys(a)
    const bKeys = definedKeys(b)
    return aKeys.length === bKeys.length && aKeys.every((key) => b[key] !== undefined && deepEqual(a[key], b[key]))
  }
  return false
}

/** An object's keys as JSON sees them: one holding `undefined` isn't there. */
function definedKeys(value: Record<string, unknown>): string[] {
  return Object.keys(value).filter((key) => value[key] !== undefined)
}

/** The smaller of a partial patch and outright replacement. */
function smaller(partial: StatePatchNode, current: unknown): StatePatchNode {
  const replace = { v: current }
  return JSON.stringify(partial).length < JSON.stringify(replace).length ? partial : replace
}

/**
 * Diffs `previous` against `current`, returning `null` when they're
 * structurally identical. A type change, or a value not present in
 * `previous`, is a replacement — there's nothing to diff against.
 */
export function diffState(previous: unknown, current: unknown): StatePatch {
  if (deepEqual(previous, current)) return null

  if (Array.isArray(previous) && Array.isArray(current)) {
    const s: Record<number, StatePatchNode> = {}
    for (let i = 0; i < current.length; i++) {
      const sub = i < previous.length ? diffState(previous[i], current[i]) : { v: current[i] }
      if (sub) s[i] = sub
    }
    return smaller({ a: current.length, s }, current)
  }

  if (isPlainObject(previous) && isPlainObject(current)) {
    const o: Record<string, StatePatchNode> = {}
    const u: string[] = []
    for (const key of definedKeys(current)) {
      const sub = previous[key] !== undefined ? diffState(previous[key], current[key]) : { v: current[key] }
      if (sub) o[key] = sub
    }
    for (const key of definedKeys(previous)) {
      if (current[key] === undefined) u.push(key)
    }
    return smaller(u.length > 0 ? { o, u } : { o }, current)
  }

  return { v: current }
}

/**
 * The exact inverse of `diffState`: `applyStatePatch(previous, diffState(previous,
 * current))` always deep-equals `current`, for any JSON-compatible `previous`/
 * `current`. `null` (no change) returns `previous` unchanged, by reference.
 */
export function applyStatePatch<T>(previous: T, patch: StatePatch): T {
  if (!patch) return previous
  if ('v' in patch) return patch.v as T
  if ('a' in patch) {
    const prevArr = Array.isArray(previous) ? previous : []
    const result: unknown[] = new Array(patch.a)
    for (let i = 0; i < patch.a; i++) {
      const sub = patch.s[i]
      result[i] = sub ? applyStatePatch(prevArr[i], sub) : prevArr[i]
    }
    return result as T
  }
  // `{}`: a `{v: undefined}` node (an `undefined` array element) after its JSON round trip.
  if (!('o' in patch)) return undefined as T
  const prevObj: Record<string, unknown> = isPlainObject(previous) ? previous : {}
  const result: Record<string, unknown> = { ...prevObj }
  for (const key of patch.u ?? []) delete result[key]
  for (const [key, sub] of Object.entries(patch.o)) {
    result[key] = applyStatePatch(prevObj[key], sub)
  }
  return result as T
}

// Randomness for game rules, without breaking replay.
//
// Rules must be deterministic (see ./gameDefinition.ts): a game is replayed
// from genesis on every undo, every server-side submission, every client
// delta rebuild and in every test. So a rule never rolls for itself. The
// framework hands `setup`, `applyAction` and `onPlayerEliminated` a `Random`,
// and every number a hook draws from it is *recorded*: on the log entry the
// draw happened in (`LoggedAction.random`, ./actions.ts), or, for `setup`, on
// the state (`GameState.setupRandom`, ./types.ts). Replaying an entry feeds
// the recorded numbers back instead of rolling again, so replay needs no
// seed and reproduces exactly what happened, on any client.
//
// Only the first application of an action rolls fresh numbers, and who rolls
// them is the caller's business, passed in as a `Uint32Source`:
//
//   - a rule-enforced game: the Edge Functions, from a seed that never leaves
//     the server (`game_secrets`, supabase/migrations/0002_game_secrets.sql),
//     keyed by the move's position in the game (`seededSource`) — so undoing
//     a move and making it again draws the same numbers;
//   - a client-trusted game: the client itself (src/lib/randomSource.ts),
//     which that path has to trust anyway.
//
// A client replaying a game can see every number already drawn in the log
// entries it is allowed to see — that is, what has happened. It cannot see
// what will be drawn next: that needs the seed. A game with hidden
// information marks an entry whose draws are still secret with
// `isActionSecret`, and redaction (./redaction.ts) withholds the numbers with
// the entry. Setup draws are on every copy of the state, so anything decided
// in `setup` is public; draw a secret (a card into a hand) when it's dealt.

/** A deterministic random stream. Stateful: each call advances it. */
export interface Random {
  /** A float in [0, 1). */
  next(): number
  /** A whole number from `min` to `max`, both inclusive. */
  int(min: number, max: number): number
  /** One element of a non-empty array. */
  pick<T>(items: readonly T[]): T
  /** A shuffled copy of `items` (Fisher–Yates); the input is left untouched. */
  shuffle<T>(items: readonly T[]): T[]
}

/** Fresh 32-bit unsigned integers — where a first application's draws come from. */
export type Uint32Source = () => number

/**
 * Thrown by a draw with nothing to draw from — a client-side replay whose
 * recorded draws ran out (a rules mismatch), or an action applied with no
 * source at all. applyAction turns it into a rejection.
 */
export class RandomnessUnavailableError extends Error {
  constructor(message = 'This move involves chance, and no random numbers were supplied for it.') {
    super(message)
    this.name = 'RandomnessUnavailableError'
  }
}

/** Builds the `Random` a game sees on top of a stream of 32-bit integers. */
export function randomFrom(source: Uint32Source): Random {
  const next = () => source() / 4294967296

  function int(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
      throw new Error(`Random.int needs whole numbers with min <= max, got ${min} and ${max}.`)
    }
    return min + Math.floor(next() * (max - min + 1))
  }

  return {
    next,
    int,
    pick(items) {
      if (items.length === 0) throw new Error('Random.pick needs a non-empty array.')
      return items[int(0, items.length - 1)]
    },
    shuffle(items) {
      const result = [...items]
      for (let i = result.length - 1; i > 0; i--) {
        const j = int(0, i)
        ;[result[i], result[j]] = [result[j], result[i]]
      }
      return result
    },
  }
}

/**
 * Wraps `source` so every number it hands out is also appended to `drawn`
 * — what gets written to the log.
 */
export function recordingSource(source: Uint32Source): { source: Uint32Source; drawn: number[] } {
  const drawn: number[] = []
  return {
    drawn,
    source: () => {
      const value = source()
      if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new Error(`A random source returned ${value}, not a 32-bit unsigned integer.`)
      drawn.push(value)
      return value
    },
  }
}

/**
 * Hands back exactly `recorded`, in order, then throws. `exhausted()` says
 * whether every recorded number was used — a replay that used fewer than were
 * recorded took a different path than the original, which is as much a
 * mismatch as running out.
 */
export function replayingSource(recorded: readonly number[]): { source: Uint32Source; exhausted(): boolean } {
  let index = 0
  return {
    source: () => {
      if (index >= recorded.length) throw new RandomnessUnavailableError('Replay needed more random numbers than were recorded for this move.')
      return recorded[index++]
    },
    exhausted: () => index === recorded.length,
  }
}

/** A source that refuses every draw — for a caller that can't supply randomness. */
export const noRandomness: Uint32Source = () => {
  throw new RandomnessUnavailableError()
}

/**
 * A deterministic stream for `seed` and `keys` (cyrb128-seeded sfc32). Two
 * calls with the same arguments produce identical streams; any difference in
 * `keys` gives an unrelated one. The server derives each move's draws from
 * the game's secret seed this way. Never change the generator or how keys are
 * mixed: a game that is mid-move-sequence would roll differently on redo.
 */
export function seededSource(seed: string, ...keys: (string | number)[]): Uint32Source {
  // JSON-encoding the parts keeps ['a', 'b'] and ['a,b'] (or 1 and '1') apart.
  let [a, b, c, d] = hash128(JSON.stringify([seed, ...keys]))
  // sfc32 — small, fast, passes PractRand, and needs nothing beyond 32-bit
  // integer arithmetic, so it behaves identically in every JS runtime.
  return () => {
    const t = (((a + b) | 0) + d) | 0
    d = (d + 1) | 0
    a = b ^ (b >>> 9)
    b = (c + (c << 3)) | 0
    c = (c << 21) | (c >>> 11)
    c = (c + t) | 0
    return t >>> 0
  }
}

/** `randomFrom(seededSource(seed, ...keys))` — handy in tests. */
export function createRandom(seed: string, ...keys: (string | number)[]): Random {
  return randomFrom(seededSource(seed, ...keys))
}

/** cyrb128: four 32-bit words from a string, to seed sfc32. */
function hash128(text: string): [number, number, number, number] {
  let h1 = 1779033703
  let h2 = 3144134277
  let h3 = 1013904242
  let h4 = 2773480762
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i)
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067)
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233)
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213)
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179)
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067)
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233)
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213)
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179)
  h1 ^= h2 ^ h3 ^ h4
  h2 ^= h1
  h3 ^= h1
  h4 ^= h1
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0]
}

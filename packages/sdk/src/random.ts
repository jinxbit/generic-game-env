// Seeded randomness for game rules.
//
// Rules must be deterministic (see ./gameDefinition.ts): the whole game is
// replayed from genesis on every undo, every server-side submission, every
// client delta rebuild and in every test, so `Math.random()` inside a hook
// would roll differently on each replay. Instead each game carries one random
// seed, rolled once when its room is created (src/lib/randomSeed.ts), stored
// in `games.settings.randomSeed` and copied onto `GameState.randomSeed` at
// genesis (./createGame.ts). Everything here is a pure function of that seed
// plus the keys a game passes in — same inputs, same numbers, on every
// machine, forever. Never change the generator or how keys are mixed in: it
// would change every existing game's replay.
//
// A game derives a separate stream for each random event by passing keys
// that identify it — `gameRandom(lobby, 'setup')` for a shuffled deck at
// setup, `gameRandom(state, 'roll', state.turn)` for a roll during a turn. A
// stream is fully determined by its keys, so undoing a move and making it
// again rolls the same result: players can't reroll by undoing.
//
// The seed is not secret. It is readable by everyone in the room (it lives
// in the `games` row and on the GameState every client replays), so a
// determined player can compute any roll in advance. Use it for randomness
// that is public as soon as it happens — a random first player, a board
// layout, dice — not to hide information from players.

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

/**
 * The stream for `seed` and `keys`. Two calls with the same arguments
 * produce identical streams; any difference in `keys` gives an unrelated one.
 */
export function createRandom(seed: string, ...keys: (string | number)[]): Random {
  // JSON-encoding the parts keeps ['a', 'b'] and ['a,b'] (or 1 and '1') apart.
  let [a, b, c, d] = hash128(JSON.stringify([seed, ...keys]))

  // sfc32 — small, fast, passes PractRand, and needs nothing beyond 32-bit
  // integer arithmetic, so it behaves identically in every JS runtime.
  function nextUint32(): number {
    const t = (((a + b) | 0) + d) | 0
    d = (d + 1) | 0
    a = b ^ (b >>> 9)
    b = (c + (c << 3)) | 0
    c = (c << 21) | (c >>> 11)
    c = (c + t) | 0
    return t >>> 0
  }

  const next = () => nextUint32() / 4294967296

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
 * The stream for a game's own seed (`GameState.randomSeed`, also on the
 * `LobbyState` `setup` receives) and `keys`. A game started before seeds
 * existed has none and gets a fixed stand-in, so it still replays the same
 * way every time.
 */
export function gameRandom(state: { randomSeed?: string }, ...keys: (string | number)[]): Random {
  return createRandom(state.randomSeed ?? '', ...keys)
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

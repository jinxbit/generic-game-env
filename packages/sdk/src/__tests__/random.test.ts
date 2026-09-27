import { describe, expect, it } from 'vitest'
import { createRandom, gameRandom } from '../random'

const draw = (seed: string, ...keys: (string | number)[]) => {
  const random = createRandom(seed, ...keys)
  return Array.from({ length: 8 }, () => random.next())
}

describe('createRandom', () => {
  it('is a pure function of the seed and keys', () => {
    expect(draw('seed-a', 'deck', 3)).toEqual(draw('seed-a', 'deck', 3))
  })

  it('gives unrelated streams for a different seed or different keys', () => {
    const base = draw('seed-a', 'deck', 3)
    expect(draw('seed-b', 'deck', 3)).not.toEqual(base)
    expect(draw('seed-a', 'deck', 4)).not.toEqual(base)
    expect(draw('seed-a', 'dice', 3)).not.toEqual(base)
  })

  it("doesn't confuse keys that would concatenate to the same text", () => {
    expect(draw('s', 'a', 'b')).not.toEqual(draw('s', 'a,b'))
    expect(draw('s', 'ab')).not.toEqual(draw('s', 'a', 'b'))
    expect(draw('s', 1)).not.toEqual(draw('s', '1'))
  })

  // Pinned outputs: every existing game's replay depends on these exact
  // numbers, so a change to the generator or to how keys are mixed must fail
  // here rather than silently rewrite history.
  it('never changes its output', () => {
    const random = createRandom('pinned-seed', 'setup')
    expect(Array.from({ length: 6 }, () => random.int(1, 1_000_000))).toMatchInlineSnapshot(`
      [
        223693,
        280438,
        837802,
        394568,
        280152,
        300295,
      ]
    `)
  })

  it('keeps next() in [0, 1) and int() within its inclusive bounds, reaching both ends', () => {
    const random = createRandom('range')
    const seen = new Set<number>()
    for (let i = 0; i < 2000; i++) {
      const x = random.next()
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(1)
      const n = random.int(1, 6)
      expect(Number.isInteger(n)).toBe(true)
      seen.add(n)
    }
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('rejects an int range that makes no sense', () => {
    const random = createRandom('bad')
    expect(() => random.int(3, 1)).toThrow()
    expect(() => random.int(0.5, 2)).toThrow()
  })

  it('shuffles into a permutation without touching the input', () => {
    const items = Object.freeze(Array.from({ length: 20 }, (_, i) => i))
    const shuffled = createRandom('shuffle').shuffle(items)
    expect([...shuffled].sort((a, b) => a - b)).toEqual(items)
    expect(shuffled).not.toEqual(items)
    expect(createRandom('shuffle').shuffle(items)).toEqual(shuffled)
  })

  it('picks an element, and refuses an empty array', () => {
    const items = ['a', 'b', 'c']
    expect(items).toContain(createRandom('pick').pick(items))
    expect(() => createRandom('pick').pick([])).toThrow()
  })
})

describe('gameRandom', () => {
  it("draws from the state's own seed", () => {
    expect(gameRandom({ randomSeed: 'abc' }, 'k').next()).toBe(createRandom('abc', 'k').next())
  })

  it('uses a fixed stand-in for a game created before seeds existed', () => {
    expect(gameRandom({}, 'k').next()).toBe(gameRandom({}, 'k').next())
    expect(gameRandom({}, 'k').next()).toBe(createRandom('', 'k').next())
  })
})

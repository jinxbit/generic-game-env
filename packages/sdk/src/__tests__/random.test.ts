import { describe, expect, it } from 'vitest'
import { createRandom, noRandomness, randomFrom, RandomnessUnavailableError, recordingSource, replayingSource, seededSource } from '../random'

const draw = (seed: string, ...keys: (string | number)[]) => {
  const source = seededSource(seed, ...keys)
  return Array.from({ length: 8 }, () => source())
}

describe('seededSource', () => {
  it('is a pure function of the seed and keys', () => {
    expect(draw('seed-a', 'move', 3)).toEqual(draw('seed-a', 'move', 3))
  })

  it('gives unrelated streams for a different seed or different keys', () => {
    const base = draw('seed-a', 'move', 3)
    expect(draw('seed-b', 'move', 3)).not.toEqual(base)
    expect(draw('seed-a', 'move', 4)).not.toEqual(base)
    expect(draw('seed-a', 'setup')).not.toEqual(base)
  })

  it("doesn't confuse keys that would concatenate to the same text", () => {
    expect(draw('s', 'a', 'b')).not.toEqual(draw('s', 'a,b'))
    expect(draw('s', 'ab')).not.toEqual(draw('s', 'a', 'b'))
    expect(draw('s', 1)).not.toEqual(draw('s', '1'))
  })

  // Pinned outputs: a game whose moves are undone and made again relies on
  // the server drawing these exact numbers again, so a change to the
  // generator or to how keys are mixed must fail here.
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
})

describe('randomFrom', () => {
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

describe('recording and replaying', () => {
  it('records every number drawn, and replaying them reproduces the same results', () => {
    const recording = recordingSource(seededSource('rec'))
    const original = randomFrom(recording.source)
    const results = [original.int(1, 6), original.shuffle([1, 2, 3, 4]), original.next()]
    expect(recording.drawn).toHaveLength(1 + 3 + 1)

    const replaying = replayingSource(recording.drawn)
    const replayed = randomFrom(replaying.source)
    expect([replayed.int(1, 6), replayed.shuffle([1, 2, 3, 4]), replayed.next()]).toEqual(results)
    expect(replaying.exhausted()).toBe(true)
  })

  it('throws once the recorded numbers run out, and reports a replay that used too few', () => {
    const replaying = replayingSource([1, 2])
    expect(replaying.exhausted()).toBe(false)
    replaying.source()
    replaying.source()
    expect(() => replaying.source()).toThrow(RandomnessUnavailableError)
  })

  it('refuses a source that returns something other than a 32-bit unsigned integer', () => {
    expect(() => recordingSource(() => 0.5).source()).toThrow()
    expect(() => recordingSource(() => -1).source()).toThrow()
  })

  it('noRandomness refuses every draw', () => {
    expect(() => noRandomness()).toThrow(RandomnessUnavailableError)
  })
})

import { describe, expect, it } from 'vitest'
import { bestHand, buildPots, cardLabel, CATEGORIES, compareScores, formatChips, FULL_DECK, handName, scoreFive } from '../cards'

const score = (cards: string) => scoreFive(cards.split(' '))
const best = (cards: string) => bestHand(cards.split(' '))

describe('the deck (R-SETUP-02)', () => {
  it('has 52 distinct cards', () => {
    expect(new Set(FULL_DECK).size).toBe(52)
  })

  it('labels cards with suit symbols', () => {
    expect(cardLabel('As')).toBe('A♠')
    expect(cardLabel('Td')).toBe('10♦')
    expect(cardLabel('2h')).toBe('2♥')
  })
})

describe('hand ranking (§6)', () => {
  it('R-RANK-01: recognises every category', () => {
    const cases: [string, (typeof CATEGORIES)[number]][] = [
      ['9h Th Jh Qh Kh', 'Straight flush'],
      ['7c 7d 7h 7s 2c', 'Four of a kind'],
      ['Qc Qd Qh 5s 5c', 'Full house'],
      ['2d 8d Td Jd Ad', 'Flush'],
      ['5c 6d 7h 8s 9c', 'Straight'],
      ['3c 3d 3h Ks 9c', 'Three of a kind'],
      ['Kc Kd 4h 4s 9c', 'Two pair'],
      ['Ac Ad 4h 8s 9c', 'One pair'],
      ['2c 5d 9h Js Kc', 'High card'],
    ]
    for (const [cards, category] of cases) expect(CATEGORIES[score(cards)[0]]).toBe(category)
  })

  it('R-RANK-01: the categories rank in order', () => {
    const ordered = ['2c 5d 9h Js Kc', 'Ac Ad 4h 8s 9c', 'Kc Kd 4h 4s 9c', '3c 3d 3h Ks 9c', '5c 6d 7h 8s 9c', '2d 8d Td Jd Ad', 'Qc Qd Qh 5s 5c', '7c 7d 7h 7s 2c', '9h Th Jh Qh Kh']
    for (let i = 1; i < ordered.length; i++) expect(compareScores(score(ordered[i]), score(ordered[i - 1]))).toBeGreaterThan(0)
  })

  it('R-RANK-02: the wheel is a five-high straight, below six-high', () => {
    expect(score('Ac 2d 3h 4s 5c')).toEqual([4, 5])
    expect(compareScores(score('2c 3d 4h 5s 6c'), score('Ac 2d 3h 4s 5c'))).toBeGreaterThan(0)
    expect(score('Ts Js Qs Ks As')).toEqual([8, 14])
    expect(score('As 2s 3s 4s 5s')).toEqual([8, 5])
  })

  it('R-RANK-02: no wrap-around straight', () => {
    expect(score('Qc Kd Ah 2s 3c')[0]).toBe(0)
  })

  it('R-RANK-03: kickers break ties, suits never do', () => {
    expect(compareScores(score('Ac Ad Kh 8s 9c'), score('As Ah Qh Js Tc'))).toBeGreaterThan(0)
    expect(compareScores(score('Kc Kd 4h 4s Ac'), score('Ks Kh 4c 4d Qc'))).toBeGreaterThan(0)
    expect(compareScores(score('Kc Kd 5h 5s 2c'), score('Ks Kh 4c 4d Ac'))).toBeGreaterThan(0)
    expect(compareScores(score('2d 8d Td Jd Ad'), score('2h 8h Th Jh Ah'))).toBe(0)
    expect(compareScores(score('Qc Qd Qh 2s 2c'), score('Jc Jd Jh As Ac'))).toBeGreaterThan(0)
  })

  it('R-RANK-01: the best five of seven, ordered for display', () => {
    expect(best('Ah Kh 2c 5h 9h Jd Th')).toEqual({ score: [5, 14, 13, 10, 9, 5], cards: ['Ah', 'Kh', 'Th', '9h', '5h'] })
    // A straight beats the pair on the board.
    expect(best('6c 7d 8h 9s 2c 2d Tc').score).toEqual([4, 10])
    // The board plays: both hole cards are too low to matter.
    expect(best('2c 3d As Ks Qs Js 9h').score).toEqual([0, 14, 13, 12, 11, 9])
    expect(best('4c 4d 4h 9s 9c 9d 2s').score).toEqual([6, 9, 4])
    expect(best('Ac 2d 3h 4s 5c Kd Kh').cards).toEqual(['5c', '4s', '3h', '2d', 'Ac'])
    expect(best('Kc Kd 7h 7s 2c 2d Ah').cards).toEqual(['Kd', 'Kc', '7s', '7h', 'Ah'])
  })

  it('names hands for the log', () => {
    expect(handName(score('Ts Js Qs Ks As'))).toBe('a royal flush')
    expect(handName(score('9h Th Jh Qh Kh'))).toBe('a straight flush, King high')
    expect(handName(score('7c 7d 7h 7s 2c'))).toBe('four of a kind, Sevens')
    expect(handName(score('Qc Qd Qh 5s 5c'))).toBe('a full house, Queens over Fives')
    expect(handName(score('2d 8d Td Jd Ad'))).toBe('a flush, Ace high')
    expect(handName(score('Ac 2d 3h 4s 5c'))).toBe('a straight, Five high')
    expect(handName(score('3c 3d 3h Ks 9c'))).toBe('three of a kind, Threes')
    expect(handName(score('Kc Kd 4h 4s 9c'))).toBe('two pair, Kings and Fours')
    expect(handName(score('6c 6d 4h 8s 9c'))).toBe('a pair of Sixes')
    expect(handName(score('2c 5d 9h Js Kc'))).toBe('King high')
  })
})

describe('side pots (R-POT-02)', () => {
  it('one pot when everyone put in the same', () => {
    expect(buildPots({ a: 100, b: 100, c: 100 }, ['a', 'b', 'c'])).toEqual([{ amount: 300, eligible: ['a', 'b', 'c'] }])
  })

  it('a pot per all-in level, each contested by those who reached it', () => {
    expect(buildPots({ a: 50, b: 200, c: 500, d: 500 }, ['a', 'b', 'c', 'd'])).toEqual([
      { amount: 200, eligible: ['a', 'b', 'c', 'd'] },
      { amount: 450, eligible: ['b', 'c', 'd'] },
      { amount: 600, eligible: ['c', 'd'] },
    ])
  })

  it("puts folded players' chips in the pots without making them contenders", () => {
    expect(buildPots({ a: 50, b: 300, c: 300, f: 120 }, ['a', 'b', 'c'])).toEqual([
      { amount: 200, eligible: ['a', 'b', 'c'] },
      { amount: 570, eligible: ['b', 'c'] },
    ])
  })

  it('never loses a chip', () => {
    const contributions = { a: 17, b: 230, c: 230, d: 5, e: 99 }
    const total = buildPots(contributions, ['a', 'b', 'e']).reduce((n, p) => n + p.amount, 0)
    expect(total).toBe(17 + 230 + 230 + 5 + 99)
  })
})

describe('formatChips', () => {
  it('groups thousands by hand', () => {
    expect(formatChips(0)).toBe('0')
    expect(formatChips(999)).toBe('999')
    expect(formatChips(12_500)).toBe('12,500')
    expect(formatChips(1_000_000)).toBe('1,000,000')
  })
})

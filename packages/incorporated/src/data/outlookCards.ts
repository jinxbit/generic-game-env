// Outlook cards (RULES.md §4.3, §12.2) — pure data in the effect DSL that
// ../outlook.ts interprets. A card needing an effect the primitives can't
// express gets a new primitive there, never a special case.
//
// [DATA] Only "India Emerging as Global Power" is known in full. Two more
// names are known; their effects, and all of the other seven cards, are
// PLACEHOLDERS (`placeholder: true`) — mild, varied effects so a game can be
// played end to end until the real cards are transcribed.

import type { Camp, ZoneId } from './board.ts'

export type SliderId = 'growth' | 'interest' | 'stress' | 'bop'

export type OutlookEffect =
  /** Positive `delta` moves Growth up, Interest tighter (right), Stress up, Balance of Power toward NATO. Clamped. */
  | { op: 'moveSlider'; slider: SliderId; delta: number }
  /** Remove `count` lock cubes in the country; the Outlook chooser picks which. */
  | { op: 'unlockSquare'; country: string; count?: number }
  /** Lock an empty square, else displace a player cube and lock its square; the Outlook chooser picks. */
  | { op: 'lockSquare'; country: string; count?: number }
  /** The Outlook chooser picks one country matching the filter and currently `from`, and sets it to `to`. */
  | { op: 'flipAffiliation'; filter: { zone?: ZoneId; major?: boolean }; from: Camp; to: Camp }
  /** Balance of Power one step toward the country's current camp (nothing if it's a battleground). */
  | { op: 'campGainsPower'; country: string }

export interface OutlookCard {
  id: string
  name: string
  effects: OutlookEffect[]
  placeholder: boolean
}

export const OUTLOOK_CARDS: readonly OutlookCard[] = [
  {
    id: 'INDIA_EMERGING',
    name: 'India Emerging as Global Power',
    effects: [
      { op: 'unlockSquare', country: 'INDIA' },
      { op: 'moveSlider', slider: 'growth', delta: 4 },
      { op: 'moveSlider', slider: 'interest', delta: 4 },
      { op: 'moveSlider', slider: 'stress', delta: 1 },
      { op: 'flipAffiliation', filter: { zone: 'THIRD_WORLD', major: false }, from: 'NATO', to: 'SCO' },
      { op: 'campGainsPower', country: 'INDIA' },
    ],
    placeholder: false,
  },
  {
    id: 'ASIA_INFRASTRUCTURE_BANK',
    name: 'Asia Infrastructure Bank',
    effects: [
      { op: 'unlockSquare', country: 'CHINA' },
      { op: 'moveSlider', slider: 'growth', delta: 2 },
      { op: 'campGainsPower', country: 'CHINA' },
    ],
    placeholder: true,
  },
  {
    id: 'DE_DOLLARIZATION',
    name: 'De-Dollarization',
    effects: [
      { op: 'moveSlider', slider: 'interest', delta: 2 },
      { op: 'moveSlider', slider: 'stress', delta: 1 },
      { op: 'moveSlider', slider: 'bop', delta: -1 },
    ],
    placeholder: true,
  },
  {
    id: 'PLACEHOLDER_TECH_BOOM',
    name: 'Tech Boom',
    effects: [
      { op: 'moveSlider', slider: 'growth', delta: 2 },
      { op: 'moveSlider', slider: 'stress', delta: 1 },
    ],
    placeholder: true,
  },
  {
    id: 'PLACEHOLDER_RECESSION',
    name: 'Recession Fears',
    effects: [
      { op: 'moveSlider', slider: 'growth', delta: -2 },
      { op: 'moveSlider', slider: 'interest', delta: -2 },
    ],
    placeholder: true,
  },
  {
    id: 'PLACEHOLDER_RATE_HIKE',
    name: 'Rate Hike',
    effects: [
      { op: 'moveSlider', slider: 'interest', delta: 3 },
      { op: 'moveSlider', slider: 'growth', delta: 1 },
    ],
    placeholder: true,
  },
  {
    id: 'PLACEHOLDER_SANCTIONS',
    name: 'Sanctions',
    effects: [
      { op: 'lockSquare', country: 'RUSSIA' },
      { op: 'moveSlider', slider: 'stress', delta: 1 },
      { op: 'moveSlider', slider: 'bop', delta: 1 },
    ],
    placeholder: true,
  },
  {
    id: 'PLACEHOLDER_ARAB_SPRING',
    name: 'Regime Change',
    effects: [
      { op: 'flipAffiliation', filter: { zone: 'THIRD_WORLD', major: false }, from: 'SCO', to: 'NATO' },
      { op: 'moveSlider', slider: 'growth', delta: 1 },
    ],
    placeholder: true,
  },
  {
    id: 'PLACEHOLDER_STIMULUS',
    name: 'Coordinated Stimulus',
    effects: [
      { op: 'moveSlider', slider: 'growth', delta: 3 },
      { op: 'moveSlider', slider: 'interest', delta: -1 },
      { op: 'moveSlider', slider: 'stress', delta: 1 },
    ],
    placeholder: true,
  },
  {
    id: 'PLACEHOLDER_TRADE_WAR',
    name: 'Trade War',
    effects: [
      { op: 'moveSlider', slider: 'growth', delta: -1 },
      { op: 'moveSlider', slider: 'stress', delta: 1 },
      { op: 'campGainsPower', country: 'US' },
    ],
    placeholder: true,
  },
]

// Corporation cards (RULES.md §1.3, §12.1) — pure data.
//
// [DATA] The real per-player-count setups (starting shares, pre-placed cubes,
// cash, position) and the special-ability texts aren't known yet. Every
// setup below is a PLACEHOLDER (`placeholder: true`): one share and one cube
// in a different major country plus the same starting cash for everyone, so
// the game is playable and fair until the real cards are transcribed. Only
// the known facts are real: colours, cube supplies, Fortress Derivatives
// first and Old Money last.

import type { Industry } from './board.ts'

export type CorporationId = 'FORTRESS_DERIVATIVES' | 'GIANT_SQUID' | 'BIG_BROTHER' | 'OLD_MONEY'

export type PlayerCountKey = '2p' | '3p' | '4p'

export interface CorporationSetup {
  /** Shares taken from the bank, by major country id. */
  shares: Record<string, number>
  /** Pre-placed cubes: each occupies the top-most empty, unlocked square of that industry in that country (R-SET-10). */
  cubes: { country: string; industry: Industry }[]
  cash: number
}

export interface CorporationDef {
  id: CorporationId
  name: string
  /** Hex colour for the board. */
  colour: string
  colourName: string
  /** Fixed play order, 1 first (R-SET-09). [DATA]: only 1 (FD) and 4 (Old Money) are confirmed. */
  turnOrder: number
  /** Asset cubes in the box (§1.3). */
  cubes: number
  setup: Record<PlayerCountKey, CorporationSetup>
  specialAbility: { name: string; text: string }
  placeholder: boolean
}

function sameForEveryCount(setup: CorporationSetup): Record<PlayerCountKey, CorporationSetup> {
  return { '2p': setup, '3p': setup, '4p': setup }
}

export const CORPORATIONS: readonly CorporationDef[] = [
  {
    id: 'FORTRESS_DERIVATIVES',
    name: 'Fortress Derivatives',
    colour: '#22c55e',
    colourName: 'green',
    turnOrder: 1,
    cubes: 45,
    setup: sameForEveryCount({ shares: { US: 1 }, cubes: [{ country: 'US', industry: 'FIN' }], cash: 25 }),
    specialAbility: { name: 'High-Frequency Trading', text: 'Text not yet transcribed.' },
    placeholder: true,
  },
  {
    id: 'GIANT_SQUID',
    name: 'Giant Squid',
    colour: '#3b82f6',
    colourName: 'blue',
    turnOrder: 2,
    cubes: 35,
    setup: sameForEveryCount({ shares: { EUROZONE: 1 }, cubes: [{ country: 'EUROZONE', industry: 'FIN' }], cash: 25 }),
    specialAbility: { name: 'Crisis manager', text: 'Rolls the crisis die and chooses crisis discards. Text not yet transcribed.' },
    placeholder: true,
  },
  {
    id: 'BIG_BROTHER',
    name: 'Big Brother',
    colour: '#ef4444',
    colourName: 'red',
    turnOrder: 3,
    cubes: 45,
    setup: sameForEveryCount({ shares: { CHINA: 1 }, cubes: [{ country: 'CHINA', industry: 'TECH' }], cash: 25 }),
    specialAbility: { name: 'Global outlook', text: 'Draws and resolves Outlook cards, sees the next one, decides loan repayment last. Text not yet transcribed.' },
    placeholder: true,
  },
  {
    id: 'OLD_MONEY',
    name: 'Old Money',
    colour: '#eab308',
    colourName: 'yellow',
    turnOrder: 4,
    cubes: 30,
    setup: sameForEveryCount({ shares: { JAPAN: 1 }, cubes: [{ country: 'JAPAN', industry: 'FIN' }], cash: 25 }),
    specialAbility: { name: 'Old connections', text: 'One extra executive in a 4-player game. Text not yet transcribed.' },
    placeholder: true,
  },
]

/** Executives per player by player count (R-SET-02). */
export const EXECUTIVES_BY_PLAYER_COUNT: Readonly<Record<number, number>> = { 2: 4, 3: 3, 4: 2 }

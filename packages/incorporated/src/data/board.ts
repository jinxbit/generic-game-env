// Board data for Incorporated (RULES.md §2) — pure data, no logic. Every
// rule reads the board through ../board.ts, never by naming a country, so a
// corrected board (the §2 data is [RECON]: reconstructed from low-resolution
// rulebook images) is an edit to this file only.
//
// Rows marked `confidence: 'low'`, and the whole arrow list, need checking
// against a photo of a physical board (RULES.md §13 #25).

export type Industry = 'FIN' | 'TECH' | 'HEAVY' | 'ENERGY' | 'MINING'

/** Payoff and end-game scoring order (R-EARN-04, R-END-01). */
export const INDUSTRIES: readonly Industry[] = ['FIN', 'TECH', 'HEAVY', 'ENERGY', 'MINING']

export type Camp = 'NATO' | 'SCO'

export type ZoneId = 'AMERICA' | 'EUROPE' | 'ASIA' | 'THIRD_WORLD'

export const ZONES: readonly ZoneId[] = ['AMERICA', 'EUROPE', 'ASIA', 'THIRD_WORLD']

export const ZONE_NAMES: Record<ZoneId, string> = {
  AMERICA: 'America',
  EUROPE: 'Europe',
  ASIA: 'Asia',
  THIRD_WORLD: '3rd World',
}

/**
 * A country's Power Play bonus (R-LOB-03, R-LOB-09): `modifier` is added to a
 * roll supporting `camp` and subtracted from one supporting the other camp;
 * `autoWin` means supporting `camp` there wins with no roll.
 */
export type LocalBonus = { kind: 'modifier'; camp: Camp; amount: number } | { kind: 'autoWin'; camp: Camp }

export interface CountryDef {
  id: string
  name: string
  /** Null only for Tax Havens, which belongs to no zone. */
  zone: ZoneId | null
  /** Where shares are sold (R-INV-01). */
  isMajor: boolean
  /** 3–5; 0 for Tax Havens, which is never rolled against. */
  stability: number
  /** Affiliation at setup. `BATTLEGROUND` countries carry their zone's marker; `NONE` is Tax Havens only. */
  startAffiliation: Camp | 'BATTLEGROUND' | 'NONE'
  /** Majors only — the camp R-LOB-07/08 compare a Power Play against. */
  startingCamp?: Camp
  localBonus: LocalBonus | null
  /** Squares top to bottom as printed — the bottom-most matter for setup locks (R-SET-06). */
  squares: Industry[]
  confidence: 'high' | 'med' | 'low'
}

export const TAX_HAVENS = 'TAX_HAVENS'

const nato = (amount = 1): LocalBonus => ({ kind: 'modifier', camp: 'NATO', amount })
const sco = (amount = 1): LocalBonus => ({ kind: 'modifier', camp: 'SCO', amount })

/** RULES.md §2.1, in table order. */
export const COUNTRIES: readonly CountryDef[] = [
  { id: 'US', name: 'United States', zone: 'AMERICA', isMajor: true, stability: 5, startAffiliation: 'NATO', startingCamp: 'NATO', localBonus: { kind: 'autoWin', camp: 'NATO' }, squares: ['FIN', 'FIN', 'FIN', 'TECH', 'TECH', 'ENERGY', 'HEAVY'], confidence: 'high' },
  { id: 'CANADA', name: 'Canada', zone: 'AMERICA', isMajor: false, stability: 5, startAffiliation: 'NATO', localBonus: nato(), squares: ['MINING'], confidence: 'med' },
  { id: 'LATIN_AMERICA', name: 'Latin America', zone: 'AMERICA', isMajor: false, stability: 4, startAffiliation: 'NATO', localBonus: null, squares: ['ENERGY'], confidence: 'med' },
  { id: 'BRAZIL', name: 'Brazil', zone: 'AMERICA', isMajor: true, stability: 4, startAffiliation: 'SCO', startingCamp: 'SCO', localBonus: sco(), squares: ['ENERGY', 'MINING'], confidence: 'med' },
  { id: 'SOUTH_AMERICA', name: 'South America', zone: 'AMERICA', isMajor: false, stability: 4, startAffiliation: 'BATTLEGROUND', localBonus: sco(), squares: ['MINING'], confidence: 'med' },
  { id: 'UK', name: 'United Kingdom', zone: 'EUROPE', isMajor: false, stability: 5, startAffiliation: 'NATO', localBonus: nato(), squares: ['FIN'], confidence: 'high' },
  { id: 'SCANDINAVIA', name: 'Scandinavia', zone: 'EUROPE', isMajor: false, stability: 5, startAffiliation: 'NATO', localBonus: null, squares: ['TECH'], confidence: 'med' },
  { id: 'EUROZONE', name: 'Eurozone', zone: 'EUROPE', isMajor: true, stability: 5, startAffiliation: 'NATO', startingCamp: 'NATO', localBonus: nato(), squares: ['FIN', 'FIN', 'TECH', 'TECH', 'HEAVY', 'HEAVY'], confidence: 'high' },
  { id: 'EASTERN_EUROPE', name: 'Eastern Europe', zone: 'EUROPE', isMajor: false, stability: 4, startAffiliation: 'BATTLEGROUND', localBonus: sco(), squares: ['HEAVY'], confidence: 'high' },
  { id: 'RUSSIA', name: 'Russia', zone: 'EUROPE', isMajor: true, stability: 4, startAffiliation: 'SCO', startingCamp: 'SCO', localBonus: sco(), squares: ['ENERGY', 'ENERGY'], confidence: 'high' },
  { id: 'CHINA', name: 'China', zone: 'ASIA', isMajor: true, stability: 5, startAffiliation: 'SCO', startingCamp: 'SCO', localBonus: { kind: 'autoWin', camp: 'SCO' }, squares: ['FIN', 'TECH', 'MINING', 'HEAVY', 'HEAVY', 'FIN', 'ENERGY'], confidence: 'med' },
  { id: 'JAPAN', name: 'Japan', zone: 'ASIA', isMajor: true, stability: 5, startAffiliation: 'NATO', startingCamp: 'NATO', localBonus: nato(), squares: ['FIN', 'TECH', 'HEAVY', 'HEAVY'], confidence: 'high' },
  { id: 'INDIA', name: 'India', zone: 'ASIA', isMajor: true, stability: 4, startAffiliation: 'SCO', startingCamp: 'SCO', localBonus: sco(), squares: ['MINING', 'HEAVY', 'TECH', 'MINING', 'HEAVY'], confidence: 'high' },
  // Low confidence: stability, bonus and squares are guesses ("5?", "?", "FIN? TECH?").
  { id: 'KOREA', name: 'Korea', zone: 'ASIA', isMajor: false, stability: 5, startAffiliation: 'NATO', localBonus: null, squares: ['FIN', 'TECH'], confidence: 'low' },
  { id: 'SOUTH_SEA', name: 'South Sea', zone: 'ASIA', isMajor: false, stability: 4, startAffiliation: 'BATTLEGROUND', localBonus: null, squares: ['TECH'], confidence: 'high' },
  // Low confidence: stability "4?" and bonus "+1 SCO?".
  { id: 'INDONESIA', name: 'Indonesia', zone: 'ASIA', isMajor: false, stability: 4, startAffiliation: 'SCO', localBonus: sco(), squares: ['ENERGY'], confidence: 'low' },
  { id: 'AUSTRALIA', name: 'Australia', zone: 'ASIA', isMajor: false, stability: 5, startAffiliation: 'NATO', localBonus: nato(), squares: ['MINING'], confidence: 'med' },
  { id: 'IRAN', name: 'Iran', zone: 'THIRD_WORLD', isMajor: false, stability: 4, startAffiliation: 'BATTLEGROUND', localBonus: sco(), squares: ['ENERGY'], confidence: 'high' },
  { id: 'CENTRAL_ASIA', name: 'Central Asia', zone: 'THIRD_WORLD', isMajor: false, stability: 3, startAffiliation: 'SCO', localBonus: sco(), squares: ['ENERGY'], confidence: 'high' },
  { id: 'AFPAK', name: 'Afpak', zone: 'THIRD_WORLD', isMajor: false, stability: 3, startAffiliation: 'NATO', localBonus: null, squares: ['MINING'], confidence: 'med' },
  { id: 'GULF_STATES', name: 'Gulf States', zone: 'THIRD_WORLD', isMajor: false, stability: 5, startAffiliation: 'NATO', localBonus: nato(), squares: ['ENERGY'], confidence: 'med' },
  { id: 'NORTH_AFRICA', name: 'North Africa', zone: 'THIRD_WORLD', isMajor: false, stability: 3, startAffiliation: 'NATO', localBonus: null, squares: ['MINING'], confidence: 'med' },
  { id: 'SOUTH_AFRICA', name: 'South Africa', zone: 'THIRD_WORLD', isMajor: false, stability: 4, startAffiliation: 'NATO', localBonus: null, squares: ['MINING'], confidence: 'med' },
  { id: TAX_HAVENS, name: 'Tax Havens', zone: null, isMajor: false, stability: 0, startAffiliation: 'NONE', localBonus: null, squares: ['FIN'], confidence: 'high' },
]

/**
 * Directed arrows (R-COMP-09), RULES.md §2.2. **Incomplete** [DATA]: only the
 * arrows visible in the rulebook images. Tax Havens → every country is not
 * listed here; ../board.ts applies it as a rule (R-COMP-09 (c)).
 *
 * Scandinavia ↔ Russia: an arrow exists but its direction is unclear, so
 * both directions are listed until a board photo settles it.
 */
export const ARROWS: readonly (readonly [string, string])[] = [
  ['EUROZONE', 'UK'],
  ['UK', 'CANADA'],
  ['SCANDINAVIA', 'RUSSIA'],
  ['RUSSIA', 'SCANDINAVIA'],
  ['GULF_STATES', 'IRAN'],
  ['IRAN', 'CENTRAL_ASIA'],
  ['LATIN_AMERICA', 'SOUTH_AMERICA'],
  ['JAPAN', 'SOUTH_SEA'],
  ['SOUTH_SEA', 'AUSTRALIA'],
  ['AUSTRALIA', 'UK'],
]

/** Where the R&D marker starts (R-SET-03): the United States ENERGY square. */
export const RD_START = { country: 'US', square: 5 }

/** Setup locks (R-SET-06): the bottom-most `count` squares of each country. */
export const SETUP_LOCKS: readonly { country: string; count: number }[] = [
  { country: 'INDIA', count: 3 },
  { country: 'CHINA', count: 2 },
]

/** Investment cards — the bank's share stock per major country (§1.3, R-SET-07). */
export const INVESTMENT_CARDS: Readonly<Record<string, number>> = {
  US: 7,
  CHINA: 7,
  EUROZONE: 6,
  JAPAN: 3,
  INDIA: 3,
  RUSSIA: 2,
  BRAZIL: 2,
}

/** Payoff deck: 5 cards per industry (§1.3). */
export const PAYOFF_CARDS_PER_INDUSTRY = 5

/** Physical bonds — the cap on loans outstanding across all players ([AMBIG-9]). */
export const TOTAL_BONDS = 25

// Pure helpers shared by the view components — no React state, no rules.

import type { SeatInfo } from '@game-platform/sdk/ui'
import { cardDef, colorsOf } from '../rules.ts'

export const BTN = 'rounded-md border border-neutral-700 px-3 py-1.5 text-sm hover:border-indigo-400 disabled:cursor-not-allowed disabled:opacity-50'
export const BTN_PRIMARY = 'rounded-md border border-indigo-500 bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50'
export const INPUT = 'rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 disabled:opacity-50'

export function nameOf(players: SeatInfo[], id: string | null): string {
  return players.find((p) => p.id === id)?.display_name ?? 'Unknown'
}

/** Frame colours for a card, by its colour (R-CHAR-01) — gold for several, grey for artifacts, brown for lands. */
export function frameClass(def: string): string {
  const d = cardDef(def)
  if (d.types.includes('Land')) return 'border-amber-800/70 bg-amber-950/60'
  const colors = colorsOf(def)
  if (colors.length > 1) return 'border-yellow-500/70 bg-yellow-950/60'
  switch (colors[0]) {
    case 'W':
      return 'border-amber-100/70 bg-stone-700/60'
    case 'U':
      return 'border-sky-400/70 bg-sky-950/70'
    case 'B':
      return 'border-violet-400/60 bg-neutral-900'
    case 'R':
      return 'border-red-500/70 bg-red-950/70'
    case 'G':
      return 'border-green-500/70 bg-green-950/70'
    default:
      return 'border-slate-400/70 bg-slate-800/70'
  }
}

/** Mana symbols `{2}{W}` rendered as short text: `2W`. */
export function manaText(symbols: string): string {
  return symbols.replace(/[{}]/g, '')
}

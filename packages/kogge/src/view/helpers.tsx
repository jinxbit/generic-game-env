// Small presentational pieces shared by the view — no rules, no state.

import type { ReactNode } from 'react'
import { CITIES, COLORS, markerColor } from '../rules.ts'
import type { Color, Goods } from '../types.ts'
import { COLOR_HEX } from './format.ts'

export const BTN = 'rounded-md border border-neutral-700 px-3 py-1.5 text-sm hover:border-indigo-400 disabled:cursor-not-allowed disabled:opacity-50'
export const BTN_PRIMARY = 'rounded-md border border-indigo-500 bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50'
export const BTN_SELECTED = 'rounded-md border border-indigo-400 bg-indigo-600/30 px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50'

export function Section({ title, children, className = '' }: { title: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`flex flex-col gap-3 rounded-md border border-neutral-800 p-4 ${className}`}>
      <h2 className="font-medium">{title}</h2>
      {children}
    </section>
  )
}

export function Badge({ children, className = 'border-neutral-700 text-neutral-300' }: { children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs ${className}`}>{children}</span>
}

/** A good's swatch. */
export function GoodDot({ color, size = 'h-3 w-3' }: { color: Color; size?: string }) {
  return <span className={`inline-block rounded-sm border border-neutral-900 ${size}`} style={{ backgroundColor: COLOR_HEX[color] }} title={color} />
}

/** Goods as swatch × count, skipping colours with none. */
export function GoodsList({ goods, empty = '—' }: { goods: Goods; empty?: string }) {
  const present = COLORS.filter((c) => goods[c] > 0)
  if (present.length === 0) return <span className="text-neutral-500">{empty}</span>
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {present.map((c) => (
        <span key={c} className="inline-flex items-center gap-1 font-mono text-sm">
          <GoodDot color={c} />
          {goods[c]}
        </span>
      ))}
    </span>
  )
}

/** A route marker: its number on its city's colour, or "?" when face down and unknown. */
export function Marker({ value, faceDown = false, count, title }: { value: number | null; faceDown?: boolean; count?: number; title?: string }) {
  const known = value !== null
  const bg = known ? COLOR_HEX[markerColor(value)] : '#404040'
  return (
    <span
      title={title ?? (known ? `${value} → ${CITIES[value].name}${faceDown ? ' (face down)' : ''}` : 'Face down')}
      className={`inline-flex h-7 min-w-7 items-center justify-center rounded-md border px-1 font-mono text-sm font-semibold text-neutral-900 ${faceDown ? 'border-dashed border-neutral-300' : 'border-neutral-900'}`}
      style={{ backgroundColor: bg, opacity: faceDown && known ? 0.75 : 1 }}
    >
      {known ? value : '?'}
      {count !== undefined && count > 1 && <span className="ml-0.5 text-xs">×{count}</span>}
    </span>
  )
}

/** A hand of markers (count per value). */
export function Hand({ markers }: { markers: number[] }) {
  const held = markers.map((n, v) => [v, n] as const).filter(([, n]) => n > 0)
  if (held.length === 0) return <span className="text-neutral-500">no markers</span>
  return (
    <span className="inline-flex flex-wrap gap-1">
      {held.map(([v, n]) => (
        <Marker key={v} value={v} count={n} />
      ))}
    </span>
  )
}

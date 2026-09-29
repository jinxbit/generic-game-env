import { cardLabel } from '../rules.ts'
import type { Card } from '../types.ts'

const SIZES = {
  sm: 'h-9 w-7 text-xs',
  md: 'h-14 w-10 text-base',
}

/**
 * One card: face up when `card` is known, a back when it's hidden (null — a
 * redacted opponent's hole card, or one this viewer shouldn't see), or an
 * empty slot when `slot` is set (a board card not dealt yet).
 */
export function PlayingCard({ card, size = 'md', slot = false, dim = false }: { card: Card | null; size?: keyof typeof SIZES; slot?: boolean; dim?: boolean }) {
  const box = `${SIZES[size]} inline-flex shrink-0 items-center justify-center rounded-md font-semibold select-none`
  if (slot) return <span className={`${box} border border-dashed border-neutral-700`} aria-hidden="true" />
  if (!card) {
    return <span className={`${box} border border-indigo-300/40 bg-[repeating-linear-gradient(45deg,#3730a3_0_4px,#4f46e5_4px_8px)]`} role="img" aria-label="Face-down card" />
  }
  const red = card[1] === 'h' || card[1] === 'd'
  return (
    <span className={`${box} border border-neutral-300 bg-white ${red ? 'text-rose-600' : 'text-neutral-900'} ${dim ? 'opacity-40' : ''}`} role="img" aria-label={cardLabel(card)}>
      {cardLabel(card)}
    </span>
  )
}

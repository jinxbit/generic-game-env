import type { ReactNode } from 'react'
import { cardDef, costLabel, creatureStats, KEYWORD_LABELS, keywordsOf, type GameData, type Permanent } from '../rules.ts'
import { frameClass, manaText } from './helpers.ts'

/** A face-down card (a hidden hand card, a library). */
export function CardBack({ label = 'Face-down card', small = false }: { label?: string; small?: boolean }) {
  return (
    <span
      role="img"
      aria-label={label}
      className={`${small ? 'h-10 w-7' : 'h-24 w-16'} inline-block shrink-0 rounded-md border border-amber-700/60 bg-[repeating-linear-gradient(45deg,#451a03_0_4px,#78350f_4px_8px)]`}
    />
  )
}

/**
 * One card: a hand card (`def` only) or a permanent (with `permanent` and
 * the game, for its current power/toughness, keywords, damage and tapped
 * state). `selected`/`targetable` ring it; `badge` labels it (attacking,
 * blocking); `children` are its buttons.
 */
export function CardTile({
  def,
  game,
  permanent,
  onClick,
  selected = false,
  targetable = false,
  badge,
  children,
}: {
  def: string
  game?: GameData
  permanent?: Permanent
  onClick?: () => void
  selected?: boolean
  targetable?: boolean
  badge?: string
  children?: ReactNode
}) {
  const d = cardDef(def)
  const isCreature = d.types.includes('Creature')
  const stats = permanent && game && isCreature ? creatureStats(game, permanent) : null
  const keywords = permanent && game ? keywordsOf(game, permanent) : (d.keywords ?? [])
  const pt = stats ? `${stats.power}/${stats.toughness}` : isCreature ? (d.statics?.some((s) => s.kind === 'ptFromLands') ? '*/*' : `${d.power}/${d.toughness}`) : null
  const ring = selected ? 'ring-2 ring-indigo-400' : targetable ? 'ring-2 ring-amber-400 animate-pulse' : ''
  const tapped = permanent?.tapped ? 'opacity-60 rotate-[4deg]' : ''
  const body = (
    <>
      <span className="flex items-start justify-between gap-1">
        <span className="font-semibold leading-tight">{d.name}</span>
        {d.cost && <span className="shrink-0 font-mono text-[10px] text-neutral-300">{manaText(costLabel(d.cost))}</span>}
      </span>
      <span className="text-[10px] text-neutral-400">
        {d.types.join(' ')}
        {d.subtypes.length > 0 && ` — ${d.subtypes.join(' ')}`}
      </span>
      {keywords.length > 0 && <span className="text-[10px] text-amber-200">{keywords.map((k) => KEYWORD_LABELS[k]).join(', ')}</span>}
      <span className="mt-auto flex items-end justify-between gap-1">
        {badge ? <span className="rounded bg-rose-700 px-1 text-[10px] font-semibold text-white">{badge}</span> : <span />}
        <span className="flex items-center gap-1">
          {permanent && permanent.damage > 0 && <span className="rounded bg-red-800 px-1 text-[10px] text-white">−{permanent.damage}</span>}
          {pt && <span className="rounded bg-neutral-950/70 px-1 font-mono text-xs">{pt}</span>}
        </span>
      </span>
    </>
  )
  const box = `flex h-28 w-24 flex-col gap-0.5 rounded-lg border p-1.5 text-left text-xs transition ${frameClass(def)} ${ring} ${tapped}`
  return (
    <div className="flex flex-col items-center gap-1">
      {onClick ? (
        <button type="button" className={`${box} hover:brightness-125`} onClick={onClick} title={d.text} aria-label={d.name} aria-pressed={selected || undefined}>
          {body}
        </button>
      ) : (
        <div className={box} title={d.text} aria-label={d.name} role="group">
          {body}
        </div>
      )}
      {children}
    </div>
  )
}

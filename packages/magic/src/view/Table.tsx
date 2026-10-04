import { useState } from 'react'
import type { SeatInfo } from '@game-platform/sdk/ui'
import {
  activationProblem,
  blockableAttackers,
  canAttack,
  canPlayLand,
  cardDef,
  cardName,
  castableNow,
  castCost,
  colorsOf,
  COLORS,
  COMMANDER_DAMAGE,
  commanderCastable,
  commanderTax,
  describeTarget,
  findCard,
  findPayment,
  HAND_SIZE,
  isPriorityStep,
  legalTargets,
  maxX,
  opponentOf,
  poolLabel,
  type CardRef,
  type Color,
  type GameAction,
  type GameData,
  type GameState,
  type Permanent,
  type PlayerId,
  type Target,
  type TargetSpec,
} from '../rules.ts'
import { CardBack, CardTile } from './CardTile.tsx'
import { BTN, BTN_PRIMARY, INPUT, manaText, nameOf } from './helpers.ts'

/** A spell or ability waiting for its X or its target before it's submitted. */
type Intent =
  | { kind: 'cast'; card: CardRef; spec: TargetSpec | undefined; hasX: boolean; x: number }
  | { kind: 'activate'; permanent: Permanent; ability: number; spec: TargetSpec }

const COLOR_NAMES: Record<Color, string> = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' }

function sameTarget(a: Target, b: Target): boolean {
  return a.kind === b.kind && a.id === b.id
}

function passLabel(g: GameData): string {
  if (g.stack.length > 0) return 'Pass priority'
  switch (g.step) {
    case 'main1':
      return 'Go to combat'
    case 'main2':
      return 'End turn'
    case 'combat':
      return 'Go to damage'
    default:
      return 'Pass'
  }
}

interface Props {
  state: GameState
  players: SeatInfo[]
  myPlayerId: string | null
  submitting: boolean
  onAction: (action: GameAction) => void
}

/**
 * The table while a game is being played: the opponent at the top, the
 * stack in the middle, the viewer at the bottom with their hand, and a
 * prompt saying what they may do. Rendered with a fresh `key` per state, so
 * a half-made choice (a target, attackers, blocks) never outlives the
 * position it was made in.
 */
export function Table({ state, players, myPlayerId, submitting, onAction }: Props) {
  const g = state.game
  const seated = myPlayerId !== null && g.seatOrder.includes(myPlayerId)
  const me: PlayerId = seated ? myPlayerId! : g.seatOrder[0]
  const them = opponentOf(g, me)
  const acting = seated && state.status === 'active' && state.pendingPlayerIds.includes(me)
  const priority = acting && isPriorityStep(g)

  const [intent, setIntent] = useState<Intent | null>(null)
  const [attackers, setAttackers] = useState<string[]>(() => (acting && g.step === 'attack' ? g.battlefield.filter((p) => canAttack(g, p) && cardDef(p.def).keywords?.includes('attacksEachCombat')).map((p) => p.id) : []))
  const [blocks, setBlocks] = useState<{ blocker: string; attacker: string }[]>([])
  const [blocker, setBlocker] = useState<string | null>(null)
  const [discards, setDiscards] = useState<string[]>([])

  const declaringBlocks = acting && g.step === 'block' && g.stack.length === 0
  const legal: Target[] = intent?.spec
    ? legalTargets(g, me, intent.spec, colorsOf(intent.kind === 'cast' ? intent.card.def : intent.permanent.def), intent.kind === 'cast' ? intent.card.id : null)
    : []
  const targetable = (t: Target) => legal.some((l) => sameTarget(l, t))

  function submitIntent(i: Intent, target: Target | null) {
    const targets = target ? [target] : []
    if (i.kind === 'cast') onAction({ type: 'CAST', playerId: me, cardId: i.card.id, targets, ...(i.hasX ? { x: i.x } : {}) })
    else onAction({ type: 'ACTIVATE', playerId: me, permanentId: i.permanent.id, ability: i.ability, targets })
    setIntent(null)
  }

  function pickTarget(t: Target) {
    if (intent && targetable(t)) submitIntent(intent, t)
  }

  function clickHandCard(c: CardRef) {
    const def = cardDef(c.def)
    if (g.step === 'discard') {
      setDiscards((d) => (d.includes(c.id) ? d.filter((x) => x !== c.id) : [...d, c.id]))
      return
    }
    if (def.types.includes('Land')) {
      onAction({ type: 'PLAY_LAND', playerId: me, cardId: c.id })
      return
    }
    const next: Intent = { kind: 'cast', card: c, spec: def.target, hasX: !!def.cost?.x, x: def.cost?.x ? Math.max(0, maxX(g, me, def.cost)) : 0 }
    if (!next.spec && !next.hasX) submitIntent(next, null)
    else setIntent(next)
  }

  function handPlayable(c: CardRef): boolean {
    if (!acting) return false
    if (g.step === 'discard') return true
    if (!priority) return false
    const def = cardDef(c.def)
    if (def.types.includes('Land')) return canPlayLand(g, me)
    if (!castableNow(g, me, c.def) || !findPayment(g, me, castCost(g, me, c.id, c.def), 0)) return false
    return !def.target || legalTargets(g, me, def.target, colorsOf(c.def), c.id).length > 0
  }

  function clickPermanent(p: Permanent) {
    if (intent) return pickTarget({ kind: 'permanent', id: p.id })
    if (!acting) return
    if (g.step === 'attack' && p.controller === me && canAttack(g, p)) {
      setAttackers((a) => (a.includes(p.id) ? a.filter((x) => x !== p.id) : [...a, p.id]))
      return
    }
    if (declaringBlocks) {
      if (p.controller === me && blockableAttackers(g, p).length > 0) {
        setBlocks((b) => b.filter((x) => x.blocker !== p.id))
        setBlocker(blocker === p.id ? null : p.id)
      } else if (blocker && g.combat?.attackers.includes(p.id) && blockableAttackers(g, g.battlefield.find((q) => q.id === blocker)!).includes(p.id)) {
        setBlocks((b) => [...b.filter((x) => x.blocker !== blocker), { blocker, attacker: p.id }])
        setBlocker(null)
      }
    }
  }

  function permanentClickable(p: Permanent): boolean {
    if (intent) return targetable({ kind: 'permanent', id: p.id })
    if (!acting) return false
    if (g.step === 'attack') return p.controller === me && canAttack(g, p)
    if (declaringBlocks) return (p.controller === me && blockableAttackers(g, p).length > 0) || (!!blocker && !!g.combat?.attackers.includes(p.id))
    return false
  }

  function abilityButtons(p: Permanent) {
    if (!priority || intent || p.controller !== me) return null
    const abilities = cardDef(p.def).abilities ?? []
    const usable = abilities.map((a, i) => ({ a, i })).filter(({ i }) => activationProblem(g, me, p, i) === null)
    if (usable.length === 0) return null
    return (
      <div className="flex max-w-24 flex-wrap justify-center gap-1">
        {usable.map(({ a, i }) =>
          a.produces === 'any' ? (
            COLORS.map((color) => (
              <button key={`${i}${color}`} type="button" className={`${BTN} px-1 py-0 text-[10px]`} disabled={submitting} aria-label={`Tap ${cardName(p.def)} for ${COLOR_NAMES[color]}`} onClick={() => onAction({ type: 'ACTIVATE', playerId: me, permanentId: p.id, ability: i, targets: [], color })}>
                {color}
              </button>
            ))
          ) : (
            <button
              key={i}
              type="button"
              className={`${BTN} px-1 py-0 text-[10px]`}
              disabled={submitting}
              title={a.text}
              aria-label={a.produces ? `Tap ${cardName(p.def)} for mana` : `${cardName(p.def)}: ${a.text}`}
              onClick={() => (a.target ? setIntent({ kind: 'activate', permanent: p, ability: i, spec: a.target }) : onAction({ type: 'ACTIVATE', playerId: me, permanentId: p.id, ability: i, targets: [] }))}
            >
              {a.produces ? `{T}: ${manaText(a.text.split(': ')[1] ?? '')}` : manaText(a.text.split(':')[0])}
            </button>
          ),
        )}
      </div>
    )
  }

  function badgeOf(p: Permanent): string | undefined {
    if (g.combat?.attackers.includes(p.id)) return 'Attacking'
    const block = g.combat?.blocks.find((b) => b.blocker === p.id) ?? blocks.find((b) => b.blocker === p.id)
    if (block) return `Blocks ${cardName(g.battlefield.find((q) => q.id === block.attacker)?.def ?? '')}`
    if (attackers.includes(p.id)) return 'Attack'
    if (blocker === p.id) return 'Blocking…'
    return undefined
  }

  function battlefieldOf(pid: PlayerId) {
    const mine = g.battlefield.filter((p) => p.controller === pid)
    const lands = mine.filter((p) => cardDef(p.def).types.includes('Land'))
    const others = mine.filter((p) => !cardDef(p.def).types.includes('Land'))
    const tile = (p: Permanent) => (
      <li key={p.id}>
        <CardTile def={p.def} game={g} permanent={p} badge={badgeOf(p)} selected={attackers.includes(p.id) || blocker === p.id} targetable={!!intent && targetable({ kind: 'permanent', id: p.id })} onClick={permanentClickable(p) ? () => clickPermanent(p) : undefined}>
          {p.attachedTo && <span className="text-[10px] text-neutral-400">on {cardName(g.battlefield.find((q) => q.id === p.attachedTo)?.def ?? '')}</span>}
          {abilityButtons(p)}
        </CardTile>
      </li>
    )
    return (
      <div className="flex flex-col gap-2">
        <ul className="flex min-h-10 flex-wrap gap-2" aria-label={`${nameOf(players, pid)}'s permanents`}>
          {others.map(tile)}
        </ul>
        <ul className="flex flex-wrap gap-2" aria-label={`${nameOf(players, pid)}'s lands`}>
          {lands.map(tile)}
        </ul>
      </div>
    )
  }

  function playerPanel(pid: PlayerId) {
    const p = g.players[pid]
    const t: Target = { kind: 'player', id: pid }
    const canTarget = !!intent && targetable(t)
    const pool = poolLabel(p.manaPool)
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="font-semibold">{nameOf(players, pid)}</span>
        <span className="text-lg font-bold text-rose-300" aria-label={`${nameOf(players, pid)}'s life`}>
          ♥ {p.life}
        </span>
        <span className="text-neutral-400">Hand {p.hand.length}</span>
        <span className="text-neutral-400">Library {p.library.length + p.bottom.length}</span>
        {pool && <span className="font-mono text-xs text-amber-200">Pool {manaText(pool)}</span>}
        {g.activeId === pid && <span className="rounded bg-neutral-800 px-1.5 text-xs">Active</span>}
        {state.pendingPlayerIds.includes(pid) && <span className="rounded bg-indigo-700 px-1.5 text-xs text-white">To act</span>}
        {canTarget && (
          <button type="button" className={BTN_PRIMARY} onClick={() => pickTarget(t)}>
            Target {nameOf(players, pid)}
          </button>
        )}
        <Graveyard cards={p.graveyard} targetable={(id) => !!intent && targetable({ kind: 'card', id })} onTarget={(id) => pickTarget({ kind: 'card', id })} />
        {Object.entries(p.commanderDamage ?? {}).map(([id, n]) => (
          <span key={id} className="text-xs text-orange-300" title={`${COMMANDER_DAMAGE} combat damage from one commander loses the game`}>
            ⚔ {cardName(findCard(g, id)?.def ?? '')} {n}/{COMMANDER_DAMAGE}
          </span>
        ))}
        {commandZone(pid)}
      </div>
    )
  }

  /** R-CMD-02/03: the commander, while it waits in the command zone — click it to cast it, paying the tax. */
  function commandZone(pid: PlayerId) {
    const p = g.players[pid]
    const c = p.commander
    if (!c) return null
    const tax = commanderTax(p)
    const castable = pid === me && priority && !intent && handPlayable({ id: c.id, def: c.def }) && commanderCastable(g, me)
    return (
      <span className="flex items-center gap-2" aria-label={`${nameOf(players, pid)}'s command zone`}>
        <span className="text-xs text-neutral-400">
          Command zone{tax > 0 && <span className="text-amber-200"> · tax {`{${tax}}`}</span>}
        </span>
        {c.inCommandZone ? (
          <CardTile def={c.def} selected={intent?.kind === 'cast' && intent.card.id === c.id} onClick={castable ? () => clickHandCard({ id: c.id, def: c.def }) : undefined} />
        ) : (
          <span className="text-xs text-neutral-500">{cardName(c.def)} is out</span>
        )}
      </span>
    )
  }

  function prompt() {
    if (state.status !== 'active') return null
    if (!acting) {
      const who = state.pendingPlayerIds.map((id) => nameOf(players, id)).join(' & ')
      return <p className="text-sm text-neutral-400">Waiting for {who}.</p>
    }
    if (intent) {
      const name = intent.kind === 'cast' ? cardName(intent.card.def) : cardName(intent.permanent.def)
      return (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>{intent.spec ? `Choose a target for ${name}.` : `Choose X for ${name}.`}</span>
          {intent.kind === 'cast' && intent.hasX && (
            <label className="flex items-center gap-1">
              X
              <input type="number" aria-label="X" min={0} max={Math.max(0, maxX(g, me, cardDef(intent.card.def).cost!))} value={intent.x} onChange={(e) => setIntent({ ...intent, x: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} className={`${INPUT} w-16 text-center`} />
            </label>
          )}
          {intent.kind === 'cast' && !intent.spec && (
            <button type="button" className={BTN_PRIMARY} disabled={submitting} onClick={() => submitIntent(intent, null)}>
              Cast {name}
            </button>
          )}
          <button type="button" className={BTN} onClick={() => setIntent(null)}>
            Cancel
          </button>
        </div>
      )
    }
    if (g.step === 'attack') {
      return (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>Choose attackers.</span>
          <button type="button" className={BTN_PRIMARY} disabled={submitting} onClick={() => onAction({ type: 'DECLARE_ATTACKERS', playerId: me, attackers })}>
            {attackers.length === 0 ? 'No attack' : `Attack with ${attackers.length}`}
          </button>
        </div>
      )
    }
    if (g.step === 'discard') {
      const need = g.players[me].hand.length - HAND_SIZE
      return (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>
            Discard down to {HAND_SIZE}: choose {need} ({discards.length}/{need}).
          </span>
          <button type="button" className={BTN_PRIMARY} disabled={submitting || discards.length !== need} onClick={() => onAction({ type: 'DISCARD', playerId: me, cardIds: discards })}>
            Discard
          </button>
        </div>
      )
    }
    if (declaringBlocks) {
      return (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>{blocker ? `Choose the attacker ${cardName(g.battlefield.find((p) => p.id === blocker)!.def)} blocks.` : 'Choose blockers: click one of your creatures, then an attacker. You may also cast instants.'}</span>
          <button type="button" className={BTN_PRIMARY} disabled={submitting} onClick={() => onAction({ type: 'DECLARE_BLOCKERS', playerId: me, blocks })}>
            {blocks.length === 0 ? 'No blocks' : `Block with ${blocks.length}`}
          </button>
        </div>
      )
    }
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>{g.stack.length > 0 ? 'Respond, or let the top of the stack resolve.' : g.activeId === me ? 'Your turn: play a land, cast spells, or move on.' : 'You may cast instants.'}</span>
        <button type="button" className={BTN_PRIMARY} disabled={submitting} onClick={() => onAction({ type: 'PASS', playerId: me })}>
          {passLabel(g)}
        </button>
      </div>
    )
  }

  const hand = g.players[me].hand
  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2 rounded-lg border border-neutral-800 p-3" aria-label={nameOf(players, them)}>
        {playerPanel(them)}
        <div className="flex flex-wrap gap-1" aria-label={`${nameOf(players, them)}'s hand`}>
          {g.players[them].hand.map((c, i) => (c && !seated ? <CardTile key={c.id} def={c.def} /> : <CardBack key={i} small />))}
        </div>
        {battlefieldOf(them)}
      </section>

      {g.stack.length > 0 && (
        <section className="rounded-lg border border-amber-700/60 p-3">
          <h3 className="mb-2 text-sm font-semibold text-amber-200">Stack</h3>
          <ol className="flex flex-col gap-1 text-sm" aria-label="Stack">
            {[...g.stack].reverse().map((item, i) => {
              const t: Target = { kind: 'spell', id: item.id }
              const name = item.card ? cardName(item.card.def) : `${cardName(item.source!.def)} ability`
              return (
                <li key={item.id} className="flex flex-wrap items-center gap-2">
                  <span className="text-neutral-500">{i === 0 ? 'Top' : `${i + 1}.`}</span>
                  <span className="font-medium">{name}</span>
                  {item.x > 0 && <span>X = {item.x}</span>}
                  <span className="text-neutral-400">
                    ({nameOf(players, item.controller)}
                    {item.targets.length > 0 && ` → ${item.targets.map((x) => describeTarget(g, x, Object.fromEntries(players.map((p) => [p.id, p.display_name])))).join(', ')}`})
                  </span>
                  {intent && targetable(t) && (
                    <button type="button" className={BTN_PRIMARY} onClick={() => pickTarget(t)}>
                      Target {name}
                    </button>
                  )}
                </li>
              )
            })}
          </ol>
        </section>
      )}

      <section className="flex flex-col gap-2 rounded-lg border border-neutral-800 p-3" aria-label={nameOf(players, me)}>
        {battlefieldOf(me)}
        {playerPanel(me)}
        <div className="flex flex-wrap gap-2" aria-label={seated ? 'Your hand' : `${nameOf(players, me)}'s hand`}>
          {hand.map((c, i) =>
            c ? (
              <CardTile key={c.id} def={c.def} selected={discards.includes(c.id) || (intent?.kind === 'cast' && intent.card.id === c.id)} onClick={!intent && handPlayable(c) ? () => clickHandCard(c) : undefined} />
            ) : (
              <CardBack key={i} />
            ),
          )}
        </div>
        <div className="rounded-md bg-neutral-900/60 p-2">{prompt()}</div>
      </section>
    </div>
  )
}

function Graveyard({ cards, targetable, onTarget }: { cards: CardRef[]; targetable: (id: string) => boolean; onTarget: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const anyTargetable = cards.some((c) => targetable(c.id))
  if (cards.length === 0) return <span className="text-neutral-500">Graveyard 0</span>
  return (
    <span className="flex flex-wrap items-center gap-1">
      <button type="button" className="text-neutral-400 underline decoration-dotted" onClick={() => setOpen(!open)} aria-expanded={open || anyTargetable}>
        Graveyard {cards.length}
      </button>
      {(open || anyTargetable) &&
        [...cards].reverse().map((c) =>
          targetable(c.id) ? (
            <button key={c.id} type="button" className={`${BTN_PRIMARY} px-1.5 py-0 text-xs`} onClick={() => onTarget(c.id)}>
              {cardName(c.def)}
            </button>
          ) : (
            <span key={c.id} className="rounded bg-neutral-800 px-1.5 text-xs" title={cardDef(c.def).text}>
              {cardName(c.def)}
            </span>
          ),
        )}
    </span>
  )
}

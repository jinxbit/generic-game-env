import { useState } from 'react'
import type { SeatInfo } from '@game-platform/sdk/ui'
import {
  allowedKinds,
  ARTIST_NAMES,
  availableValues,
  cardName,
  counterLabel,
  formatRubens,
  GREY_PRICE,
  influencedArtists,
  PILE_PRICES,
  STEP_LABELS,
  TOP_STEP,
  type GameState,
} from '../rules.ts'
import type { ArtistId, Card, CounterKind, GameAction } from '../types.ts'
import { BTN, BTN_PRIMARY, INPUT, KIND_ICON, KIND_LABEL, known, nameOf } from './helpers.ts'

interface Props {
  state: GameState
  players: SeatInfo[]
  me: string
  submitting: boolean
  onAction: (a: GameAction) => void
}

const STEPS = Array.from({ length: TOP_STEP }, (_, i) => i + 1)

function CountPicker({ max, label, submitLabel, submitting, onSubmit }: { max: number; label: string; submitLabel: string; submitting: boolean; onSubmit: (n: number) => void }) {
  const [count, setCount] = useState(0)
  const n = Math.min(count, max)
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="number"
        min={0}
        max={max}
        aria-label={label}
        value={n}
        disabled={submitting}
        onChange={(e) => setCount(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
        className={`${INPUT} w-16 text-center`}
      />
      <span className="text-xs text-neutral-500">of {max}</span>
      <button type="button" className={BTN_PRIMARY} disabled={submitting} onClick={() => onSubmit(n)}>
        {submitLabel}
      </button>
    </div>
  )
}

/** R-FATE-02/04: choose artist, kind and value. */
function PlaceControls({ state, me, submitting, onAction }: Props) {
  const g = state.game
  const artists = influencedArtists(g, me)
  const kinds = allowedKinds(g, g.fate!)
  const [artist, setArtist] = useState<ArtistId>(artists[0])
  const [kind, setKind] = useState<CounterKind>(kinds[0])
  const target = artists.includes(artist) ? artist : artists[0]
  const k = kinds.includes(kind) ? kind : kinds[0]
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-neutral-400">
        The fate die shows <strong>{g.fate}</strong>. Place a counter in front of an artist you have influence over.
      </p>
      <label className="flex items-center gap-2 text-sm">
        Artist
        <select aria-label="Artist" className={INPUT} value={target} disabled={submitting} onChange={(e) => setArtist(e.target.value as ArtistId)}>
          {artists.map((a) => (
            <option key={a} value={a}>
              {ARTIST_NAMES[a]}
            </option>
          ))}
        </select>
      </label>
      {kinds.length > 1 && (
        <div className="flex gap-2" role="radiogroup" aria-label="Counter kind">
          {kinds.map((option) => (
            <button key={option} type="button" role="radio" aria-checked={k === option} className={`${BTN} ${k === option ? 'border-indigo-400' : ''}`} disabled={submitting} onClick={() => setKind(option)}>
              {KIND_ICON[option]} {KIND_LABEL[option]}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {availableValues(g, k).map((value) => (
          <button key={value} type="button" className={BTN} disabled={submitting} onClick={() => onAction({ type: 'PLACE_COUNTER', playerId: me, artist: target, kind: k, value })}>
            Place {counterLabel(k, value)}
          </button>
        ))}
      </div>
    </div>
  )
}

function ObjectionControls({ state, players, me, submitting, onAction }: Props) {
  const d = state.game.dispute!
  const values = availableValues(state.game, d.counter.kind).filter((v) => v !== d.counter.value)
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-neutral-400">
        {nameOf(players, state.game.turnPlayerId)} placed {counterLabel(d.counter.kind, d.counter.value)} in front of {ARTIST_NAMES[d.artist]}. You have influence there: accept it, or object and propose another value.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={BTN_PRIMARY} disabled={submitting} onClick={() => onAction({ type: 'RESPOND', playerId: me, value: null })}>
          Accept
        </button>
        {values.map((value) => (
          <button key={value} type="button" className={BTN} disabled={submitting} onClick={() => onAction({ type: 'RESPOND', playerId: me, value })}>
            Object: propose {counterLabel(d.counter.kind, value)}
          </button>
        ))}
      </div>
    </div>
  )
}

function NegotiateControls({ state, players, me, submitting, onAction }: Props) {
  const d = state.game.dispute!
  const proposals = Object.entries(d.responses).filter((e): e is [string, number] => e[1] !== null)
  const values = [...new Set(proposals.map(([, v]) => v))]
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-neutral-400">Your {counterLabel(d.counter.kind, d.counter.value)} counter on {ARTIST_NAMES[d.artist]} met objections:</p>
      <ul className="text-sm">
        {proposals.map(([id, v]) => (
          <li key={id}>
            {nameOf(players, id)} proposes {counterLabel(d.counter.kind, v)}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        {values.map((value) => (
          <button key={value} type="button" className={BTN} disabled={submitting} onClick={() => onAction({ type: 'NEGOTIATE', playerId: me, value })}>
            Agree to {counterLabel(d.counter.kind, value)}
          </button>
        ))}
        <button type="button" className={BTN_PRIMARY} disabled={submitting} onClick={() => onAction({ type: 'NEGOTIATE', playerId: me, value: null })}>
          Refuse — keep my counter
        </button>
      </div>
    </div>
  )
}

function ChallengeControls({ state, players, me, submitting, onAction }: Props) {
  const d = state.game.dispute!
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-neutral-400">
        {nameOf(players, state.game.turnPlayerId)} refused to change the {counterLabel(d.counter.kind, d.counter.value)} counter on {ARTIST_NAMES[d.artist]}. A Trial of Strength risks your agent on that step.
      </p>
      <div className="flex gap-2">
        <button type="button" className={BTN_PRIMARY} disabled={submitting} onClick={() => onAction({ type: 'CHALLENGE', playerId: me, challenge: true })}>
          Call a Trial of Strength
        </button>
        <button type="button" className={BTN} disabled={submitting} onClick={() => onAction({ type: 'CHALLENGE', playerId: me, challenge: false })}>
          Let it go
        </button>
      </div>
    </div>
  )
}

function TrialControls({ state, players, me, submitting, onAction }: Props) {
  const g = state.game
  const t = g.trial!
  const mine = known(g.players[me].hand).filter((c) => c.kind === 'might').length
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-neutral-400">
        Trial of Strength over {ARTIST_NAMES[g.dispute!.artist]}, round {t.round} — {t.side === 'contra' ? 'the objectors commit' : `${nameOf(players, g.turnPlayerId)} answers`}. Each might card adds 1 to your dice.
      </p>
      <ul className="text-sm">
        {[...t.contras, g.turnPlayerId!].map((id) => (
          <li key={id}>
            {nameOf(players, id)} {id === g.turnPlayerId ? '(pro)' : '(contra)'}: {t.might[id]?.length ?? 0} might
          </li>
        ))}
      </ul>
      <CountPicker max={mine} label="Might cards to commit" submitLabel="Commit" submitting={submitting} onSubmit={(count) => onAction({ type: 'COMMIT_MIGHT', playerId: me, count })} />
    </div>
  )
}

function DisplayControls({ state, me, submitting, onAction }: Props) {
  const d = state.game.display!
  const hidden = known(state.game.players[me].hand).filter((c) => c.kind === 'work' && c.artist === d.artist).length
  const shown = state.game.players[me].shown.filter((c) => c.kind === 'work' && c.artist === d.artist).length
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-neutral-400">
        {ARTIST_NAMES[d.artist]} is IN: every shown work earns {d.values.map(formatRubens).join(' + ')}. You have {shown} shown and {hidden} hidden. Shown works stay face up for the rest of the game.
      </p>
      <CountPicker max={hidden} label="Works to show" submitLabel="Show" submitting={submitting} onSubmit={(count) => onAction({ type: 'DISPLAY', playerId: me, count })} />
    </div>
  )
}

function BuyControls({ state, me, submitting, onAction }: Props) {
  const g = state.game
  const greyLeft = g.greyDeck.length + g.greyDiscard.length > 0
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-neutral-400">Buy a card: a whole brown pile to choose one card from, or the top grey card. Short of cash, you borrow 100 000 for a 150 000 note.</p>
      <div className="flex flex-wrap gap-2">
        {g.piles.map((pile, i) => (
          <button key={i} type="button" className={BTN} disabled={submitting || pile.length === 0} onClick={() => onAction({ type: 'BUY_PILE', playerId: me, pile: i })}>
            Pile {i + 1} ({pile.length}) · {formatRubens(PILE_PRICES[i])}
          </button>
        ))}
        <button type="button" className={BTN} disabled={submitting || !greyLeft} onClick={() => onAction({ type: 'BUY_GREY', playerId: me })}>
          Grey card · {formatRubens(GREY_PRICE)}
        </button>
      </div>
    </div>
  )
}

function ChooseControls({ state, me, submitting, onAction }: Props) {
  const g = state.game
  const pile = known(g.piles[g.choosing!])
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-neutral-400">Pile {g.choosing! + 1} holds these cards. Take one; the rest go back face down.</p>
      <div className="flex flex-wrap gap-2">
        {pile.map((card) => (
          <button key={card.id} type="button" className={BTN} disabled={submitting} onClick={() => onAction({ type: 'TAKE_CARD', playerId: me, cardId: card.id })}>
            Take {cardName(card)}
          </button>
        ))}
        <button type="button" className={BTN} disabled={submitting} onClick={() => onAction({ type: 'TAKE_CARD', playerId: me, cardId: null })}>
          Take nothing
        </button>
      </div>
    </div>
  )
}

function StepSelect({ label, value, allowReserve, max, disabled, onChange }: { label: string; value: number | null; allowReserve: boolean; max?: number; disabled: boolean; onChange: (s: number | null) => void }) {
  return (
    <select aria-label={label} className={INPUT} value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}>
      {allowReserve && <option value="">reserve</option>}
      {STEPS.filter((s) => max === undefined || s <= max).map((s) => (
        <option key={s} value={s}>
          step {s}
        </option>
      ))}
    </select>
  )
}

function UnlimitedControls({ card, state, me, submitting, onAction }: Props & { card: Card }) {
  const current = state.game.players[me].agents
  const [agents, setAgents] = useState<(number | null)[]>(current)
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      Unlimited step change:
      {agents.map((s, i) => (
        <StepSelect key={i} label={`Agent ${i + 1}`} value={s} allowReserve={current[i] === null} disabled={submitting} onChange={(v) => setAgents(agents.map((x, j) => (j === i ? v : x)))} />
      ))}
      <button type="button" className={BTN} disabled={submitting} onClick={() => onAction({ type: 'PLAY_UNLIMITED', playerId: me, cardId: card.id, agents })}>
        Play
      </button>
    </div>
  )
}

function LimitedControls({ card, state, me, submitting, onAction }: Props & { card: Card & { kind: 'limited' } }) {
  const current = state.game.players[me].agents
  const [agent, setAgent] = useState(0)
  const [to, setTo] = useState<number | null>(1)
  const from = current[agent]
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      Step change ({card.steps}):
      <select aria-label="Agent to move" className={INPUT} value={agent} disabled={submitting} onChange={(e) => setAgent(Number(e.target.value))}>
        {current.map((s, i) => (
          <option key={i} value={i}>
            agent {i + 1} ({s === null ? 'reserve' : `step ${s}`})
          </option>
        ))}
      </select>
      to
      <StepSelect label="Move to step" value={to} allowReserve={false} max={from === null ? card.steps : undefined} disabled={submitting} onChange={setTo} />
      <button type="button" className={BTN} disabled={submitting || to === null} onClick={() => to !== null && onAction({ type: 'PLAY_LIMITED', playerId: me, cardId: card.id, agent, to })}>
        Play
      </button>
    </div>
  )
}

function CriticControls({ card, state, me, submitting, onAction }: Props & { card: Card }) {
  const artists = influencedArtists(state.game, me)
  const [artist, setArtist] = useState<ArtistId | undefined>(artists[0])
  const target = artist && artists.includes(artist) ? artist : artists[0]
  if (!target) return <p className="text-sm text-neutral-500">Critic card: you have influence over no artist to play it on.</p>
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      Critic card on
      <select aria-label="Critic target" className={INPUT} value={target} disabled={submitting} onChange={(e) => setArtist(e.target.value as ArtistId)}>
        {artists.map((a) => (
          <option key={a} value={a}>
            {ARTIST_NAMES[a]}
          </option>
        ))}
      </select>
      <button type="button" className={BTN} disabled={submitting} onClick={() => onAction({ type: 'PLAY_CRITIC', playerId: me, cardId: card.id, artist: target })}>
        Play (−5)
      </button>
    </div>
  )
}

function PlayControls(props: Props) {
  const { state, me, submitting, onAction } = props
  const g = state.game
  const hand = known(g.players[me].hand)
  const firstOf = <K extends Card['kind']>(kind: K) => hand.find((c): c is Extract<Card, { kind: K }> => c.kind === kind)
  const unlimited = g.stepCardPlayed ? undefined : firstOf('unlimited')
  const limited = g.stepCardPlayed ? [] : [...new Map(hand.flatMap((c) => (c.kind === 'limited' ? [[c.steps, c] as const] : []))).values()]
  const critic = firstOf('critic')
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-neutral-400">Play a step change card, then a critic card — either, both, or neither.</p>
      {unlimited && <UnlimitedControls key={unlimited.id} {...props} card={unlimited} />}
      {limited.map((card) => (
        <LimitedControls key={card.id} {...props} card={card} />
      ))}
      {critic && <CriticControls {...props} card={critic} />}
      <div>
        <button type="button" className={BTN_PRIMARY} disabled={submitting} onClick={() => onAction({ type: 'END_TURN', playerId: me })}>
          End turn
        </button>
      </div>
    </div>
  )
}

/** What the viewer may do right now, by step. The rules re-check everything. */
export function ActionPanel({ state, players, myPlayerId, submitting, onAction }: Omit<Props, 'me'> & { myPlayerId: string | null }) {
  const g = state.game
  if (state.status !== 'active') return null
  const mine = myPlayerId !== null && state.pendingPlayerIds.includes(myPlayerId)
  if (!mine) {
    const waitingOn = state.pendingPlayerIds.map((id) => nameOf(players, id)).join(', ')
    return (
      <section className="rounded-md border border-neutral-800 p-4 text-sm text-neutral-400">
        Waiting for {waitingOn || 'nobody'} — {STEP_LABELS[g.step].toLowerCase()}
      </section>
    )
  }
  const props: Props = { state, players, me: myPlayerId!, submitting, onAction }
  return (
    <section className="flex flex-col gap-3 rounded-md border border-indigo-700/60 p-4">
      <h2 className="font-medium">Your move</h2>
      {g.step === 'fate' && (
        <div>
          <button type="button" className={BTN_PRIMARY} disabled={submitting} onClick={() => onAction({ type: 'ROLL_FATE', playerId: props.me })}>
            Roll the fate die
          </button>
        </div>
      )}
      {g.step === 'place' && <PlaceControls {...props} />}
      {g.step === 'objections' && <ObjectionControls {...props} />}
      {g.step === 'negotiate' && <NegotiateControls {...props} />}
      {g.step === 'challenge' && <ChallengeControls {...props} />}
      {g.step === 'trial' && <TrialControls {...props} />}
      {g.step === 'display' && <DisplayControls {...props} />}
      {g.step === 'buy' && <BuyControls {...props} />}
      {g.step === 'choose' && <ChooseControls {...props} />}
      {g.step === 'play' && <PlayControls {...props} />}
    </section>
  )
}

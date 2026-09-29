import { useState } from 'react'
import type { SeatInfo } from '@game-platform/sdk/ui'
import { cardDef, DECKS, handOf, type GameAction, type GameState } from '../rules.ts'
import { CardTile } from './CardTile.tsx'
import { BTN, BTN_PRIMARY, nameOf } from './helpers.ts'

/** R-SETUP-02: each player picks a deck; the other's pick stays hidden until both have. */
export function DeckChoice({ state, players, myPlayerId, submitting, onAction }: { state: GameState; players: SeatInfo[]; myPlayerId: string | null; submitting: boolean; onAction: (a: GameAction) => void }) {
  const mine = myPlayerId !== null && state.pendingPlayerIds.includes(myPlayerId)
  return (
    <section className="flex flex-col gap-3">
      <p className="text-sm text-neutral-400">
        {mine ? 'Choose your deck.' : `Waiting for ${state.pendingPlayerIds.map((id) => nameOf(players, id)).join(' & ')} to choose a deck.`}
      </p>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Decks">
        {DECKS.map((deck) => (
          <li key={deck.id} className="flex flex-col gap-2 rounded-lg border border-neutral-800 p-3">
            <h3 className="font-semibold">{deck.name}</h3>
            <ul className="text-xs text-neutral-400">
              {deck.cards.map(([def, n]) => (
                <li key={def}>
                  {n}× {cardDef(def).name}
                </li>
              ))}
            </ul>
            {mine && (
              <button type="button" className={BTN_PRIMARY} disabled={submitting} onClick={() => onAction({ type: 'CHOOSE_DECK', playerId: myPlayerId!, deck: deck.id })}>
                Play {deck.name}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** R-MULL-01: keep, or mulligan; a keep after mulligans picks the cards for the bottom. */
export function Mulligan({ state, players, myPlayerId, submitting, onAction }: { state: GameState; players: SeatInfo[]; myPlayerId: string | null; submitting: boolean; onAction: (a: GameAction) => void }) {
  const [bottom, setBottom] = useState<string[]>([])
  const g = state.game
  const mine = myPlayerId !== null && state.pendingPlayerIds.includes(myPlayerId)
  if (!mine || !myPlayerId) {
    return <p className="text-sm text-neutral-400">Waiting for {state.pendingPlayerIds.map((id) => nameOf(players, id)).join(' & ')} to keep a hand.</p>
  }
  const me = g.players[myPlayerId]
  const hand = handOf(g, myPlayerId)
  const need = me.mulligans
  const chosen = bottom.filter((id) => hand.some((c) => c.id === id))
  const toggle = (id: string) => setBottom(chosen.includes(id) ? chosen.filter((x) => x !== id) : chosen.length < need ? [...chosen, id] : chosen)
  return (
    <section className="flex flex-col gap-3">
      <p className="text-sm text-neutral-400">
        {need === 0 ? 'Your opening hand.' : `You've taken ${need} mulligan${need === 1 ? '' : 's'}: choose ${need} card${need === 1 ? '' : 's'} to put on the bottom (${chosen.length}/${need}).`}
      </p>
      <div className="flex flex-wrap gap-2" aria-label="Your hand">
        {hand.map((c) => (
          <CardTile key={c.id} def={c.def} selected={chosen.includes(c.id)} onClick={need > 0 ? () => toggle(c.id) : undefined} />
        ))}
      </div>
      <div className="flex gap-2">
        <button type="button" className={BTN_PRIMARY} disabled={submitting || chosen.length !== need} onClick={() => onAction({ type: 'KEEP', playerId: myPlayerId, bottom: chosen })}>
          Keep
        </button>
        <button type="button" className={BTN} disabled={submitting || need >= 7} onClick={() => onAction({ type: 'MULLIGAN', playerId: myPlayerId })}>
          Mulligan
        </button>
      </div>
    </section>
  )
}

import { useState } from 'react'
import type { SeatInfo } from '@game-platform/sdk/ui'
import { amountToCall, canRaise, formatChips, maxRaiseTo, minRaiseTo, potTotal, STEP_LABELS, type GameState } from '../rules.ts'
import type { GameAction } from '../types.ts'
import { BTN, BTN_PRIMARY, INPUT, nameOf } from './helpers.ts'

/** Bet/raise sizing: a number box, a slider and the usual presets, clamped to what's legal. */
function BetControls({ state, me, submitting, onAction }: { state: GameState; me: string; submitting: boolean; onAction: (a: GameAction) => void }) {
  const g = state.game
  const min = minRaiseTo(g, me)
  const max = maxRaiseTo(g, me)
  const [amount, setAmount] = useState(min)
  const clamp = (n: number) => Math.max(min, Math.min(max, Math.round(n)))
  const value = clamp(amount)
  // A pot-sized raise: call, then raise by the pot as it would then stand.
  const potAfterCall = potTotal(g) + amountToCall(g, me)
  const presets: [string, number][] = [
    ['Min', min],
    ['½ pot', g.currentBet + Math.floor(potAfterCall / 2)],
    ['Pot', g.currentBet + potAfterCall],
    ['All in', max],
  ]
  const verb = g.currentBet === 0 ? 'Bet' : 'Raise to'
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="range"
          aria-label="Bet size"
          min={min}
          max={max}
          step={1}
          value={value}
          disabled={submitting || min === max}
          onChange={(e) => setAmount(Number(e.target.value))}
          className="w-48 accent-indigo-500"
        />
        <input
          type="number"
          aria-label="Bet amount"
          min={min}
          max={max}
          value={amount}
          disabled={submitting}
          onChange={(e) => setAmount(Math.floor(Number(e.target.value) || 0))}
          onBlur={() => setAmount(value)}
          className={`${INPUT} w-24 text-center font-mono`}
        />
        <button type="button" className={BTN_PRIMARY} disabled={submitting} onClick={() => onAction({ type: 'BET', playerId: me, amount: value })}>
          {value === max ? `All in (${formatChips(max)})` : `${verb} ${formatChips(value)}`}
        </button>
      </div>
      <div className="flex flex-wrap gap-1">
        {presets.map(([label, n]) => (
          <button key={label} type="button" className={`${BTN} px-2 py-0.5 text-xs`} disabled={submitting} onClick={() => setAmount(clamp(n))}>
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}

/** What the viewer may do right now: fold, check or call, and bet or raise when the rules allow it (R-BET-01..07). */
export function ActionPanel({ state, players, myPlayerId, submitting, onAction }: { state: GameState; players: SeatInfo[]; myPlayerId: string | null; submitting: boolean; onAction: (a: GameAction) => void }) {
  const g = state.game
  if (state.status !== 'active') return null
  const mine = myPlayerId !== null && state.pendingPlayerIds.includes(myPlayerId)
  if (!mine) {
    return (
      <section className="rounded-md border border-neutral-800 p-4 text-sm text-neutral-400">
        Waiting for {nameOf(players, g.toActId)} — {STEP_LABELS[g.step].toLowerCase()}
      </section>
    )
  }
  const me = myPlayerId!
  const toCall = amountToCall(g, me)
  const allInCall = toCall > 0 && toCall === g.players[me].stack
  return (
    <section className="flex flex-col gap-3 rounded-md border border-indigo-700/60 p-4">
      <h2 className="font-medium">Your move</h2>
      <p className="text-sm text-neutral-400">{toCall > 0 ? `${formatChips(toCall)} to call.` : 'Nothing to call.'}</p>
      <div className="flex flex-wrap gap-2">
        {toCall > 0 && (
          <button type="button" className={BTN} disabled={submitting} onClick={() => onAction({ type: 'FOLD', playerId: me })}>
            Fold
          </button>
        )}
        {toCall === 0 ? (
          <button type="button" className={BTN} disabled={submitting} onClick={() => onAction({ type: 'CHECK', playerId: me })}>
            Check
          </button>
        ) : (
          <button type="button" className={BTN} disabled={submitting} onClick={() => onAction({ type: 'CALL', playerId: me })}>
            {allInCall ? `Call ${formatChips(toCall)} (all in)` : `Call ${formatChips(toCall)}`}
          </button>
        )}
      </div>
      {/* Keyed so the chosen size resets whenever the betting moves on. */}
      {canRaise(g, me) && <BetControls key={`${g.hand}-${g.step}-${g.currentBet}`} state={state} me={me} submitting={submitting} onAction={onAction} />}
    </section>
  )
}

import { useState } from 'react'
import type { SeatInfo } from '@game-platform/sdk/ui'
import { COLOURS, forcedSalePrice, formatFT, MAX_BUY_PER_TURN, maxForcedSale, sharePrice, STEP_LABELS, tradesAtZeroPrice, type GameState } from '../rules.ts'
import type { Colour, GameAction } from '../types.ts'
import { BTN, BTN_PRIMARY, COLOUR_HEX, INPUT, nameOf, titleCase } from './helpers.ts'

function ColourPicker({ value, options, onChange, disabled }: { value: Colour; options: readonly Colour[]; onChange: (c: Colour) => void; disabled: boolean }) {
  return (
    <div className="flex gap-1" role="radiogroup">
      {options.map((colour) => (
        <button
          key={colour}
          type="button"
          role="radio"
          aria-checked={value === colour}
          aria-label={titleCase(colour)}
          disabled={disabled}
          onClick={() => onChange(colour)}
          className={`h-8 w-8 rounded-full border-2 disabled:opacity-50 ${value === colour ? 'border-white' : 'border-transparent'}`}
          style={{ backgroundColor: COLOUR_HEX[colour] }}
        />
      ))}
    </div>
  )
}

/** Buy/sell with the bank (R-SHARE-01..03). The rules re-check everything. */
function TradeControls({ state, me, submitting, onAction }: { state: GameState; me: string; submitting: boolean; onAction: (a: GameAction) => void }) {
  const g = state.game
  const [colour, setColour] = useState<Colour>('blue')
  const [count, setCount] = useState(1)
  const mine = g.players[me]
  const left = MAX_BUY_PER_TURN - g.boughtThisTurn
  const unpriced = g.prices[colour] === 0 && !tradesAtZeroPrice(state.rulesVersion)
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ColourPicker value={colour} options={COLOURS} onChange={setColour} disabled={submitting} />
      <input
        type="number"
        min={1}
        aria-label="Number of shares"
        value={count}
        disabled={submitting}
        onChange={(e) => setCount(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
        className={`${INPUT} w-16 text-center`}
      />
      <button
        type="button"
        className={BTN}
        disabled={submitting || unpriced || count > left || mine.cash < count * sharePrice(g, colour) || g.bank[colour] < count}
        onClick={() => onAction({ type: 'BUY', playerId: me, colour, count })}
      >
        Buy for {formatFT(count * sharePrice(g, colour))}
      </button>
      <button
        type="button"
        className={BTN}
        disabled={submitting || unpriced || mine.shares[colour] < count}
        onClick={() => onAction({ type: 'SELL', playerId: me, colour, count })}
      >
        Sell for {formatFT(count * sharePrice(g, colour))}
      </button>
      <span className="text-xs text-neutral-500">
        {left} of {MAX_BUY_PER_TURN} purchases left this turn
      </span>
    </div>
  )
}

/** R-DEBT-02: pick which shares to sell at half price. */
function DebtControls({ state, me, submitting, onAction }: { state: GameState; me: string; submitting: boolean; onAction: (a: GameAction) => void }) {
  const g = state.game
  const options = COLOURS.filter((k) => maxForcedSale(g, me, k) > 0)
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-neutral-300">You owe the bank {formatFT(-g.players[me].cash)}. Sell shares at half price until the debt is covered.</p>
      <div className="flex flex-wrap gap-2">
        {options.map((colour) => {
          const count = maxForcedSale(g, me, colour)
          return (
            <span key={colour} className="flex gap-1">
              <button type="button" className={BTN} disabled={submitting} onClick={() => onAction({ type: 'FORCED_SELL', playerId: me, colour, count: 1 })}>
                Sell 1 {colour} ({formatFT(forcedSalePrice(g, colour))})
              </button>
              {count > 1 && (
                <button type="button" className={BTN} disabled={submitting} onClick={() => onAction({ type: 'FORCED_SELL', playerId: me, colour, count })}>
                  Sell {count} {colour} ({formatFT(count * forcedSalePrice(g, colour))})
                </button>
              )}
            </span>
          )
        })}
      </div>
    </div>
  )
}

/**
 * What the viewer may do right now, by step. Placement happens on the board
 * itself; on a white roll this panel also picks the colour to place.
 */
export function ActionPanel({
  state,
  players,
  myPlayerId,
  submitting,
  onAction,
  placeColour,
  placeOptions,
  onPlaceColour,
}: {
  state: GameState
  players: SeatInfo[]
  myPlayerId: string | null
  submitting: boolean
  onAction: (a: GameAction) => void
  placeColour: Colour | null
  placeOptions: Colour[]
  onPlaceColour: (c: Colour) => void
}) {
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
  const me = myPlayerId!
  return (
    <section className="flex flex-col gap-3 rounded-md border border-indigo-700/60 p-4">
      <h2 className="font-medium">Your move</h2>
      {g.step === 'preTrade' && (
        <>
          <p className="text-sm text-neutral-400">Buy or sell if you like, then roll the dice.</p>
          <TradeControls state={state} me={me} submitting={submitting} onAction={onAction} />
          <div>
            <button type="button" className={BTN_PRIMARY} disabled={submitting} onClick={() => onAction({ type: 'ROLL', playerId: me })}>
              Roll the dice
            </button>
          </div>
        </>
      )}
      {g.step === 'place' && g.roll && (
        <>
          <p className="text-sm text-neutral-400">
            Place a {g.roll.colour === 'white' ? 'marker of any colour' : `${g.roll.colour} marker`} on a ringed box in zone {g.roll.zone}.
          </p>
          {g.roll.colour === 'white' && placeColour && <ColourPicker value={placeColour} options={placeOptions} onChange={onPlaceColour} disabled={submitting} />}
        </>
      )}
      {g.step === 'debts' && <DebtControls state={state} me={me} submitting={submitting} onAction={onAction} />}
      {g.step === 'postTrade' && (
        <>
          <p className="text-sm text-neutral-400">Buy or sell again if you like, then end your turn.</p>
          <TradeControls state={state} me={me} submitting={submitting} onAction={onAction} />
          <div>
            <button type="button" className={BTN_PRIMARY} disabled={submitting} onClick={() => onAction({ type: 'END_TURN', playerId: me })}>
              End turn
            </button>
          </div>
        </>
      )}
    </section>
  )
}

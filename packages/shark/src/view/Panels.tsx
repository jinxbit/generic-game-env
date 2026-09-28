import type { SeatInfo } from '@game-platform/sdk/ui'
import { cellLabel, COLOURS, formatFT, MAX_PRICE, sharePrice, wealthOf, type GameState } from '../rules.ts'
import type { GameData } from '../types.ts'
import { COLOUR_HEX, nameOf, seatColourOf, titleCase } from './helpers.ts'

/** The stock exchange scale (§4): price, shares in the bank, markers left. */
export function Market({ game }: { game: GameData }) {
  return (
    <section className="flex flex-col gap-2 rounded-md border border-neutral-800 p-4">
      <h2 className="font-medium">Stock exchange</h2>
      <table className="text-sm">
        <thead className="text-left text-xs text-neutral-500">
          <tr>
            <th className="font-normal">Colour</th>
            <th className="font-normal">Price (of {MAX_PRICE})</th>
            <th className="font-normal">Share</th>
            <th className="font-normal">Bank shares</th>
            <th className="font-normal">Markers left</th>
          </tr>
        </thead>
        <tbody>
          {COLOURS.map((colour) => (
            <tr key={colour}>
              <td className="flex items-center gap-2 py-0.5">
                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: COLOUR_HEX[colour] }} />
                {titleCase(colour)}
              </td>
              <td>
                <span className="font-mono">{game.prices[colour]}</span>
                <span className="ml-2 inline-block h-2 rounded-sm align-middle" style={{ width: `${game.prices[colour] * 6}px`, backgroundColor: COLOUR_HEX[colour] }} />
              </td>
              <td className="font-mono">{formatFT(sharePrice(game, colour))}</td>
              <td className="font-mono">{game.bank[colour]}</td>
              <td className="font-mono">{game.supply[colour]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

/** Cash, shares and wealth per player; the final standings once the game ends (R-END-02). */
export function PlayersPanel({ state, players }: { state: GameState; players: SeatInfo[] }) {
  const g = state.game
  const ended = state.status === 'completed'
  const rows = g.seatOrder.map((id) => ({ id, player: state.players.find((p) => p.id === id), wealth: g.finalWealth?.[id] ?? wealthOf(g, id) }))
  if (ended) rows.sort((a, b) => b.wealth - a.wealth)
  return (
    <section className="flex flex-col gap-2 rounded-md border border-neutral-800 p-4">
      <h2 className="font-medium">{ended ? 'Final standings' : 'Players'}</h2>
      <ul className="flex flex-col gap-1 text-sm">
        {rows.map(({ id, player, wealth }) => (
          <li key={id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${player?.eliminated ? 'opacity-40' : ''}`}>
            <span className="flex min-w-32 items-center gap-2">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: seatColourOf(players, id) }} />
              {nameOf(players, id)}
              {g.turnPlayerId === id && state.status === 'active' && <span className="text-xs text-indigo-300">(turn)</span>}
              {state.winnerPlayerIds.includes(id) && <span>🏆</span>}
              {player?.conceded && <span className="text-xs text-neutral-500">(conceded)</span>}
            </span>
            <span className="font-mono">{formatFT(g.players[id].cash)}</span>
            <span className="flex gap-2">
              {COLOURS.map((colour) => (
                <span key={colour} className="flex items-center gap-1 font-mono" title={`${colour} shares`}>
                  <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: COLOUR_HEX[colour] }} />
                  {g.players[id].shares[colour]}
                </span>
              ))}
            </span>
            <span className="text-neutral-400">
              worth <span className="font-mono">{formatFT(wealth)}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** The last roll and placement, and the money it moved. */
export function LastMove({ game, players }: { game: GameData; players: SeatInfo[] }) {
  const roll = game.lastRoll
  const placed = game.lastPlacement
  if (!roll && !placed) return null
  return (
    <section className="flex flex-col gap-2 rounded-md border border-neutral-800 p-4 text-sm">
      <h2 className="font-medium">Last move</h2>
      {roll && (
        <p className="flex items-center gap-2">
          {nameOf(players, roll.playerId)} rolled
          <span className="inline-block h-4 w-4 rounded border border-neutral-500" style={{ backgroundColor: COLOUR_HEX[roll.colour] }} />
          {roll.colour} · zone {roll.zone}
          {roll.missed && <span className="text-amber-400">— nowhere to place, turn missed</span>}
        </p>
      )}
      {placed && (
        <>
          <p>
            {nameOf(players, placed.playerId)} placed {placed.colour} on {cellLabel(placed.cell)}
            {placed.groupSize > 1 && ` (group of ${placed.groupSize})`}
            {placed.eliminated.length > 0 && `, eliminating ${placed.eliminated.length} marker${placed.eliminated.length === 1 ? '' : 's'}`}.
          </p>
          <ul className="flex flex-col gap-0.5 text-xs text-neutral-400">
            {placed.payments.map((payment, i) => (
              <li key={i}>
                {nameOf(players, payment.playerId)}: <span className={payment.amount >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{formatFT(payment.amount)}</span> ({payment.reason}, {payment.colour})
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

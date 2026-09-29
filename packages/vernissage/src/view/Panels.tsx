import type { SeatInfo } from '@game-platform/sdk/ui'
import { ARTIST_NAMES, assetsOf, cardName, formatRubens, GREY_PRICE, PILE_PRICES, type GameState } from '../rules.ts'
import type { ArtistId, Card, GameData } from '../types.ts'
import { ARTIST_HEX, known, nameOf, seatColourOf } from './helpers.ts'

function WorkChips({ cards }: { cards: Card[] }) {
  const counts = new Map<ArtistId, number>()
  for (const c of cards) if (c.kind === 'work') counts.set(c.artist, (counts.get(c.artist) ?? 0) + 1)
  if (counts.size === 0) return <span className="text-neutral-500">none</span>
  return (
    <span className="flex flex-wrap gap-2">
      {[...counts].map(([artist, n]) => (
        <span key={artist} style={{ color: ARTIST_HEX[artist] }}>
          {n} × {ARTIST_NAMES[artist]}
        </span>
      ))}
    </span>
  )
}

/** Cash, notes, cards in hand and shown works per player; the final standings once the game ends (R-END-02). */
export function PlayersPanel({ state, players }: { state: GameState; players: SeatInfo[] }) {
  const g = state.game
  const ended = state.status === 'completed'
  const rows = g.seatOrder.map((id) => ({ id, player: state.players.find((p) => p.id === id), assets: g.finalAssets?.[id] ?? null }))
  if (ended) rows.sort((a, b) => (b.assets ?? 0) - (a.assets ?? 0))
  return (
    <section className="flex flex-col gap-2 rounded-md border border-neutral-800 p-4">
      <h2 className="font-medium">{ended ? 'Final standings' : 'Galleries'}</h2>
      <ul className="flex flex-col gap-2 text-sm">
        {rows.map(({ id, player, assets }) => {
          const p = g.players[id]
          return (
            <li key={id} className={`flex flex-col gap-0.5 ${player?.eliminated ? 'opacity-40' : ''}`}>
              <span className="flex flex-wrap items-center gap-x-3">
                <span className="flex min-w-32 items-center gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: seatColourOf(players, id) }} />
                  {nameOf(players, id)}
                  {g.turnPlayerId === id && state.status === 'active' && <span className="text-xs text-indigo-300">(turn)</span>}
                  {state.winnerPlayerIds.includes(id) && <span>🏆</span>}
                  {player?.conceded && <span className="text-xs text-neutral-500">(conceded)</span>}
                </span>
                <span className="font-mono">{formatRubens(p.cash)}</span>
                {p.notes > 0 && <span className="text-rose-300">{p.notes} promissory note{p.notes === 1 ? '' : 's'}</span>}
                <span className="text-neutral-400">{p.hand.length} card{p.hand.length === 1 ? '' : 's'} in hand</span>
                {assets !== null && (
                  <span>
                    assets <span className="font-mono">{formatRubens(assets)}</span>
                  </span>
                )}
              </span>
              <span className="flex gap-2 text-xs text-neutral-400">
                Shown: <WorkChips cards={p.shown} />
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** The viewer's own hand, with what their works are worth right now. */
export function HandPanel({ game, me }: { game: GameData; me: string }) {
  const p = game.players[me]
  if (!p) return null
  const hand = known(p.hand)
  return (
    <section className="flex flex-col gap-2 rounded-md border border-neutral-800 p-4">
      <h2 className="font-medium">Your hand</h2>
      {hand.length === 0 ? (
        <p className="text-sm text-neutral-500">No cards.</p>
      ) : (
        <ul className="flex flex-wrap gap-2 text-sm">
          {hand.map((card) => (
            <li key={card.id} className="rounded border border-neutral-700 px-2 py-1" style={card.kind === 'work' ? { borderColor: ARTIST_HEX[card.artist] } : undefined}>
              {cardName(card)}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-neutral-500">Your assets now: {formatRubens(assetsOf(game, me))} (works at today’s fame, notes deducted).</p>
    </section>
  )
}

/** The brown piles and the grey deck. */
export function Market({ game }: { game: GameData }) {
  return (
    <section className="flex flex-col gap-2 rounded-md border border-neutral-800 p-4">
      <h2 className="font-medium">Cards for sale</h2>
      <ul className="flex flex-wrap gap-2 text-sm">
        {game.piles.map((pile, i) => (
          <li key={i} className="rounded border border-amber-900 px-2 py-1">
            Pile {i + 1}: {pile.length} card{pile.length === 1 ? '' : 's'} · {formatRubens(PILE_PRICES[i])}
          </li>
        ))}
        <li className="rounded border border-neutral-600 px-2 py-1">
          Grey deck: {game.greyDeck.length} (+{game.greyDiscard.length} discarded) · {formatRubens(GREY_PRICE)}
        </li>
      </ul>
    </section>
  )
}

/** The last Trial of Strength's dice. */
export function LastTrial({ game, players }: { game: GameData; players: SeatInfo[] }) {
  const t = game.lastTrial
  if (!t) return null
  return (
    <section className="flex flex-col gap-1 rounded-md border border-neutral-800 p-4 text-sm">
      <h2 className="font-medium">Last Trial of Strength — {ARTIST_NAMES[t.artist]}</h2>
      <ul className="text-xs text-neutral-300">
        {t.rolls.map((r) => (
          <li key={r.playerId}>
            {nameOf(players, r.playerId)} {r.playerId === t.pro ? '(pro)' : '(contra)'}: {r.dice.map(([a, b]) => `${a}+${b}`).join(', then ')}
            {r.might > 0 && ` + ${r.might} might`}
          </li>
        ))}
      </ul>
      <p>{t.winner === 'pro' ? `${nameOf(players, t.pro)} won — the counter stayed.` : 'The objectors won — the counter was removed.'}</p>
    </section>
  )
}

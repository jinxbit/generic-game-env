import type { SeatInfo } from '@game-platform/sdk/ui'
import { ARTIST_NAMES, ARTISTS, counterWorth, FAME_MAX, fameValue, formatRubens, IN_FROM, TOP_STEP } from '../rules.ts'
import type { GameData } from '../types.ts'
import { ARTIST_HEX, KIND_ICON, KIND_LABEL, nameOf, seatColourOf, signed } from './helpers.ts'

/**
 * The success staircase: one column per artist, top step first. Each row
 * shows the agents standing on that step (who has influence there), the
 * artist figures and the fate counters in front of them.
 */
export function Staircase({ game, players }: { game: GameData; players: SeatInfo[] }) {
  const steps = Array.from({ length: TOP_STEP }, (_, i) => TOP_STEP - i)
  const dispute = game.dispute
  return (
    <section className="flex flex-col gap-2 rounded-md border border-neutral-800 p-4">
      <h2 className="font-medium">Success staircase</h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] table-fixed border-separate border-spacing-1 text-xs">
          <thead>
            <tr className="text-left text-neutral-500">
              <th className="w-10 font-normal">Step</th>
              <th className="w-28 font-normal">Agents</th>
              {ARTISTS.map((a) => (
                <th key={a} className="font-normal" style={{ color: ARTIST_HEX[a] }}>
                  {ARTIST_NAMES[a]}
                  {game.feather === a && <span title="Carries the critic’s feather"> 🪶</span>}
                  {game.artists[a].out && <span className="text-neutral-500"> (OUT)</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {steps.map((step) => (
              <tr key={step}>
                <td className="font-mono text-neutral-500">{step}</td>
                <td>
                  <span className="flex flex-wrap gap-1">
                    {game.seatOrder
                      .filter((id) => game.players[id].agents.includes(step))
                      .map((id) => (
                        <span key={id} title={`${nameOf(players, id)}'s agent`} aria-label={`${nameOf(players, id)}'s agent`} className="h-3 w-3 rounded-full border border-neutral-900" style={{ backgroundColor: seatColourOf(players, id) }} />
                      ))}
                  </span>
                </td>
                {ARTISTS.map((a) => {
                  const artist = game.artists[a]
                  if (artist.out) return <td key={a} className="rounded bg-neutral-900/40" />
                  const counter = artist.counters[step - artist.step - 1]
                  const pending = dispute?.artist === a && step === artist.step + artist.counters.length + 1 ? dispute.counter : null
                  return (
                    <td key={a} className="h-6 rounded bg-neutral-900/60 px-1">
                      {artist.step === step && (
                        <span className="font-semibold" style={{ color: ARTIST_HEX[a] }}>
                          ● artist
                        </span>
                      )}
                      {counter && (
                        <span title={KIND_LABEL[counter.kind]}>
                          {KIND_ICON[counter.kind]} {signed(counterWorth(counter.kind, counter.value))}
                        </span>
                      )}
                      {pending && (
                        <span className="text-amber-300" title="Placed, under dispute">
                          {KIND_ICON[pending.kind]} {signed(counterWorth(pending.kind, pending.value))}?
                        </span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-neutral-500">🖼 purchase · ✎ criticism · 📷 scandal. One of each in front of an artist is a Vernissage.</p>
    </section>
  )
}

/** The scale of fame: where each fame marker stands and what a work is worth there. */
export function FameScale({ game }: { game: GameData }) {
  return (
    <section className="flex flex-col gap-2 rounded-md border border-neutral-800 p-4">
      <h2 className="font-medium">Scale of fame</h2>
      <ul className="flex flex-col gap-1 text-sm">
        {ARTISTS.map((a) => {
          const artist = game.artists[a]
          return (
            <li key={a} className="flex items-center gap-2">
              <span className="w-36 truncate" style={{ color: ARTIST_HEX[a] }}>
                {ARTIST_NAMES[a]}
              </span>
              <span className="relative h-3 flex-1 rounded bg-neutral-800" aria-hidden>
                <span className="absolute inset-y-0 right-0 rounded-r bg-amber-500/40" style={{ width: `${((FAME_MAX - IN_FROM + 1) / FAME_MAX) * 100}%` }} />
                {!artist.out && <span className="absolute inset-y-0 left-0 rounded" style={{ width: `${(artist.fame / FAME_MAX) * 100}%`, backgroundColor: ARTIST_HEX[a] }} />}
              </span>
              <span className="w-32 text-right font-mono text-xs">{artist.out ? 'OUT' : formatRubens(fameValue(artist.fame))}</span>
            </li>
          )
        })}
      </ul>
      <p className="text-xs text-neutral-500">The gold end is IN: reaching it pays every shown work of the artist.</p>
    </section>
  )
}

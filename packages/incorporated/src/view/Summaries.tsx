import type { SeatInfo } from '@game-platform/sdk/ui'
import { countryName, INDUSTRIES, ZONE_NAMES } from '../rules.ts'
import type { GameData } from '../types.ts'
import { playerLabel } from './helpers.tsx'
import { Section } from './Section.tsx'

/** The last Power Play, crisis and earnings, plus the narration of the last action. */
export function Summaries({ game, players }: { game: GameData; players: SeatInfo[] }) {
  const { lastPowerPlay: pp, lastCrisis: crisis, lastEarnings: earnings } = game
  if (!pp && !crisis && !earnings && game.journal.length === 0) return null
  return (
    <Section title="Recent events">
      {game.journal.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-sm text-neutral-300">
          {game.journal.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
      {pp && (
        <p className="text-sm">
          <span className="text-neutral-400">Last Power Play: </span>
          {playerLabel(game, players, pp.playerId)} backed {pp.camp} in {countryName(pp.country)} ({ZONE_NAMES[pp.zone]}) —{' '}
          {pp.roll === null ? 'automatic win' : `rolled ${pp.roll}, modified ${pp.modified} vs ${pp.target}`}:{' '}
          <span className={pp.success ? 'text-emerald-400' : 'text-rose-400'}>{pp.success ? 'success' : 'failed'}</span>
        </p>
      )}
      {crisis && (
        <p className="text-sm">
          <span className="text-neutral-400">Crisis (turn {crisis.round}): </span>
          {crisis.ability === 'noCrisis'
            ? 'declared no crisis'
            : `difficulty ${crisis.difficulty}, roll ${crisis.roll}, intensity ${crisis.intensity}${crisis.ability === 'reroll' ? ' (rerolled)' : ''}`}
        </p>
      )}
      {earnings && (
        <div className="flex flex-col gap-1 text-sm">
          <span className="text-neutral-400">Earnings (turn {earnings.round})</span>
          <div className="flex flex-wrap gap-x-3 text-xs text-neutral-400">
            {INDUSTRIES.map((industry) => {
              const leader = earnings.leaders[industry]
              return (
                <span key={industry}>
                  {industry} leader: {leader ? playerLabel(game, players, leader) : '—'}
                </span>
              )
            })}
          </div>
          <div className="overflow-x-auto">
            <table className="text-left text-xs">
              <thead className="text-neutral-500">
                <tr>
                  <th className="pr-3 font-normal">Corporation</th>
                  <th className="pr-3 font-normal">Payoff</th>
                  <th className="pr-3 font-normal">Interest</th>
                  <th className="pr-3 font-normal">Bonds repaid</th>
                </tr>
              </thead>
              <tbody>
                {game.seatOrder.map((id) => (
                  <tr key={id}>
                    <td className="pr-3">{playerLabel(game, players, id)}</td>
                    <td className="pr-3 font-mono">${earnings.payoff[id] ?? 0}</td>
                    <td className="pr-3 font-mono">${earnings.interest[id] ?? 0}</td>
                    <td className="pr-3 font-mono">{earnings.repaid[id] ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Section>
  )
}

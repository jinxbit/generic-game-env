import { useState } from 'react'
import { COUNTRIES, countryDef, countryName, eventKey, ZONE_NAMES, ZONES } from '../rules.ts'
import type { Camp, CountryId, LobbyEvent } from '../types.ts'
import { BTN, BTN_PRIMARY } from './helpers.tsx'
import type { ControlProps, PromptOf } from './helpers.tsx'
import { SelectField } from './Section.tsx'

const CAMPS: Camp[] = ['NATO', 'SCO']

/**
 * One executive to a Lobbying event (§8). Availability mirrors the rules'
 * eventAvailable (R-LOB-02): Tax Havens always; a zone's Power Play only
 * while it has a marker; anything else once per turn — except that
 * Fortress Derivatives' deferred executive is blocked only by their own.
 */
export function LobbyTurnControls({ state, me, submitting, send, prompt }: ControlProps & { prompt: PromptOf<'lobbyTurn'> }) {
  const game = state.game
  const accumRd = state.options.accumRd
  const unblocked = game.deferredPlayerId === me
  const available = (event: LobbyEvent): boolean => {
    const key = eventKey(event)
    if (key === 'TAX_HAVENS') return true
    if (event.kind === 'powerPlay' && game.battlegrounds[event.zone] == null) return false
    const users = game.lobbyUsed[key] ?? []
    return unblocked ? !users.includes(me) : users.length === 0
  }
  const lobby = (event: LobbyEvent) => send({ type: 'LOBBY', playerId: me, event })
  const off = (event: LobbyEvent) => submitting || !available(event)

  const [discardIndex, setDiscardIndex] = useState('0')
  const rdCountries = COUNTRIES.filter((c) => c.stability === 5).map((c) => c.id)
  const [rdCountry, setRdCountry] = useState<CountryId>(rdCountries[0] ?? '')
  const rdSquares = rdCountry
    ? game.countries[rdCountry].squares.flatMap((s, i) => {
        if (accumRd ? s.occupant !== me || s.fortified : game.rdSquare?.country === rdCountry && game.rdSquare.square === i) return []
        return [[String(i), `${countryDef(rdCountry).squares[i]} #${i + 1}`] as [string, string]]
      })
    : []
  const [rdSquare, setRdSquare] = useState('')
  const effectiveRdSquare = rdSquares.some(([v]) => v === rdSquare) ? rdSquare : (rdSquares[0]?.[0] ?? '')
  const payoffsLeft = game.payoffDeck.length + game.payoffDiscard.length > 0

  return (
    <div className="flex flex-col gap-4 text-sm">
      {prompt.mustPowerPlay && <p className="text-amber-300">This executive must make a Power Play.</p>}
      <div className="flex flex-col gap-2">
        <h3 className="font-medium text-neutral-300">Power Play</h3>
        {ZONES.map((zone) => {
          const marker = game.battlegrounds[zone]
          return (
            <div key={zone} className="flex flex-wrap items-center gap-2">
              <span className="w-40 text-neutral-400">
                {ZONE_NAMES[zone]}: {marker ? countryName(marker) : 'resolved'}
              </span>
              {marker &&
                CAMPS.map((camp) => {
                  const event: LobbyEvent = { kind: 'powerPlay', zone, camp }
                  return (
                    <button key={camp} type="button" className={BTN} disabled={off(event)} onClick={() => lobby(event)}>
                      Back {camp}
                    </button>
                  )
                })}
            </div>
          )
        })}
      </div>

      {!prompt.mustPowerPlay && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="w-40 font-medium text-neutral-300">Tax Havens</h3>
            <button type="button" className={BTN} disabled={off({ kind: 'taxHavens' })} onClick={() => lobby({ kind: 'taxHavens' })}>
              Place a loose cube
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <h3 className="w-40 font-medium text-neutral-300">Central Banks</h3>
            {(
              [
                ['interest', 1, 'Tighten Interest'],
                ['interest', -1, 'Ease Interest'],
                ['stress', 1, 'Raise Stress'],
                ['stress', -1, 'Lower Stress'],
              ] as const
            ).map(([slider, direction, label]) => {
              const event: LobbyEvent = { kind: 'centralBanks', slider, direction }
              return (
                <button key={label} type="button" className={BTN} disabled={off(event)} onClick={() => lobby(event)}>
                  {label}
                </button>
              )
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <h3 className="w-40 font-medium text-neutral-300">Budget</h3>
            {game.revealed.length > 0 && (
              <SelectField
                label="Discard"
                value={discardIndex}
                options={game.revealed.map((card, i) => [String(i), `${card} (#${i + 1})`])}
                onChange={setDiscardIndex}
                disabled={submitting}
              />
            )}
            <button
              type="button"
              className={BTN}
              disabled={off({ kind: 'budget', mode: 'stimulus' })}
              onClick={() => lobby(game.revealed.length > 0 ? { kind: 'budget', mode: 'austerity', discardIndex: Number(discardIndex) } : { kind: 'budget', mode: 'austerity' })}
            >
              Austerity (Growth −1)
            </button>
            <button type="button" className={BTN} disabled={off({ kind: 'budget', mode: 'stimulus' })} onClick={() => lobby({ kind: 'budget', mode: 'stimulus' })}>
              Stimulus (Growth +1)
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <h3 className="w-40 font-medium text-neutral-300">{accumRd ? 'R&D (fortify)' : 'R&D'}</h3>
            <SelectField label="Country" value={rdCountry} options={rdCountries.map((id) => [id, countryName(id)])} onChange={setRdCountry} disabled={submitting} />
            <SelectField label="Square" value={effectiveRdSquare} options={rdSquares} onChange={setRdSquare} disabled={submitting} />
            <button
              type="button"
              className={BTN}
              disabled={off({ kind: 'rd', country: rdCountry, square: 0 }) || effectiveRdSquare === ''}
              onClick={() => lobby({ kind: 'rd', country: rdCountry, square: Number(effectiveRdSquare) })}
            >
              {accumRd ? 'Fortify' : 'Move R&D'}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <h3 className="w-40 font-medium text-neutral-300">Subsidies</h3>
            <button type="button" className={BTN} disabled={off({ kind: 'subsidies' }) || game.revealed.length === 0 || !payoffsLeft} onClick={() => lobby({ kind: 'subsidies' })}>
              Look at 3 payoff cards and swap one
            </button>
          </div>
        </>
      )}

      {prompt.canDefer && (
        <div>
          <button type="button" className={BTN_PRIMARY} disabled={submitting} onClick={() => send({ type: 'DEFER_EXECUTIVE', playerId: me })}>
            Hold back my last executive
          </button>
        </div>
      )}
    </div>
  )
}

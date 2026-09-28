import type { SeatInfo } from '@game-platform/sdk/ui'
import { useState } from 'react'
import { countryDef, countryName, moveAllowed, TAX_HAVENS } from '../rules.ts'
import type { Attack, CountryId, GameData, Move, PlayerId } from '../types.ts'
import { boardCountryIds, BTN, BTN_PRIMARY, BTN_SELECTED, defendableCountries, displayNameOf } from './helpers.tsx'
import type { ControlProps, PromptOf } from './helpers.tsx'
import { NumberField, SelectField } from './Section.tsx'

const MAX_STEPS = 2

/** Countries where the player has a loose cube. */
function looseCountries(game: GameData, me: PlayerId): CountryId[] {
  return boardCountryIds().filter((id) => (game.countries[id].loose[me] ?? 0) > 0)
}

/** Every attack a loose cube of mine could make in `country` right now (the server has the final word). */
function attackOptions(game: GameData, players: SeatInfo[], me: PlayerId, country: CountryId): [string, string][] {
  const c = game.countries[country]
  const def = countryDef(country)
  const options: [string, string][] = []
  c.squares.forEach((s, i) => {
    if (s.occupant === null) options.push([`grab:${i}`, `Grab empty ${def.squares[i]} #${i + 1}`])
  })
  if (country === TAX_HAVENS) return options
  for (const [pid, n] of Object.entries(c.loose)) if (pid !== me && n > 0) options.push([`loose:${pid}`, `Kill ${displayNameOf(players, pid)}'s loose cube`])
  for (const [pid, n] of Object.entries(c.defenders)) if (pid !== me && n > 0) options.push([`defender:${pid}`, `Kill ${displayNameOf(players, pid)}'s defender`])
  c.squares.forEach((s, i) => {
    if (s.occupant !== null && s.occupant !== 'LOCK' && s.occupant !== me && !s.fortified) options.push([`square:${i}`, `Kill ${displayNameOf(players, s.occupant)}'s cube on ${def.squares[i]} #${i + 1}`])
  })
  return options
}

function decodeAttack(country: CountryId, code: string): Attack {
  const at = code.indexOf(':')
  const kind = code.slice(0, at)
  const rest = code.slice(at + 1)
  switch (kind) {
    case 'grab':
      return { kind: 'grab', country, square: Number(rest) }
    case 'square':
      return { kind: 'kill', country, target: { kind: 'square', square: Number(rest) } }
    case 'defender':
      return { kind: 'kill', country, target: { kind: 'defender', playerId: rest } }
    default:
      return { kind: 'kill', country, target: { kind: 'loose', playerId: rest } }
  }
}

function attackLabel(players: SeatInfo[], a: Attack): string {
  const where = countryName(a.country)
  if (a.kind === 'grab') return `${where}: grab ${countryDef(a.country).squares[a.square]} #${a.square + 1}`
  const t = a.target
  if (t.kind === 'square') return `${where}: kill the cube on ${countryDef(a.country).squares[t.square]} #${t.square + 1}`
  return `${where}: kill ${displayNameOf(players, t.playerId)}'s ${t.kind === 'loose' ? 'loose cube' : 'defender'}`
}

/** Builds a list of up to two attacks (one cube action each). */
function AttackBuilder({ game, players, me, countries, attacks, onChange, disabled }: { game: GameData; players: SeatInfo[]; me: PlayerId; countries: CountryId[]; attacks: Attack[]; onChange: (attacks: Attack[]) => void; disabled: boolean }) {
  const [country, setCountry] = useState<CountryId>(countries[0] ?? '')
  const [code, setCode] = useState('')
  const options = country ? attackOptions(game, players, me, country) : []
  const effective = options.some(([v]) => v === code) ? code : (options[0]?.[0] ?? '')
  return (
    <div className="flex flex-col gap-2">
      {countries.length === 0 ? (
        <p className="text-sm text-neutral-500">You have no loose cubes on the board.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <SelectField label="Country" value={country} options={countries.map((id) => [id, countryName(id)])} onChange={setCountry} disabled={disabled} />
          <SelectField label="Attack" value={effective} options={options} onChange={setCode} disabled={disabled} />
          <button type="button" className={BTN} disabled={disabled || !effective || attacks.length >= MAX_STEPS} onClick={() => onChange([...attacks, decodeAttack(country, effective)])}>
            Add attack
          </button>
        </div>
      )}
      {attacks.length > 0 && (
        <ol className="flex flex-col gap-1 text-sm">
          {attacks.map((a, i) => (
            <li key={i} className="flex items-center gap-2">
              <span>
                {i + 1}. {attackLabel(players, a)}
              </span>
              <button type="button" className="text-xs text-neutral-400 underline" disabled={disabled} onClick={() => onChange(attacks.filter((_, j) => j !== i))}>
                remove
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

/** ⚑ FREE_CUBES: up to two attacks with the free cubes, in that country only. */
export function FreeAttackControls({ state, players, me, submitting, send, prompt }: ControlProps & { prompt: PromptOf<'freeAttack'> }) {
  const [attacks, setAttacks] = useState<Attack[]>([])
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-neutral-400">You may make one free attack (0–2 cube actions) in {countryName(prompt.country)}.</p>
      <AttackBuilder game={state.game} players={players} me={me} countries={[prompt.country]} attacks={attacks} onChange={setAttacks} disabled={submitting} />
      <div>
        <button type="button" className={BTN_PRIMARY} disabled={submitting} onClick={() => send({ type: 'FREE_ATTACK', playerId: me, attacks })}>
          {attacks.length === 0 ? 'No attack' : `Attack (${attacks.length})`}
        </button>
      </div>
    </div>
  )
}

/** Competition income: place exactly `available` cubes, at most one per share held in each country. */
export function IncomeControls({ state, me, submitting, send, prompt }: ControlProps & { prompt: PromptOf<'income'> }) {
  const shares = Object.entries(state.game.players[me].shares).filter(([, n]) => n > 0)
  const [allocation, setAllocation] = useState<Record<CountryId, number>>(() => {
    const initial: Record<CountryId, number> = {}
    let left = prompt.available
    for (const [country, n] of shares) {
      const take = Math.min(n, left)
      initial[country] = take
      left -= take
    }
    return initial
  })
  const total = Object.values(allocation).reduce((sum, n) => sum + (n || 0), 0)
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-neutral-400">
        Place {prompt.available} income cube(s) as loose cubes, up to your shares in each country. Placed: {total} / {prompt.available}
      </p>
      <div className="flex flex-wrap gap-3">
        {shares.map(([country, n]) => (
          <NumberField
            key={country}
            label={`${countryName(country)} (≤${n})`}
            min={0}
            max={n}
            value={allocation[country] ?? 0}
            disabled={submitting}
            onChange={(value) => setAllocation({ ...allocation, [country]: Math.max(0, Math.min(n, value || 0)) })}
          />
        ))}
      </div>
      <div>
        <button
          type="button"
          className={BTN_PRIMARY}
          disabled={submitting || total !== prompt.available}
          onClick={() => send({ type: 'ALLOCATE_INCOME', playerId: me, allocation: Object.fromEntries(Object.entries(allocation).filter(([, n]) => n > 0)) })}
        >
          Place cubes
        </button>
      </div>
    </div>
  )
}

type Mode = 'fight' | 'defend' | 'expand' | 'pass'

/** R-COMP: one executive to Fight, Defend or Expand — or pass, placing every remaining executive as a defender. */
export function CompetitionTurnControls({ state, players, me, submitting, send }: ControlProps) {
  const game = state.game
  const executives = game.players[me].executives
  const [mode, setMode] = useState<Mode>(executives > 0 ? 'fight' : 'pass')
  const [attacks, setAttacks] = useState<Attack[]>([])
  const defendable = defendableCountries()
  const [defendAt, setDefendAt] = useState<CountryId>(defendable[0])
  const [moves, setMoves] = useState<Move[]>([])
  const sources = looseCountries(game, me)
  const [from, setFrom] = useState<CountryId>(sources[0] ?? '')
  const targets = from ? boardCountryIds().filter((to) => moveAllowed(game, from, to)) : []
  const [to, setTo] = useState<CountryId>('')
  const effectiveTo = targets.includes(to) ? to : (targets[0] ?? '')
  const [passDefenders, setPassDefenders] = useState<CountryId[]>(() => Array.from({ length: executives }, () => defendable[0]))

  const tabs: [Mode, string][] = [
    ['fight', 'Fight'],
    ['defend', 'Defend'],
    ['expand', 'Expand'],
    ['pass', 'Pass'],
  ]
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-neutral-400">Executives left: {executives}</p>
      <div className="flex flex-wrap gap-2">
        {tabs.map(([m, label]) => (
          <button key={m} type="button" className={mode === m ? BTN_SELECTED : BTN} disabled={submitting || (m !== 'pass' && executives === 0)} onClick={() => setMode(m)}>
            {label}
          </button>
        ))}
      </div>

      {mode === 'fight' && (
        <>
          <p className="text-sm text-neutral-400">1–2 attacks with your loose cubes.</p>
          <AttackBuilder game={game} players={players} me={me} countries={sources} attacks={attacks} onChange={setAttacks} disabled={submitting} />
          <div>
            <button type="button" className={BTN_PRIMARY} disabled={submitting || attacks.length === 0} onClick={() => send({ type: 'FIGHT', playerId: me, attacks })}>
              Fight
            </button>
          </div>
        </>
      )}

      {mode === 'defend' && (
        <div className="flex flex-wrap items-center gap-2">
          <SelectField label="Defend" value={defendAt} options={defendable.map((id) => [id, countryName(id)])} onChange={setDefendAt} disabled={submitting} />
          <button type="button" className={BTN_PRIMARY} disabled={submitting} onClick={() => send({ type: 'DEFEND', playerId: me, country: defendAt })}>
            Defend
          </button>
        </div>
      )}

      {mode === 'expand' && (
        <>
          <p className="text-sm text-neutral-400">Move 1–2 loose cubes along arrows.</p>
          {sources.length === 0 ? (
            <p className="text-sm text-neutral-500">You have no loose cubes on the board.</p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <SelectField label="From" value={from} options={sources.map((id) => [id, countryName(id)])} onChange={setFrom} disabled={submitting} />
              <SelectField label="To" value={effectiveTo} options={targets.map((id) => [id, countryName(id)])} onChange={setTo} disabled={submitting} />
              <button type="button" className={BTN} disabled={submitting || !effectiveTo || moves.length >= MAX_STEPS} onClick={() => setMoves([...moves, { from, to: effectiveTo }])}>
                Add move
              </button>
            </div>
          )}
          {moves.length > 0 && (
            <ol className="flex flex-col gap-1 text-sm">
              {moves.map((m, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span>
                    {i + 1}. {countryName(m.from)} → {countryName(m.to)}
                  </span>
                  <button type="button" className="text-xs text-neutral-400 underline" disabled={submitting} onClick={() => setMoves(moves.filter((_, j) => j !== i))}>
                    remove
                  </button>
                </li>
              ))}
            </ol>
          )}
          <div>
            <button type="button" className={BTN_PRIMARY} disabled={submitting || moves.length === 0} onClick={() => send({ type: 'EXPAND', playerId: me, moves })}>
              Expand
            </button>
          </div>
        </>
      )}

      {mode === 'pass' && (
        <>
          <p className="text-sm text-neutral-400">{executives > 0 ? 'Passing places every remaining executive as a defender.' : 'Pass for the rest of the phase.'}</p>
          <div className="flex flex-wrap gap-2">
            {passDefenders.map((country, i) => (
              <SelectField
                key={i}
                label={`Executive ${i + 1}`}
                value={country}
                options={defendable.map((id) => [id, countryName(id)])}
                onChange={(value) => setPassDefenders(passDefenders.map((c, j) => (j === i ? value : c)))}
                disabled={submitting}
              />
            ))}
          </div>
          <div>
            <button type="button" className={BTN_PRIMARY} disabled={submitting} onClick={() => send({ type: 'COMPETITION_PASS', playerId: me, defenders: passDefenders })}>
              Pass
            </button>
          </div>
        </>
      )}
    </div>
  )
}

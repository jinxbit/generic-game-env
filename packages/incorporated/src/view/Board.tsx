import type { SeatInfo } from '@game-platform/sdk/ui'
import { countryDef, TAX_HAVENS, ZONE_NAMES, ZONES } from '../rules.ts'
import type { Affiliation, CountryId, GameData } from '../types.ts'
import { corpColour, countryIdsInZone, displayNameOf } from './helpers.tsx'
import { Badge, Section } from './Section.tsx'

const AFFILIATION_STYLE: Record<Affiliation, string> = {
  NATO: 'border-sky-500 text-sky-300',
  SCO: 'border-rose-500 text-rose-300',
  BATTLEGROUND: 'border-amber-500 text-amber-300',
  NONE: 'border-neutral-700 text-neutral-400',
}

function CountryCard({ game, players, id }: { game: GameData; players: SeatInfo[]; id: CountryId }) {
  const def = countryDef(id)
  const c = game.countries[id]
  const retired = game.retiredMajors.includes(id)
  const loose = Object.entries(c.loose).filter(([, n]) => n > 0)
  const defenders = Object.entries(c.defenders).filter(([, n]) => n > 0)
  return (
    <div className="flex flex-col gap-2 rounded-md border border-neutral-800 p-2 text-sm">
      <div className="flex flex-wrap items-center gap-1">
        <span className={`font-medium ${retired ? 'text-neutral-500 line-through' : ''}`}>{def.name}</span>
        {def.isMajor && <Badge className="border-neutral-600 text-neutral-200">major</Badge>}
        {c.affiliation !== 'NONE' && <Badge className={AFFILIATION_STYLE[c.affiliation]}>{c.affiliation}</Badge>}
        {def.stability > 0 && <span className="text-xs text-neutral-500">stability {def.stability}</span>}
      </div>
      <div className="flex flex-wrap gap-1">
        {c.squares.map((square, i) => {
          const isRd = game.rdSquare?.country === id && game.rdSquare.square === i
          const occupant = square.occupant
          const bg = occupant === null ? undefined : occupant === 'LOCK' ? '#000000' : corpColour(game, players, occupant)
          const title = `${def.squares[i]}${occupant === null ? ' (empty)' : occupant === 'LOCK' ? ' (locked)' : ` — ${displayNameOf(players, occupant)}`}${isRd ? ' · R&D' : ''}${square.fortified ? ' · fortified' : ''}`
          return (
            <span
              key={i}
              title={title}
              className={`inline-flex h-7 min-w-11 items-center justify-center rounded border px-1 text-[10px] font-semibold ${
                occupant === null ? 'border-neutral-600 text-neutral-400' : 'border-neutral-900 text-white'
              } ${isRd ? 'ring-2 ring-fuchsia-400' : ''} ${square.fortified ? 'outline-2 outline-offset-1 outline-amber-400' : ''}`}
              style={bg ? { backgroundColor: bg } : undefined}
            >
              {def.squares[i]}
              {isRd && '★'}
            </span>
          )
        })}
      </div>
      {(loose.length > 0 || defenders.length > 0) && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-neutral-300">
          {loose.map(([pid, n]) => (
            <span key={`l-${pid}`} className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: corpColour(game, players, pid) }} />
              {n} loose
            </span>
          ))}
          {defenders.map(([pid, n]) => (
            <span key={`d-${pid}`} className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: corpColour(game, players, pid) }} />
              {n} defending
            </span>
          ))}
        </div>
      )}
      {def.isMajor && <span className="text-xs text-neutral-500">{retired ? 'Shares retired' : `Bank shares: ${game.bank[id] ?? 0}`}</span>}
    </div>
  )
}

/** The world map as lists: zone by zone, then Tax Havens. ★ ringed square = R&D; amber outline = fortified. */
export function Board({ game, players }: { game: GameData; players: SeatInfo[] }) {
  return (
    <Section title="Board">
      {ZONES.map((zone) => {
        const marker = game.battlegrounds[zone]
        return (
          <div key={zone} className="flex flex-col gap-2">
            <h3 className="text-sm font-medium text-neutral-300">
              {ZONE_NAMES[zone]}
              <span className="ml-2 text-xs font-normal text-neutral-500">{marker ? `battleground marker: ${countryDef(marker).name}` : 'no battleground marker'}</span>
            </h3>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {countryIdsInZone(zone).map((id) => (
                <CountryCard key={id} game={game} players={players} id={id} />
              ))}
            </div>
          </div>
        )
      })}
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-neutral-300">Tax Havens</h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <CountryCard game={game} players={players} id={TAX_HAVENS} />
        </div>
      </div>
    </Section>
  )
}

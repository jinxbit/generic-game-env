import type { SeatInfo } from '@game-platform/sdk/ui'
import { cellLabel, cityById, CELLS, colOf, COLS, isGreenVillage, isMarketActive, marketPlace, marketValue, oracleAt, rowOf, VILLAGE_AT, type Analysis } from '../rules.ts'
import type { GameData } from '../types.ts'
import { nameOf, roadPath, seatColourOf } from './helpers.ts'

const LAND = '#3f3a33'
const GRID = '#57504a'
const MARKET_SPOTS: [number, number][] = [
  [8, 8],
  [32, 8],
  [8, 32],
  [32, 32],
]

/** An arrow pointing from `from` towards `to`, for an oracle's attention. */
function arrowTowards(from: number, to: number): string {
  const dr = rowOf(to) - rowOf(from)
  const dc = colOf(to) - colOf(from)
  const angle = Math.atan2(dr, dc)
  const arrows = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗']
  return arrows[(Math.round(angle / (Math.PI / 4)) + 8) % 8]
}

/** What's on a cell, in words — its tooltip and accessible name. */
function describeCell(game: GameData, analysis: Analysis, players: SeatInfo[], cell: number): string {
  const parts = [cellLabel(cell)]
  const road = game.roads[cell]
  const oracle = oracleAt(game, cell)
  const cityId = analysis.cityOf[cell]
  if (road) parts.push(`${nameOf(players, road.owner)}'s road`)
  if (oracle) parts.push(oracle.attention === null ? 'oracle (attending nobody)' : `oracle attending ${nameOf(players, cityById(game, oracle.attention)!.owner)}'s city at ${cellLabel(oracle.attention)}`)
  if (cityId !== null) {
    const city = cityById(game, cityId)!
    parts.push(`${nameOf(players, city.owner)}'s city (${analysis.tilesOf.get(cityId)!.length} tiles, ${analysis.links.get(`c${cityId}`)?.size ?? 0} connections)`)
  } else if (VILLAGE_AT.has(cell) && !oracle) {
    parts.push(`${isGreenVillage(cell) ? 'green-bordered ' : ''}village (${analysis.links.get(`v${cell}`)?.size ?? 0} connections)`)
  }
  const place = cityId !== null ? `c${cityId}` : `v${cell}`
  for (const m of game.markets.filter((m) => marketPlace(analysis, m) === place)) {
    const state = m.sold ? 'sold' : isMarketActive(game, analysis, m) ? `active, worth ${marketValue(game, analysis, m)}` : 'inactive'
    parts.push(`${nameOf(players, m.owner)}'s market (${state})`)
  }
  return parts.join(' · ')
}

/**
 * The 13 × 13 map. Each cell draws what's on it — village, oracle, city tile,
 * road — and the markets standing on it (a city's on its village spaces). Cells in
 * `highlight` are ringed and clickable; the map scales to its container.
 */
export function Board({
  game,
  analysis,
  players,
  highlight,
  selected,
  disabled,
  onCell,
}: {
  game: GameData
  analysis: Analysis
  players: SeatInfo[]
  highlight: Map<number, string> | null
  selected: number | null
  disabled: boolean
  onCell: (cell: number) => void
}) {
  return (
    <div className="w-full max-w-[36rem]">
      <div className="grid rounded-md border border-neutral-700" style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }}>
        {Array.from({ length: CELLS }, (_, cell) => {
          const hint = highlight?.get(cell)
          const title = describeCell(game, analysis, players, cell) + (hint ? ` · ${hint}` : '')
          const road = game.roads[cell]
          const owner = game.cityTiles[cell]
          const oracle = oracleAt(game, cell)
          const village = VILLAGE_AT.has(cell) && !oracle
          const markets = game.markets.filter((m) => m.cell === cell)
          return (
            <button
              key={cell}
              type="button"
              title={title}
              aria-label={title}
              disabled={hint === undefined || disabled}
              onClick={() => onCell(cell)}
              className={`relative aspect-square ${hint !== undefined ? 'cursor-pointer' : 'cursor-default'}`}
            >
              <svg viewBox="0 0 40 40" className="absolute inset-0 h-full w-full">
                <rect x="0" y="0" width="40" height="40" fill={LAND} stroke={GRID} strokeWidth="0.5" />
                {owner && <rect x="1.5" y="1.5" width="37" height="37" rx="3" fill={seatColourOf(players, owner)} stroke="#00000066" strokeWidth="1.5" />}
                {village && (
                  <g>
                    {isGreenVillage(cell) && <rect x="3" y="3" width="34" height="34" rx="5" fill="none" stroke="#22c55e" strokeWidth="2.5" />}
                    <path d="M 12 22 L 20 13 L 28 22 L 28 29 L 12 29 Z" fill={owner ? '#ffffffcc' : '#e7e5e4'} stroke="#1c1917" strokeWidth="1" />
                  </g>
                )}
                {oracle && (
                  <g>
                    <circle cx="20" cy="20" r="13" fill="#4c1d95" stroke="#c4b5fd" strokeWidth="1.5" />
                    <path d="M 12 17 L 20 11 L 28 17 Z M 13 18 H 27 V 20 H 13 Z M 14 21 H 16 V 27 H 14 Z M 19 21 H 21 V 27 H 19 Z M 24 21 H 26 V 27 H 24 Z M 12 28 H 28 V 30 H 12 Z" fill="#ede9fe" />
                    {oracle.attention !== null && (
                      <>
                        <circle cx="33" cy="7" r="5" fill={seatColourOf(players, cityById(game, oracle.attention)!.owner)} stroke="#000" strokeWidth="1" />
                        <text x="33" y="10" textAnchor="middle" fontSize="8" fill="#000">
                          {arrowTowards(cell, oracle.attention)}
                        </text>
                      </>
                    )}
                  </g>
                )}
                {road && <path d={roadPath(road.ends)} fill="none" stroke={seatColourOf(players, road.owner)} strokeWidth="7" strokeLinecap="butt" />}
                {road && <path d={roadPath(road.ends)} fill="none" stroke="#00000055" strokeWidth="1.5" strokeDasharray="3 3" />}
                {markets.map((m, i) => (
                  <circle
                    key={m.owner}
                    cx={MARKET_SPOTS[i % 4][0]}
                    cy={MARKET_SPOTS[i % 4][1]}
                    r="4.5"
                    fill={m.sold ? 'none' : seatColourOf(players, m.owner)}
                    stroke={m.sold ? seatColourOf(players, m.owner) : '#000'}
                    strokeWidth={m.sold ? 2 : 1}
                    opacity={m.sold || isMarketActive(game, analysis, m) ? 1 : 0.4}
                  />
                ))}
                {hint !== undefined && <rect x="1" y="1" width="38" height="38" fill="#6366f133" stroke="#818cf8" strokeWidth="2" />}
                {selected === cell && <rect x="1" y="1" width="38" height="38" fill="none" stroke="#fff" strokeWidth="3" />}
              </svg>
            </button>
          )
        })}
      </div>
    </div>
  )
}

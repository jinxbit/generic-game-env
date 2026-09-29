import type { SeatInfo } from '@game-platform/sdk/ui'
import { cellLabel, cityById, HEXES, isGreenVillage, isMarketActive, MAX_COL, marketPlace, marketValue, oracleAt, ROWS, VILLAGE_AT, type Analysis } from '../rules.ts'
import type { GameData } from '../types.ts'
import { HEX_POINTS, HEX_R, nameOf, roadPath, seatColourOf } from './helpers.ts'

const LAND = '#3f3a33'
const GRID = '#57504a'
const MARKET_SPOTS: [number, number][] = [
  [-8, -8],
  [8, -8],
  [-8, 8],
  [8, 8],
]

/** Where a hex's centre is drawn: doubled columns sit half a hex apart, rows three quarters of a hex. */
const X_STEP = (HEX_R * Math.sqrt(3)) / 2
const Y_STEP = HEX_R * 1.5
const PAD = 2
const WIDTH = (MAX_COL + 1) * X_STEP + 2 * PAD
const HEIGHT = (ROWS - 1) * Y_STEP + 2 * HEX_R + 2 * PAD

function centre(cell: number): [number, number] {
  const { row, col } = HEXES[cell]
  return [PAD + col * X_STEP, PAD + HEX_R + row * Y_STEP]
}

/** An arrow pointing from `from` towards `to`, for an oracle's attention. */
function arrowTowards(from: number, to: number): string {
  const [fx, fy] = centre(from)
  const [tx, ty] = centre(to)
  const angle = Math.atan2(ty - fy, tx - fx)
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
 * The hex map, drawn as one scalable SVG. Each hex draws what's on it —
 * village, oracle, city tile, road — and the markets standing on it (a
 * city's on its village spaces). Hexes in `highlight` are ringed and act as
 * buttons.
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
    <div className="w-full max-w-[48rem] overflow-hidden rounded-md border border-neutral-700 bg-[#1e3a44]">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="block h-auto w-full" role="group" aria-label="Map of Magna Grecia">
        {HEXES.map((_, cell) => {
          const hint = highlight?.get(cell)
          const clickable = hint !== undefined && !disabled
          const title = describeCell(game, analysis, players, cell) + (hint ? ` · ${hint}` : '')
          const road = game.roads[cell]
          const owner = game.cityTiles[cell]
          const oracle = oracleAt(game, cell)
          const village = VILLAGE_AT.has(cell) && !oracle
          const markets = game.markets.filter((m) => m.cell === cell)
          const [x, y] = centre(cell)
          return (
            <g
              key={cell}
              transform={`translate(${x} ${y})`}
              role={clickable ? 'button' : undefined}
              aria-label={clickable ? title : undefined}
              tabIndex={clickable ? 0 : undefined}
              onClick={clickable ? () => onCell(cell) : undefined}
              onKeyDown={clickable ? (e) => (e.key === 'Enter' || e.key === ' ') && onCell(cell) : undefined}
              className={clickable ? 'cursor-pointer' : undefined}
            >
              <title>{title}</title>
              <polygon points={HEX_POINTS} fill={owner ? seatColourOf(players, owner) : LAND} stroke={GRID} strokeWidth="0.8" />
              {village && (
                <g>
                  {isGreenVillage(cell) && <polygon points={HEX_POINTS} transform="scale(0.82)" fill="none" stroke="#22c55e" strokeWidth="2.5" />}
                  <path d="M -7 1 L 0 -7 L 7 1 L 7 7 L -7 7 Z" fill={owner ? '#ffffffcc' : '#d6b98c'} stroke="#1c1917" strokeWidth="0.8" />
                </g>
              )}
              {oracle && (
                <g>
                  <circle r="12" fill="#4c1d95" stroke="#c4b5fd" strokeWidth="1.2" />
                  <path d="M -7 -3 L 0 -8 L 7 -3 Z M -6 -2 H 6 V 0 H -6 Z M -5 1 H -3 V 6 H -5 Z M -1 1 H 1 V 6 H -1 Z M 3 1 H 5 V 6 H 3 Z M -7 7 H 7 V 8.5 H -7 Z" fill="#ede9fe" />
                  {oracle.attention !== null && (
                    <>
                      <circle cx="10" cy="-10" r="5" fill={seatColourOf(players, cityById(game, oracle.attention)!.owner)} stroke="#000" strokeWidth="0.8" />
                      <text x="10" y="-7.5" textAnchor="middle" fontSize="7" fill="#000">
                        {arrowTowards(cell, oracle.attention)}
                      </text>
                    </>
                  )}
                </g>
              )}
              {road && <path d={roadPath(road.ends)} fill="none" stroke={seatColourOf(players, road.owner)} strokeWidth="6" />}
              {road && <path d={roadPath(road.ends)} fill="none" stroke="#00000055" strokeWidth="1.2" strokeDasharray="2.5 2.5" />}
              {markets.map((m, i) => (
                <circle
                  key={m.owner}
                  cx={MARKET_SPOTS[i % 4][0]}
                  cy={MARKET_SPOTS[i % 4][1]}
                  r="3.8"
                  fill={m.sold ? 'none' : seatColourOf(players, m.owner)}
                  stroke={m.sold ? seatColourOf(players, m.owner) : '#000'}
                  strokeWidth={m.sold ? 1.8 : 0.8}
                  opacity={m.sold || isMarketActive(game, analysis, m) ? 1 : 0.4}
                />
              ))}
              {hint !== undefined && <polygon points={HEX_POINTS} transform="scale(0.92)" fill="#6366f133" stroke="#818cf8" strokeWidth="2" />}
              {selected === cell && <polygon points={HEX_POINTS} transform="scale(0.92)" fill="none" stroke="#fff" strokeWidth="2.5" />}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

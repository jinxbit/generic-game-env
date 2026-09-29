import type { SeatInfo } from '@game-platform/sdk/ui'
import { CELLS, CENTRE, cellLabel, cellOf, edgeBetween, FARMHOUSES, farmFields, GEESE, isEnclosed, isField, RADIUS, type FenceMove, type GameData } from '../rules.ts'
import { cellCentre, HEX_SIZE, hexPoints, seatColourOf, vertexPoint } from './helpers.ts'

const EXTENT = HEX_SIZE * Math.sqrt(3) * (RADIUS + 1)

/**
 * The hex board as SVG: fields (geese fields marked), the seven central hexes
 * with the farmhouses and the dog's kennel in the middle, sheep, the dog and
 * the fence lines. Enclosed farms are tinted in their owner's colour.
 *
 * What's clickable comes from the caller: `targets` (cells), `centreTarget`,
 * and `fenceOptions` (drawn dashed, clickable). A face-down sheep shows its
 * value only to the player who placed it (`myPlayerId`), and only if the
 * state carries it — a redacted view doesn't.
 */
export function Board({
  game,
  players,
  myPlayerId,
  targets,
  selected,
  centreTarget,
  fenceOptions,
  disabled,
  onCell,
  onCentre,
  onFence,
}: {
  game: GameData
  players: SeatInfo[]
  myPlayerId: string | null
  targets: Set<number>
  selected: number[]
  centreTarget: boolean
  fenceOptions: FenceMove[]
  disabled: boolean
  onCell: (cell: number) => void
  onCentre: () => void
  onFence: (move: FenceMove) => void
}) {
  const tint = new Map<number, string>()
  for (const id of game.seatOrder) {
    if (!isEnclosed(game, id)) continue
    for (const cell of farmFields(game.borders, game.farms[id].position)) tint.set(cell, seatColourOf(players, id))
  }
  const owners = new Map(game.seatOrder.map((id) => [FARMHOUSES[game.farms[id].position], id]))
  const last = game.last
  const lastCells = new Set(last?.kind === 'place' || last?.kind === 'flip' ? [last.cell] : last?.kind === 'herd' ? [last.to] : [])

  return (
    <div className="flex justify-center">
      <svg viewBox={`${-EXTENT} ${-EXTENT} ${2 * EXTENT} ${2 * EXTENT}`} className="w-full max-w-xl select-none" role="group" aria-label="Board">
        {CELLS.map((_, cell) => {
          const { x, y } = cellCentre(cell)
          const field = isField(cell)
          const owner = owners.get(cell)
          const clickable = !disabled && (cell === CENTRE ? centreTarget : targets.has(cell))
          const fill = cell === CENTRE ? '#57534e' : owner ? seatColourOf(players, owner) : field ? (GEESE.has(cell) ? '#3f6212' : '#365314') : '#44403c'
          const sheep = game.sheep[cell]
          const label = cell === CENTRE ? 'Centre' : `${cellLabel(cell)}${GEESE.has(cell) ? ' · geese' : ''}${sheep ? (sheep.faceUp ? ' · face-up sheep' : ' · face-down sheep') : ''}${game.dog === cell ? ' · dog' : ''}`
          return (
            <g
              key={cell}
              role={clickable ? 'button' : undefined}
              aria-label={clickable ? label : undefined}
              tabIndex={clickable ? 0 : undefined}
              onClick={clickable ? () => (cell === CENTRE ? onCentre() : onCell(cell)) : undefined}
              onKeyDown={clickable ? (e) => (e.key === 'Enter' || e.key === ' ') && (cell === CENTRE ? onCentre() : onCell(cell)) : undefined}
              className={clickable ? 'cursor-pointer' : undefined}
            >
              <title>{label}</title>
              <polygon points={hexPoints(cell)} fill={fill} stroke="#1c1917" strokeWidth={1} />
              {tint.has(cell) && <polygon points={hexPoints(cell)} fill={tint.get(cell)} fillOpacity={0.28} />}
              {GEESE.has(cell) && !sheep && game.dog !== cell && (
                <text x={x} y={y + 4} textAnchor="middle" fontSize={11} fill="#d9f99d">
                  ×2
                </text>
              )}
              {owner && (
                <text x={x} y={y + 5} textAnchor="middle" fontSize={14}>
                  🏠
                </text>
              )}
              {sheep && <SheepToken x={x} y={y} sheep={sheep} mine={sheep.placedBy === myPlayerId} highlighted={lastCells.has(cell)} />}
              {(game.dog === cell || (cell === CENTRE && game.dog === null)) && (
                <text x={x} y={y + 6} textAnchor="middle" fontSize={17}>
                  🐕
                </text>
              )}
              {clickable && <polygon points={hexPoints(cell)} fill="#818cf8" fillOpacity={0.18} stroke="#a5b4fc" strokeWidth={2} />}
              {selected.includes(cell) && <polygon points={hexPoints(cell)} fill="none" stroke="#fde047" strokeWidth={3} />}
            </g>
          )
        })}
        {game.borders.map((border, b) =>
          border.path.slice(1).map((to, i) => {
            const p = vertexPoint(border.path[i])
            const q = vertexPoint(to)
            return <line key={`${b}-${i}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke={seatColourOf(players, border.builtBy[i])} strokeWidth={5} strokeLinecap="round" />
          }),
        )}
        {!disabled &&
          fenceOptions.map((move) => {
            const p = vertexPoint(move.from)
            const q = vertexPoint(move.to)
            const label = `Fence between ${edgeLabel(move)}`
            return (
              <g key={`${move.border}:${move.from}:${move.to}`} role="button" aria-label={label} tabIndex={0} className="cursor-pointer" onClick={() => onFence(move)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onFence(move)}>
                <title>{label}</title>
                <line x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke="#fde047" strokeWidth={4} strokeDasharray="4 3" strokeLinecap="round" />
                <line x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke="transparent" strokeWidth={12} />
              </g>
            )
          })}
      </svg>
    </div>
  )
}

function SheepToken({ x, y, sheep, mine, highlighted }: { x: number; y: number; sheep: NonNullable<GameData['sheep'][number]>; mine: boolean; highlighted: boolean }) {
  const r = HEX_SIZE * 0.62
  const ring = highlighted ? '#fde047' : '#0c0a09'
  if (!sheep.faceUp) {
    const known = mine && sheep.sheep
    return (
      <g>
        <circle cx={x} cy={y} r={r} fill="#a8a29e" stroke={ring} strokeWidth={highlighted ? 2.5 : 1} />
        <text x={x} y={y + 4} textAnchor="middle" fontSize={11} fontStyle={known ? 'italic' : undefined} fill="#1c1917">
          {known ? (sheep.sheep!.black ? 'B' : signed(sheep.sheep!.value)) : '?'}
        </text>
      </g>
    )
  }
  const s = sheep.sheep!
  return (
    <g>
      <circle cx={x} cy={y} r={r} fill={s.black ? '#0c0a09' : '#fafaf9'} stroke={s.black ? '#fafaf9' : ring} strokeWidth={highlighted ? 2.5 : 1} />
      <text x={x} y={y + 4} textAnchor="middle" fontSize={12} fontWeight={700} fill={s.black ? '#fafaf9' : s.value < 0 ? '#b91c1c' : '#15803d'}>
        {s.black ? '🐑' : signed(s.value)}
      </text>
    </g>
  )
}

/** "D4 and E5": the two hexes a fence would separate. */
function edgeLabel(move: FenceMove): string {
  return edgeBetween(move.from, move.to)
    .split('/')
    .map((key) => {
      const [q, r] = key.split(',').map(Number)
      return cellLabel(cellOf({ q, r }))
    })
    .join(' and ')
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0'
}

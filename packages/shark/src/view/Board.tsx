import { cellLabel, COLS, previewPlacement, ROWS, zoneOf } from '../rules.ts'
import type { Colour, GameData } from '../types.ts'
import { COLOUR_HEX } from './helpers.ts'

/** Alternating zone shades, so the six 4 × 5 zones read at a glance (R-BOARD-02). */
const ZONE_SHADE = ['', 'bg-neutral-900', 'bg-neutral-800/70', 'bg-neutral-900', 'bg-neutral-800/70', 'bg-neutral-900', 'bg-neutral-800/70']

/**
 * The 12 × 10 grid. While the viewer must place, the boxes of the rolled
 * zone where `placeColour` may legally go are ringed and clickable; hovering
 * one says how big the group would be and what it would eliminate.
 */
export function Board({
  game,
  placeColour,
  legalCells,
  disabled,
  onPlace,
}: {
  game: GameData
  placeColour: Colour | null
  legalCells: Set<number>
  disabled: boolean
  onPlace: (cell: number) => void
}) {
  const last = game.lastPlacement
  return (
    <div className="overflow-x-auto">
      <div className="grid w-max gap-px rounded-md border border-neutral-700 bg-neutral-700 p-px" style={{ gridTemplateColumns: `repeat(${COLS}, 2.25rem)` }}>
        {Array.from({ length: ROWS * COLS }, (_, cell) => {
          const colour = game.board[cell]
          const zone = zoneOf(cell)
          const legal = placeColour !== null && legalCells.has(cell)
          const preview = legal ? previewPlacement(game.board, cell, placeColour) : null
          const title = preview
            ? `${cellLabel(cell)} · zone ${zone} · group of ${preview.groupSize}${preview.eliminated.length ? ` · eliminates ${preview.eliminated.length}` : ''}`
            : `${cellLabel(cell)} · zone ${zone}${colour ? ` · ${colour}` : ''}`
          return (
            <button
              key={cell}
              type="button"
              title={title}
              aria-label={title}
              disabled={!legal || disabled}
              onClick={() => onPlace(cell)}
              className={`relative flex h-9 w-9 items-center justify-center text-[10px] ${ZONE_SHADE[zone]} ${
                legal ? 'cursor-pointer ring-2 ring-inset ring-indigo-400 hover:bg-indigo-900/60' : 'cursor-default'
              }`}
            >
              {colour ? (
                <span
                  className={`h-6 w-6 rounded-full border border-black/40 ${last?.cell === cell ? 'ring-2 ring-white' : ''}`}
                  style={{ backgroundColor: COLOUR_HEX[colour] }}
                />
              ) : (
                (cell % COLS) % 4 === 0 && Math.floor(cell / COLS) % 5 === 0 && <span className="text-neutral-600">{zone}</span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

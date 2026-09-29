// The React half of Rise & Fall's saved-map asset kind (../savedMap.ts): a
// preview for pickers and the asset library, and the map builder — the
// standalone app's MapBuilderPage, now an asset editor the platform mounts.
//
// Building runs the real board-setup engine locally, exactly like the start of
// a game (beginBoardSetup, then PLACE_TILE through the engine's own
// applyAction and the same BoardSetupView a game uses), for placeholder seats
// that exist only in this browser tab: the builder places every tile, whoever
// is nominally up. Once the last tile is down the finished terrain is handed
// to the platform (`onChange`), which saves it.

import { useMemo, useState } from 'react'
import type { AssetEditorProps, AssetPreviewProps, SeatInfo } from '@game-platform/sdk/ui'
import { resolveBoardGenerationContent } from '../content/resolveContent.ts'
import { applyAction } from '../engine/applyAction.ts'
import { createEmptyBoard } from '../engine/board.ts'
import { beginBoardSetup, currentTilePlacerId } from '../engine/boardSetup.ts'
import { createNewGame } from '../engine/createGame.ts'
import type { Coordinate, GameState as EngineState } from '../engine/types.ts'
import { normalizeSavedMap, type SavedMap } from '../savedMap.ts'
import { BoardSetupView } from './BoardSetupView.tsx'
import { HexBoard } from './HexBoard.tsx'

const PLAYER_COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7', '#f97316', '#06b6d4', '#ec4899']
const MIN_PLAYERS = 2
const MAX_PLAYERS = 8

function builderSeats(count: number): SeatInfo[] {
  return Array.from({ length: count }, (_, i) => ({ id: `builder-${i}`, display_name: `Player ${i + 1}`, color: PLAYER_COLORS[i % PLAYER_COLORS.length] }))
}

export function SavedMapPreview({ data }: AssetPreviewProps<SavedMap>) {
  return (
    <div className="flex flex-col gap-1">
      <div className="max-h-64 overflow-hidden">
        <HexBoard board={data.board} />
      </div>
      <p className="text-xs text-neutral-400">
        For {data.playerCount} players · {Object.keys(data.board.tiles).length} hexes
      </p>
    </div>
  )
}

export function SavedMapEditor({ value, onChange, disabled }: AssetEditorProps<SavedMap>) {
  const [playerCount, setPlayerCount] = useState(value?.playerCount ?? 2)
  const [building, setBuilding] = useState<EngineState | null>(null)
  const seats = useMemo(() => builderSeats(playerCount), [playerCount])
  const content = useMemo(() => resolveBoardGenerationContent(playerCount), [playerCount])

  function start() {
    const lobby = createNewGame({
      gameId: 'map-builder',
      playMode: 'hotseat',
      board: createEmptyBoard('hex'),
      players: seats.map((seat) => ({ id: seat.id, authUserId: null, displayName: seat.display_name, color: seat.color })),
    })
    setBuilding(beginBoardSetup(lobby, content))
  }

  function placeTile(state: EngineState, anchor: Coordinate, rotationSteps: number) {
    const placerId = currentTilePlacerId(state)
    if (!placerId) return
    const result = applyAction(state, { type: 'PLACE_TILE', playerId: placerId, anchor, rotationSteps }, undefined, undefined, content)
    if (!result.ok) return
    const next = result.state
    if (next.boardSetup && next.boardSetup.tileTierQueue.length > 0) {
      setBuilding(next)
      return
    }
    setBuilding(null)
    const map = normalizeSavedMap({ playerCount, board: next.board })
    if (map) onChange(map)
  }

  if (building) {
    return (
      <div className="flex flex-col gap-3">
        <BoardSetupView
          state={building}
          players={seats}
          myPlayerId={currentTilePlacerId(building)}
          boardGenerationContent={content}
          onPlaceTile={(anchor, rotationSteps) => placeTile(building, anchor, rotationSteps)}
          onPlaceUnit={() => {}}
          submitting={disabled}
        />
        <button type="button" onClick={() => setBuilding(null)} className="self-start text-sm underline hover:text-neutral-200">
          Stop building
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {value && <SavedMapPreview data={value} />}
      <p className="text-sm text-neutral-400">
        Place tiles exactly as at the start of a game, for the player count you choose. A game started from this map skips tile placement.
      </p>
      <div className="flex items-end gap-3">
        <label className="flex flex-col gap-1 text-sm text-neutral-400">
          Players
          <select
            value={playerCount}
            disabled={disabled}
            onChange={(e) => setPlayerCount(Number(e.target.value))}
            className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-neutral-100"
          >
            {Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, i) => MIN_PLAYERS + i).map((count) => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={start}
          disabled={disabled}
          className="rounded-md bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {value ? 'Build a new map' : 'Start building'}
        </button>
      </div>
    </div>
  )
}

// Chooses which assets a room starts from (games.assets, src/lib/roomAssets.ts)
// — one row per asset kind the game declares (GameDefinition.assetKinds):
// none (the game sets itself up as usual), a specific asset from the
// library, or one picked at random at Start from the public ones that fit the
// number of players. Used on the create-game screen and in the lobby's
// config editor.
//
// Choosing a specific asset copies its payload into the room right away —
// that copy, not the library entry, is what the game starts from — so
// editing or deleting the asset afterwards doesn't touch the room.

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { AnyGameDefinition } from '@game-platform/sdk'
import type { AnyGameUi } from '@game-platform/sdk/ui'
import { listGameAssets } from '../lib/gameApi'
import type { GameAssetRow } from '../lib/dbTypes'
import type { RoomAssets } from '../lib/roomAssets'

export function RoomAssetPicker(props: {
  definition: AnyGameDefinition
  ui: AnyGameUi | null
  value: RoomAssets
  onChange: (value: RoomAssets) => void
  /** The room's player-count bounds — assets outside them are listed but marked. */
  minPlayers: number
  maxPlayers: number
  disabled?: boolean
}) {
  const kinds = Object.entries(props.definition.assetKinds ?? {})
  if (kinds.length === 0) return null
  return (
    <div className="flex flex-col gap-3">
      {kinds.map(([kind, assetKind]) => (
        <KindPicker key={kind} kind={kind} label={assetKind.label} description={assetKind.description} {...props} />
      ))}
    </div>
  )
}

function KindPicker(props: {
  kind: string
  label: string
  description?: string
  definition: AnyGameDefinition
  ui: AnyGameUi | null
  value: RoomAssets
  onChange: (value: RoomAssets) => void
  minPlayers: number
  maxPlayers: number
  disabled?: boolean
}) {
  const { kind, definition } = props
  const [assets, setAssets] = useState<GameAssetRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    listGameAssets({ gameType: definition.id, kind })
      .then((rows) => {
        if (!cancelled) setAssets(rows)
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load')
      })
    return () => {
      cancelled = true
    }
  }, [definition.id, kind])

  const current = props.value[kind]
  const selectValue = !current ? '' : current.mode === 'random' ? '__random' : (current.assetId ?? '__copied')
  const Preview = props.ui?.assetKinds?.[kind]?.Preview
  const label = props.label.toLowerCase()

  function choose(selected: string) {
    const next = { ...props.value }
    if (selected === '') delete next[kind]
    else if (selected === '__random') next[kind] = { mode: 'random' }
    else {
      const asset = assets?.find((a) => a.id === selected)
      if (!asset) return
      next[kind] = { mode: 'chosen', assetId: asset.id, name: asset.name, data: asset.data }
    }
    props.onChange(next)
  }

  const fits = (asset: GameAssetRow) => asset.max_players >= props.minPlayers && asset.min_players <= props.maxPlayers

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-sm text-neutral-400">
        {props.label}
        <select
          value={selectValue}
          disabled={props.disabled || assets === null}
          onChange={(e) => choose(e.target.value)}
          className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-neutral-100"
        >
          <option value="">None — the game sets up as usual</option>
          <option value="__random">A random saved {label} (picked when the game starts)</option>
          {selectValue === '__copied' && <option value="__copied">{current?.name ?? `Copied ${label}`}</option>}
          {current?.mode === 'chosen' && current.assetId && !assets?.some((a) => a.id === current.assetId) && (
            <option value={current.assetId}>{current.name ?? `Saved ${label}`} (no longer in the library)</option>
          )}
          {(assets ?? []).map((asset) => (
            <option key={asset.id} value={asset.id}>
              {asset.name} · {asset.min_players === asset.max_players ? asset.min_players : `${asset.min_players}–${asset.max_players}`} players
              {asset.visibility === 'private' ? ' · yours' : ''}
              {fits(asset) ? '' : ' · doesn’t fit this room'}
            </option>
          ))}
        </select>
      </label>
      {props.description && <p className="text-xs text-neutral-500">{props.description}</p>}
      {current?.mode === 'random' && (
        <p className="text-xs text-neutral-500">
          Picked from the public {label}s for the number of players seated when the game starts. If none fits, the game sets up as usual.
        </p>
      )}
      {current?.mode === 'chosen' && current.data !== undefined && Preview && <Preview data={definition.assetKinds?.[kind]?.normalize(current.data) ?? current.data} />}
      {loadError && <p className="text-xs text-red-400">Couldn’t load saved {label}s: {loadError}</p>}
      <Link to={`/assets/${definition.id}/${kind}`} className="self-start text-xs text-indigo-400 hover:text-indigo-300">
        Manage saved {label}s
      </Link>
    </div>
  )
}


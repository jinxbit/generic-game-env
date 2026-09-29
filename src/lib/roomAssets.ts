// The assets a room is set up with (games.assets — see
// supabase/migrations/0003_game_assets.sql): what genesis reads from them,
// and how a "random <kind>" choice is resolved at Start.
//
// A room's asset is a COPY of the chosen asset's payload, never a reference:
// genesis (./gameGenesis.ts) must stay a function of the room's own row, so
// editing or deleting the asset later can't change a game already set up. A
// random choice holds no payload until Start picks one from the public
// assets that fit the seated player count and copies it in — on the server
// for a rule-enforced game (start-game, from the game's secret seed, so the
// pick is fair and nobody sees the map before the game begins), in the
// owner's browser for a client-trusted one. Either way the pick is written
// back to the row before genesis is built from it, so every later rebuild
// (undo, redo, a cold read) finds the same payload there.
//
// Pure: the callers fetch the candidates. Server-reachable (start-game
// imports it), so relative imports carry `.ts` extensions.

import { randomFrom, type AnyGameDefinition, type Uint32Source } from '@game-platform/sdk'

/** One kind's entry in games.assets. */
export interface RoomAsset {
  /** 'chosen': a specific asset picked in the lobby. 'random': one of the public assets that fit, picked at Start. */
  mode: 'chosen' | 'random'
  /** The asset it was copied from — for display only; null for a payload with no library entry (an imported game's). */
  assetId?: string | null
  name?: string
  /** The copied payload. Absent for a random choice Start hasn't resolved (or found nothing for). */
  data?: unknown
}

/** games.assets, keyed by asset kind (GameDefinition.assetKinds). */
export type RoomAssets = Record<string, RoomAsset>

/** A public asset a random choice may land on — the columns start needs. */
export interface AssetCandidate {
  id: string
  name: string
  data: unknown
}

/** The payloads genesis starts from, by kind — every entry that holds one (createNewGame normalizes them). */
export function roomAssetPayloads(assets: RoomAssets | null | undefined): Record<string, unknown> {
  const payloads: Record<string, unknown> = {}
  for (const [kind, asset] of Object.entries(assets ?? {})) {
    if (asset && asset.data !== undefined && asset.data !== null) payloads[kind] = asset.data
  }
  return payloads
}

/** The kinds whose random choice still needs picking. */
export function unresolvedRandomKinds(assets: RoomAssets | null | undefined): string[] {
  return Object.entries(assets ?? {})
    .filter(([, asset]) => asset?.mode === 'random' && (asset.data === undefined || asset.data === null))
    .map(([kind]) => kind)
}

/** What the game's options editor is told (GameOptionsEditorProps.assets). */
export function roomAssetModes(assets: RoomAssets | null | undefined): Record<string, 'chosen' | 'random'> {
  return Object.fromEntries(Object.entries(assets ?? {}).map(([kind, asset]) => [kind, asset.mode]))
}

/**
 * `assets` with every unresolved random choice picked from its candidates:
 * only payloads the game accepts (AssetKind.normalize) for exactly
 * `playerCount` players (AssetKind.playerRange) qualify — the columns the
 * candidates were filtered on are a hint, the game is the authority. Picks in
 * a fixed order (kinds, then candidates by id) so a given source always
 * lands on the same asset. A kind with nothing that qualifies stays
 * unresolved, and the game starts as if no asset were chosen. Returns
 * `assets` itself when nothing changed.
 */
export function resolveRandomAssets(
  definition: AnyGameDefinition,
  assets: RoomAssets | null | undefined,
  candidatesByKind: Record<string, AssetCandidate[]>,
  playerCount: number,
  source: Uint32Source,
): RoomAssets {
  const current = assets ?? {}
  const kinds = unresolvedRandomKinds(current).sort()
  if (kinds.length === 0) return current
  const random = randomFrom(source)
  let next = current
  for (const kind of kinds) {
    const assetKind = definition.assetKinds?.[kind]
    if (!assetKind) continue
    const qualifying = [...(candidatesByKind[kind] ?? [])]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .flatMap((candidate) => {
        const data = assetKind.normalize(candidate.data)
        if (data === null || data === undefined) return []
        const range = assetKind.playerRange(data)
        return playerCount >= range.min && playerCount <= range.max ? [{ ...candidate, data }] : []
      })
    if (qualifying.length === 0) continue
    const pick = random.pick(qualifying)
    next = { ...next, [kind]: { mode: 'random', assetId: pick.id, name: pick.name, data: pick.data } }
  }
  return next
}

/** A one-line summary of a room's assets, for the lobby header — e.g. "Map: Archipelago". */
export function describeRoomAssets(definition: AnyGameDefinition, assets: RoomAssets | undefined): string | null {
  const parts = Object.entries(assets ?? {}).flatMap(([kind, asset]) => {
    const label = definition.assetKinds?.[kind]?.label
    if (!label) return []
    return [`${label}: ${asset.mode === 'random' ? (asset.data !== undefined ? `${asset.name ?? 'random'} (random)` : 'random saved one') : (asset.name ?? 'saved')}`]
  })
  return parts.length > 0 ? parts.join(' · ') : null
}

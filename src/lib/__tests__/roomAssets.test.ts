import { describe, expect, it } from 'vitest'
import { getGameDefinition, seededSource } from '@game-platform/sdk'
import { roomAssetPayloads, roomAssetModes, resolveRandomAssets, unresolvedRandomKinds, describeRoomAssets, type AssetCandidate } from '../roomAssets'

// Rise & Fall's saved maps are the one asset kind a registered game has.
const riseAndFall = getGameDefinition('rise-and-fall')
const tiles = { '0,0': { id: '0,0', coord: { q: 0, r: 0 }, terrain: 'water', occupantIds: [] } }
const mapFor = (playerCount: number) => ({ playerCount, board: { shape: 'hex', tiles } })

describe('room assets', () => {
  it('reads payloads and modes off a room', () => {
    const assets = { map: { mode: 'chosen' as const, assetId: 'a', name: 'Isles', data: mapFor(2) }, other: { mode: 'random' as const } }
    expect(roomAssetPayloads(assets)).toEqual({ map: mapFor(2) })
    expect(roomAssetPayloads(undefined)).toEqual({})
    expect(roomAssetModes(assets)).toEqual({ map: 'chosen', other: 'random' })
    expect(unresolvedRandomKinds(assets)).toEqual(['other'])
    expect(describeRoomAssets(riseAndFall, assets)).toBe('Map: Isles')
    expect(describeRoomAssets(riseAndFall, { map: { mode: 'random' } })).toBe('Map: random saved one')
  })

  it('picks a random choice only from payloads the game accepts for the seated count, deterministically', () => {
    const candidates: AssetCandidate[] = [
      { id: 'c', name: 'Three', data: mapFor(3) },
      { id: 'b', name: 'Junk', data: { playerCount: 2, board: 'nope' } },
      { id: 'a', name: 'Two A', data: mapFor(2) },
      { id: 'd', name: 'Two D', data: mapFor(2) },
    ]
    const room = { map: { mode: 'random' as const } }
    const picks = new Set<string>()
    for (let seed = 0; seed < 40; seed++) {
      const resolved = resolveRandomAssets(riseAndFall, room, { map: candidates }, 2, seededSource(`s${seed}`, 'assets'))
      expect(resolved.map.mode).toBe('random')
      picks.add(resolved.map.name!)
      // Same seed, candidates in another order: same pick.
      expect(resolveRandomAssets(riseAndFall, room, { map: [...candidates].reverse() }, 2, seededSource(`s${seed}`, 'assets'))).toEqual(resolved)
    }
    expect([...picks].sort()).toEqual(['Two A', 'Two D'])
  })

  it('leaves a choice unresolved when nothing fits, and a room with nothing to resolve untouched', () => {
    const room = { map: { mode: 'random' as const } }
    expect(resolveRandomAssets(riseAndFall, room, { map: [{ id: 'x', name: 'Three', data: mapFor(3) }] }, 2, seededSource('s', 'assets'))).toBe(room)
    const chosen = { map: { mode: 'chosen' as const, assetId: 'a', name: 'Isles', data: mapFor(2) } }
    expect(resolveRandomAssets(riseAndFall, chosen, {}, 2, seededSource('s', 'assets'))).toBe(chosen)
  })
})

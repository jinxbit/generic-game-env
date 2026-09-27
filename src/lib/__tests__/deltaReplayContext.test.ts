// Pins the claim the cold-open fix rests on: a cached GameState carries
// everything needed to rebuild genesis, so the replay context can be
// reconstructed without waiting for `listPlayers`.
//
// The real assertion is the first one — genesis rebuilt from the state must
// equal genesis built from the players table. If `buildGenesisState` ever
// starts reading a column that only exists on a PlayerRow, this fails rather
// than silently producing a genesis that replays to the wrong state and turns
// every cold open into a hash mismatch.
import { describe, expect, it } from 'vitest'
import { act, pickAll } from '../../engine/__tests__/helpers'
import { replayActions } from '../../engine/replay'
import { buildDeltaReplayContextFromState } from '../deltaReplayContext'
import { buildGenesisState } from '../gameGenesis'
import type { GameRow, PlayerRow } from '../dbTypes'

const game: GameRow = {
  id: 'game_1',
  room_code: 'ABCDE',
  name: 'Test room',
  play_mode: 'async',
  status: 'active',
  min_players: 2,
  max_players: 4,
  created_by: 'auth_1',
  created_at: '',
  updated_at: '',
  settings: { skipHotseatPassGate: false, ruleEnforcementEnabled: true, hiddenInformationEnabled: true, gameOptions: { targetScore: 8, maxRounds: 6 } },
  config_version: 0,
  visibility: 'private',
}

const players: PlayerRow[] = [
  { id: 'p1', game_id: 'game_1', user_id: 'auth_1', display_name: 'Alice', avatar_url: null, seat_index: 0, color: '#ef4444', is_active: true, joined_at: '', ready_for_version: 0 },
  { id: 'p2', game_id: 'game_1', user_id: 'auth_2', display_name: 'Bob', avatar_url: null, seat_index: 1, color: '#3b82f6', is_active: true, joined_at: '', ready_for_version: 0 },
  { id: 'p3', game_id: 'game_1', user_id: 'auth_3', display_name: 'Carol', avatar_url: null, seat_index: 2, color: '#22c55e', is_active: true, joined_at: '', ready_for_version: 0 },
]

/** A cached state a cold open would actually have on disk: a couple of rounds in, with a concede. */
function playedState() {
  let state = buildGenesisState(game, players)
  state = pickAll(state, { p1: 1, p2: 2, p3: 2 })
  state = act(state, { type: 'CONCEDE', playerId: 'p2' })
  return pickAll(state, { p1: 3, p3: 4 })
}

describe('buildDeltaReplayContextFromState', () => {
  it('rebuilds the same genesis the players table would have produced', () => {
    const context = buildDeltaReplayContextFromState(game, playedState())
    expect(context).not.toBeNull()
    expect(context!.genesis).toEqual(buildGenesisState(game, players))
  })

  it('gives a genesis that replays the cached log back to the cached state', () => {
    const state = playedState()
    const context = buildDeltaReplayContextFromState(game, state)!
    expect(replayActions(context.genesis, state.actionHistory)).toEqual(state)
  })

  it('returns null rather than throwing for a state with no players', () => {
    expect(buildDeltaReplayContextFromState(game, { ...playedState(), players: [] })).toBeNull()
  })
})

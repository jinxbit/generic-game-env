// @vitest-environment node
//
// Pins who the turn pings (notify-discord-turn, notify-web-push) decide to
// notify, against the engine's own answer, on the rows a Database Webhook
// actually delivers.
//
// The functions can't see a full GameState: a webhook's `record`/
// `old_record` carry the stored `game_state` row, and a rule-enforced game
// stores its state gzipped with only a few fields in plaintext
// (src/lib/gameStateCompression.ts). So the sweep below plays a whole game
// through the engine, stores every state both ways (compressed, as the Edge
// Functions write it, and plain, as a client-trusted game's direct write
// does), round-trips each row through JSON as the webhook does, and requires
// ../../../supabase/functions/_shared/turnNotify.ts to name exactly the
// players the engine's pendingActorIds() newly owes a turn.

import { describe, expect, it } from 'vitest'
import { applyAction, createNewGame, applyRedoAction, applyUndoAction, pendingActorIds as enginePendingActorIds, type Action, type ActionResult, type GameState } from '@game-platform/sdk'
import { gameDefinition } from '@game-platform/unique-pick/rules'
import { compressGameStateForStorage } from '../../lib/gameStateCompression.ts'
import { type GameStateRow, justFinished, newlyPendingActorIds, phaseLabel, turnNumber } from '../../../supabase/functions/_shared/turnNotify.ts'
import { pickAction } from '../supabaseStack/sampleGame.ts'

const GAME_TYPE = gameDefinition.id

type Encoding = 'compressed' | 'plain'

const GAME_ID = 'game-1'

/** The row as the webhook delivers it: the stored `state` plus the `active_player_id` column both write paths set. */
async function webhookRow(state: GameState, encoding: Encoding): Promise<GameStateRow> {
  const stored = encoding === 'compressed' ? await compressGameStateForStorage(state) : state
  return JSON.parse(JSON.stringify({ game_id: GAME_ID, state: stored, active_player_id: state.activePlayerId })) as GameStateRow
}

/** What the engine says a write from `before` to `after` newly owes — the answer the functions have to reproduce. */
function engineNewlyPending(before: GameState, after: GameState): string[] {
  const wasPending = new Set(enginePendingActorIds(before))
  return enginePendingActorIds(after).filter((id) => !wasPending.has(id))
}

/**
 * A whole game, one state per submitted action: picks (including a changed
 * pick and a collision), an undo and redo, a concede mid-round, and play on
 * until the game completes. Whatever the example game's rules, the sweep
 * only relies on the framework contract (pendingPlayerIds, status).
 */
function playGame(): GameState[] {
  const genesis = createNewGame({
    gameId: GAME_ID,
    gameType: GAME_TYPE,
    playMode: 'async',
    players: ['a', 'b', 'c'].map((id) => ({ id, authUserId: `user-${id}`, displayName: id.toUpperCase(), color: 'red' })),
    options: { targetScore: 5, maxRounds: 30 },
  })
  let state = genesis
  const states = [state]
  const submit = (action: Action) => {
    let result: ActionResult
    if (action.type === 'UNDO_ACTION') result = applyUndoAction(genesis, state, action.playerId)
    else if (action.type === 'REDO_ACTION') result = applyRedoAction(genesis, state, action.playerId)
    else result = applyAction(state, action)
    if (!result.ok) throw new Error(`${action.type} rejected: ${result.error}`)
    state = result.state
    states.push(state)
  }

  submit(pickAction('a', 1))
  submit(pickAction('a', 2))
  submit({ type: 'UNDO_ACTION', playerId: 'a' })
  submit({ type: 'REDO_ACTION', playerId: 'a' })
  submit(pickAction('b', 2))
  submit(pickAction('c', 1))
  submit(pickAction('b', 1))
  submit({ type: 'CONCEDE', playerId: 'c' })
  let value = 1
  while (state.status === 'active') {
    const next = state.pendingPlayerIds[0]
    submit(pickAction(next, next === 'a' ? 1 : 1 + (value++ % 4)))
  }
  return states
}

const states = playGame()

describe('turn-ping decision (supabase/functions/_shared/turnNotify.ts)', () => {
  it('sweeps a game that starts, hands turns around and finishes', () => {
    expect(states[0].status).toBe('active')
    expect(states.at(-1)!.status).toBe('completed')
  })

  it.each<Encoding>(['compressed', 'plain'])('pings exactly the players the engine newly owes a turn, from a %s row', async (encoding) => {
    let pings = 0
    for (let i = 1; i < states.length; i++) {
      const before = states[i - 1]
      const after = states[i]
      const oldRow = await webhookRow(before, encoding)
      const newRow = await webhookRow(after, encoding)
      const where = `state #${i} (${after.actionHistory.at(-1)?.action.type}, ${after.status}/${after.phase})`

      const expected = engineNewlyPending(before, after)
      expect(newlyPendingActorIds(oldRow, newRow), where).toEqual(expected)
      expect(justFinished(oldRow.state, newRow.state), where).toBe(before.status !== 'completed' && after.status === 'completed')
      pings += expected.length
    }
    // The sweep has to actually hand turns out, or the equality above proves nothing.
    expect(pings).toBeGreaterThan(0)
  })

  it('labels the phase and turn the same from a compressed row as from the full state', async () => {
    for (const state of states) {
      const compressed = await webhookRow(state, 'compressed')
      const plain = await webhookRow(state, 'plain')
      expect(phaseLabel(compressed.state, GAME_TYPE)).toBe(phaseLabel(plain.state, GAME_TYPE))
      expect(turnNumber(compressed.state)).toBe(turnNumber(plain.state))
      if (state.status === 'active' && state.phase) {
        expect(phaseLabel(compressed.state, GAME_TYPE)).toBe(gameDefinition.describePhase(state.phase))
        expect(turnNumber(compressed.state)).toBe(state.turn)
      } else {
        expect(phaseLabel(compressed.state, GAME_TYPE)).toBe(null)
      }
    }
  })

  it('labels no phase for a game this deployment has not registered, rather than throwing', async () => {
    const active = states.find((state) => state.status === 'active' && state.phase)!
    expect(phaseLabel((await webhookRow(active, 'compressed')).state, 'no-such-game')).toBe(null)
  })

  describe('rows built by hand', () => {
    const active = {
      __gz: 'irrelevant',
      status: 'active',
      phase: 'pick',
      turn: 3,
      activePlayerId: null,
      pendingPlayerIds: ['a', 'b'],
      turnOrder: ['a', 'b', 'c'],
    }
    const row = (state: object) => ({ game_id: 'g', state, active_player_id: null }) as unknown as GameStateRow

    it('pings everyone pending when a game becomes active', () => {
      expect(newlyPendingActorIds(row({ ...active, status: 'lobby', pendingPlayerIds: [] }), row(active))).toEqual(['a', 'b'])
    })

    it('does not re-ping a player who was already pending', () => {
      expect(newlyPendingActorIds(row({ ...active, pendingPlayerIds: ['a'] }), row(active))).toEqual(['b'])
      expect(newlyPendingActorIds(row(active), row({ ...active, pendingPlayerIds: ['b'] }))).toEqual([])
    })

    it('owes nobody a turn outside an active game, whatever pendingPlayerIds says', () => {
      expect(newlyPendingActorIds(row({ ...active, pendingPlayerIds: [] }), row({ ...active, status: 'completed' }))).toEqual([])
    })

    it('treats a move to completed as the game finishing', () => {
      expect(justFinished(row(active).state, row({ ...active, status: 'completed' }).state)).toBe(true)
      expect(justFinished(row({ ...active, status: 'completed' }).state, row({ ...active, status: 'completed' }).state)).toBe(false)
    })
  })
})

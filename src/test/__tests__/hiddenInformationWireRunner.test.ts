// @vitest-environment node
//
// Runs the hidden-information wire check (../productionSmoke/
// hiddenInformationWire.ts) against the in-process stack instead of a real
// project — same reasoning as productionSmokeRunner.test.ts: a mistake in the
// check's own provisioning or assertions is better caught here, on every PR,
// than at 3am against Preview.
//
// Realtime is left off (`includeRealtime: false`): the in-process stack
// (../supabaseStack/) patches only `fetch`, not WebSocket, so there is no
// double for a Realtime subscription to connect to here. That half only
// ever runs against a live project — see
// ../productionSmoke/hiddenInformationWire.smoke.ts.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProductionStack, type ProductionStack } from '../supabaseStack/index.ts'
import { buildHiddenInformationFixture, checkHiddenInformationWire } from '../productionSmoke/hiddenInformationWire.ts'
import { gameData } from '../supabaseStack/sampleGame.ts'

describe('hidden-information wire check runner', () => {
  let stack: ProductionStack

  beforeEach(async () => {
    stack = await createProductionStack()
  })
  afterEach(() => {
    stack.dispose()
  })

  function config() {
    return { url: stack.url, anonKey: stack.anonKey, serviceRoleKey: stack.serviceRoleKey }
  }

  it('builds a fixture that ends mid-round, with revealed history behind it and one secret pick in flight', () => {
    const fixture = buildHiddenInformationFixture()
    expect(fixture.game.settings).toMatchObject({ ruleEnforcementEnabled: true, hiddenInformationEnabled: true })
    expect(fixture.finalState).toMatchObject({ status: 'active', turn: 2 })
    expect(gameData(fixture.finalState).rounds).toHaveLength(1)
    expect(fixture.finalState.pendingPlayerIds).toHaveLength(2)
    expect(fixture.finalState.actionHistory.at(-1)?.action.type).toBe('PICK_NUMBER')
  })

  it('proves no secret crosses the wire while a round is open, and that it is revealed once resolved', async () => {
    const report = await checkHiddenInformationWire(config(), { includeRealtime: false })
    expect(report.gameId).toBeTruthy()
    expect(report.realtimeChecked).toBe(false)
  }, 60_000)

  it('leaves nothing behind', async () => {
    await checkHiddenInformationWire(config(), { includeRealtime: false })
    expect(stack.db.table('games')).toEqual([])
    expect(stack.db.table('players')).toEqual([])
    expect(stack.db.table('game_state')).toEqual([])
    expect(stack.db.table('game_state_meta')).toEqual([])
  }, 60_000)
})

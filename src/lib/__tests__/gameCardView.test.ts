import { describe, expect, it } from 'vitest'
import { buildGameCardSummary, describeGamePhase, formatFinishedAt, formatUpdatedAt, isMyTurnFor, latestUpdatedAt, pendingActorIdsFor, type GameStateSummary } from '../gameCardView'
import { describeGameOptions, TURN_LABEL } from '../../game/display'
import { gameDefinition, PICK_PHASE } from '../../game/rules'
import type { GameRow, GameSettings } from '../dbTypes'

function makeSettings(overrides: Partial<GameSettings> = {}): GameSettings {
  return {
    skipHotseatPassGate: false,
    ruleEnforcementEnabled: false,
    hiddenInformationEnabled: false,
    ...overrides,
  }
}

function makeGame(overrides: Partial<GameRow> = {}, settingsOverrides: Partial<GameSettings> = {}): GameRow {
  return {
    id: 'game_1',
    room_code: 'ABCDE',
    name: 'Test room',
    play_mode: 'live',
    status: 'lobby',
    min_players: 2,
    max_players: 4,
    created_by: 'auth_1',
    created_at: '',
    updated_at: '2026-01-01T00:00:00Z',
    settings: makeSettings(settingsOverrides),
    config_version: 0,
    visibility: 'private',
    ...overrides,
  }
}

function makeSummary(overrides: Partial<GameStateSummary> = {}): GameStateSummary {
  return { status: 'active', phase: PICK_PHASE, turn: 1, activePlayerId: null, pendingPlayerIds: [], ...overrides }
}

describe('buildGameCardSummary', () => {
  it('shows pregame info (player range, options summary) and no turn label while the game has not started', () => {
    const game = makeGame({ min_players: 2, max_players: 4 }, { gameOptions: { targetScore: 15, maxRounds: 5 } })
    const summary = buildGameCardSummary(game, null)

    expect(summary.playerRange).toBe('2–4 players')
    expect(summary.optionsSummary).toBe(describeGameOptions({ targetScore: 15, maxRounds: 5 }))
    expect(summary.optionsSummary).toBe('First to 15 · max 5 rounds')
    expect(summary.turnLabel).toBeNull()
  })

  it("summarizes the game's default options when settings omit them", () => {
    expect(buildGameCardSummary(makeGame(), null).optionsSummary).toBe(describeGameOptions(undefined))
  })

  it('clears pregame info once a GameStateSummary exists, and reports the turn label instead', () => {
    const summary = buildGameCardSummary(makeGame(), makeSummary({ turn: 3 }))

    expect(summary.playerRange).toBeNull()
    expect(summary.optionsSummary).toBeNull()
    expect(summary.turnLabel).toBe(`${TURN_LABEL} 3`)
  })
})

describe('latestUpdatedAt', () => {
  it("falls back to games.updated_at when there's no game_state row yet (lobby)", () => {
    const game = makeGame({ updated_at: '2026-01-01T00:00:00Z' })
    expect(latestUpdatedAt(game, null)).toBe('2026-01-01T00:00:00Z')
  })

  it('prefers game_state.updated_at once it is more recent — gameplay actions only touch that row, not games.updated_at', () => {
    const game = makeGame({ updated_at: '2026-01-01T00:00:00Z' })
    expect(latestUpdatedAt(game, '2026-01-02T00:00:00Z')).toBe('2026-01-02T00:00:00Z')
  })

  it('falls back to games.updated_at when it is the more recent of the two (e.g. a settings edit right after insertGameState)', () => {
    const game = makeGame({ updated_at: '2026-01-05T00:00:00Z' })
    expect(latestUpdatedAt(game, '2026-01-02T00:00:00Z')).toBe('2026-01-05T00:00:00Z')
  })
})

describe('formatUpdatedAt', () => {
  const now = new Date('2026-01-10T12:00:00Z')

  it.each([
    ['2026-01-10T11:59:50Z', 'Updated just now'],
    ['2026-01-10T11:45:00Z', 'Updated 15m ago'],
    ['2026-01-10T09:00:00Z', 'Updated 3h ago'],
    ['2026-01-08T12:00:00Z', 'Updated 2d ago'],
  ])('labels %s as %s', (iso, label) => {
    expect(formatUpdatedAt(iso, now)).toBe(label)
  })

  it('falls back to a date once more than a week old', () => {
    expect(formatUpdatedAt('2025-12-01T12:00:00Z', now)).toBe(`Updated ${new Date('2025-12-01T12:00:00Z').toLocaleDateString()}`)
  })
})

describe('formatFinishedAt', () => {
  it('renders an absolute local date/time prefixed with "Finished at", without seconds', () => {
    const isoTimestamp = '2026-01-02T09:00:00Z'
    const expected = new Date(isoTimestamp).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
    expect(formatFinishedAt(isoTimestamp)).toBe(`Finished at ${expected}`)
    expect(formatFinishedAt(isoTimestamp)).not.toMatch(/:\d{2}:\d{2}\s/)
  })
})

describe('describeGamePhase', () => {
  it('reports the lobby before a game_state row exists', () => {
    expect(describeGamePhase(makeGame({ status: 'lobby' }), null)).toBe('Waiting in lobby')
  })

  it('reports canceled off games.status even with a live (pre-cancel) summary', () => {
    expect(describeGamePhase(makeGame({ status: 'canceled' }), makeSummary())).toBe('Canceled')
  })

  it('reports finished once the summary status is completed', () => {
    expect(describeGamePhase(makeGame(), makeSummary({ status: 'completed', phase: null }))).toBe('Finished')
  })

  it("uses the game's own label for the current phase while active", () => {
    expect(describeGamePhase(makeGame(), makeSummary({ phase: PICK_PHASE }))).toBe(gameDefinition.describePhase(PICK_PHASE))
    expect(describeGamePhase(makeGame(), makeSummary({ phase: PICK_PHASE }))).toBe('Picking')
  })
})

describe('pendingActorIdsFor', () => {
  it('is empty with no game_state row yet (lobby)', () => {
    expect(pendingActorIdsFor(null)).toEqual([])
  })

  it('returns the single pending player in a sequential phase', () => {
    expect(pendingActorIdsFor(makeSummary({ activePlayerId: 'p2', pendingPlayerIds: ['p2'] }))).toEqual(['p2'])
  })

  it('returns everyone still pending in a simultaneous phase', () => {
    expect(pendingActorIdsFor(makeSummary({ pendingPlayerIds: ['p1', 'p2'] }))).toEqual(['p1', 'p2'])
  })

  it('dedupes repeated ids', () => {
    expect(pendingActorIdsFor(makeSummary({ pendingPlayerIds: ['p1', 'p1', 'p2'] }))).toEqual(['p1', 'p2'])
  })

  it('is empty once the game is completed, even if the summary still lists someone', () => {
    expect(pendingActorIdsFor(makeSummary({ status: 'completed', phase: null, pendingPlayerIds: ['p1'] }))).toEqual([])
  })
})

describe('isMyTurnFor', () => {
  it('is true when one of my seats is pending', () => {
    expect(isMyTurnFor(makeSummary({ pendingPlayerIds: ['p1'] }), ['p1'])).toBe(true)
  })

  it('is false when only a different seat is pending', () => {
    expect(isMyTurnFor(makeSummary({ pendingPlayerIds: ['p2'] }), ['p1'])).toBe(false)
  })

  it('checks every seat I hold, e.g. a hotseat host with several local players', () => {
    expect(isMyTurnFor(makeSummary({ pendingPlayerIds: ['p2'] }), ['p1', 'p2'])).toBe(true)
  })

  it('is false with no game_state row yet (lobby)', () => {
    expect(isMyTurnFor(null, ['p1'])).toBe(false)
  })
})

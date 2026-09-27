// Shared view logic for game overview cards, used by every screen that lists
// games (MyGamesPage.tsx, HomePage.tsx, PublicRoomsPage.tsx) — turn
// highlighting and "time ago" labels live here so each screen computes them
// the same way. myGamesView.ts and publicRoomsView.ts wrap these with their
// own entry types.

import type { GameStatus } from '@game-platform/sdk'
import { findGameDefinition } from '@game-platform/sdk'
import type { GameRow } from './dbTypes'

/**
 * Lightweight, cheap-to-query summary of a game's `game_state` row for
 * listing screens: every field comes from the `game_state_meta` projection
 * (kept in sync by a DB trigger on every `game_state` write) — plain scalar
 * columns, never the compressed `game_state.state` blob, which would have to
 * be downloaded and decompressed for every listed game. `null` means no
 * `game_state` row exists yet (the game is still in the lobby).
 *
 * This intentionally can't answer everything the full `GameState` could
 * (scores, say) — open the game itself for that. Turn highlighting
 * (`pendingActorIdsFor` below) is fully answerable from it.
 */
export interface GameStateSummary {
  status: GameStatus
  phase: string | null
  turn: number
  activePlayerId: string | null
  /** Player ids who may act right now (`GameState.pendingPlayerIds` while active, `[]` otherwise), straight from `game_state_meta.pending_player_ids`. */
  pendingPlayerIds: string[]
}

/**
 * The seated players who must act next, or `[]` if nobody's turn is pending
 * (lobby/completed).
 */
export function pendingActorIdsFor(summary: GameStateSummary | null): string[] {
  if (!summary || summary.status !== 'active') return []
  return [...new Set(summary.pendingPlayerIds)]
}

/** True if any of `myPlayerIds` is one of the players pendingActorIdsFor() says must act next. */
export function isMyTurnFor(summary: GameStateSummary | null, myPlayerIds: string[]): boolean {
  const pending = pendingActorIdsFor(summary)
  return myPlayerIds.some((id) => pending.includes(id))
}

/**
 * Short "time ago" label for a game's games.updated_at. `now` is injectable
 * for tests; defaults to the real current time.
 */
export function formatUpdatedAt(isoTimestamp: string, now: Date = new Date()): string {
  const updated = new Date(isoTimestamp)
  const diffMinutes = Math.round((now.getTime() - updated.getTime()) / 60_000)

  if (diffMinutes < 1) return 'Updated just now'
  if (diffMinutes < 60) return `Updated ${diffMinutes}m ago`
  const diffHours = Math.round(diffMinutes / 60)
  if (diffHours < 24) return `Updated ${diffHours}h ago`
  const diffDays = Math.round(diffHours / 24)
  if (diffDays < 7) return `Updated ${diffDays}d ago`
  return `Updated ${updated.toLocaleDateString()}`
}

/**
 * Absolute "Finished at" label for a completed game — shown instead of the
 * phase + relative "Updated ... ago" pair once a game is done. There's no
 * dedicated `finished_at` column; the game_state row's `updated_at` is the
 * closest proxy, since no further writes happen to it once a game completes.
 */
export function formatFinishedAt(isoTimestamp: string): string {
  return `Finished at ${new Date(isoTimestamp).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`
}

/**
 * The real "last activity" timestamp for a game: `games.updated_at` only
 * changes for lobby-era edits (settings, status, visibility), never for
 * gameplay actions, which only touch the separate `game_state` row (mirrored
 * onto `game_state_meta`). Once a game_state row exists, its `updated_at` is
 * almost always the more recent of the two — this just guards against the
 * rare edge case where `games.updated_at` is newer.
 */
export function latestUpdatedAt(game: GameRow, gameStateUpdatedAt: string | null): string {
  if (!gameStateUpdatedAt) return game.updated_at
  return new Date(gameStateUpdatedAt).getTime() > new Date(game.updated_at).getTime() ? gameStateUpdatedAt : game.updated_at
}

/**
 * What a game card should show in place of a blanket "In progress" — the
 * game's own label for its current phase (GameDefinition.describePhase),
 * read from the cheap `game_state_meta` projection. A game this deployment
 * doesn't have registered degrades to "In progress" rather than failing.
 */
export function describeGamePhase(game: GameRow, summary: GameStateSummary | null): string {
  if (game.status === 'canceled') return 'Canceled'
  if (!summary) return 'Waiting in lobby'
  if (summary.status === 'completed') return 'Finished'
  return findGameDefinition(game.game_type)?.describePhase(summary.phase) ?? 'In progress'
}

/** The game's display name for a room, or its raw id when this deployment doesn't have it registered. */
export function gameTitleFor(game: Pick<GameRow, 'game_type'>): string {
  return findGameDefinition(game.game_type)?.title ?? game.game_type
}

/**
 * Everything GameOverviewCard.tsx shows beyond name/players/phase.
 * `playerRange`/`optionsSummary` are only meaningful pre-game (settings stop
 * being read once a game_state row exists), so both are null once `summary`
 * is non-null. `turnLabel` is the reverse — null until there's a summary to
 * read it from.
 */
export interface GameCardSummary {
  /** Which game the room plays — always shown, since a site can host several. */
  gameTitle: string
  playerRange: string | null
  optionsSummary: string | null
  /** E.g. "Round 3". */
  turnLabel: string | null
}

/**
 * Builds the config summary a game card shows on top of its player list —
 * which fields end up non-null depends entirely on `summary` (see
 * GameCardSummary's doc comment).
 */
export function buildGameCardSummary(game: GameRow, summary: GameStateSummary | null): GameCardSummary {
  // The room's pinned version when it's still registered, else the newest —
  // the same fallback the phase and title labels use, since this is display only.
  const definition = findGameDefinition(game.game_type, game.settings.rulesVersion) ?? findGameDefinition(game.game_type)
  return {
    gameTitle: gameTitleFor(game),
    playerRange: summary ? null : `${game.min_players}–${game.max_players} players`,
    optionsSummary: summary || !definition ? null : definition.describeOptions(definition.normalizeOptions(game.settings.gameOptions)),
    turnLabel: summary ? `${definition?.turnLabel ?? 'Turn'} ${summary.turn}` : null,
  }
}

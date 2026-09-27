// Pure view logic for the Public Rooms screen (PublicRoomsPage.tsx) and
// room visibility. Split out from gameApi.ts's listPublicRooms the same way
// myGamesView.ts is split from listMyGames, so grouping/status classification can be unit tested
// without a real Supabase project.

import type { GameRow, PlayerListRow } from './dbTypes'
import { isMyTurnFor, latestUpdatedAt, pendingActorIdsFor, type GameStateSummary } from './gameCardView'

/**
 * One publicly-listed room, plus everything the list view needs to render
 * it. `stateSummary` is null while the room is still in the lobby, same as
 * MyGameEntry (see myGamesView.ts) — see GameStateSummary's doc comment
 * (gameCardView.ts) for exactly what it can and can't answer compared to the
 * full GameState this used to carry. listPublicRooms() (gameApi.ts) already
 * excludes canceled rooms (canceled and deleted rooms never appear in the
 * listing), so unlike MyGameEntry there's no canceled
 * case to classify here.
 */
export interface PublicRoomEntry {
  game: GameRow
  players: PlayerListRow[]
  stateSummary: GameStateSummary | null
  /** game_state_meta.updated_at (null alongside stateSummary while still in the lobby) — see gameCardView.ts's latestUpdatedAt. */
  gameStateUpdatedAt: string | null
}

/**
 * The three buckets the Public Rooms screen groups by.
 * games.status can't tell "In Progress" from "Finished" apart on its own
 * (see dbTypes.ts's GameRow comment) — that distinction only exists once a
 * game_state row exists, via `stateSummary.status`.
 */
export type PublicRoomBucket = 'notStarted' | 'inProgress' | 'finished'

export function publicRoomBucket(entry: PublicRoomEntry): PublicRoomBucket {
  if (entry.game.status === 'lobby') return 'notStarted'
  return entry.stateSummary?.status === 'completed' ? 'finished' : 'inProgress'
}

/** Joinable: Active and Not Started, with a free seat. */
export function isJoinable(entry: PublicRoomEntry): boolean {
  return publicRoomBucket(entry) === 'notStarted' && entry.players.length < entry.game.max_players
}

/** Observable: Active and In Progress. */
export function isObservable(entry: PublicRoomEntry): boolean {
  return publicRoomBucket(entry) === 'inProgress'
}

/** The seated players who must act next, or `[]` if nobody's turn is pending (lobby/finished) — see pendingActorIdsFor's doc comment for what it can't see. */
export function pendingActorIds(entry: PublicRoomEntry): string[] {
  return pendingActorIdsFor(entry.stateSummary)
}

/** True if any of `userId`'s seats in this room is one of the players pendingActorIds() says must act next. */
export function isMyTurn(entry: PublicRoomEntry, userId: string): boolean {
  const myPlayerIds = entry.players.filter((p) => p.user_id === userId).map((p) => p.id)
  return isMyTurnFor(entry.stateSummary, myPlayerIds)
}

/** True if userId is seated in this room, in any seat. */
export function isMine(entry: PublicRoomEntry, userId: string): boolean {
  return entry.players.some((p) => p.user_id === userId)
}

function byLatestUpdatedAsc(a: PublicRoomEntry, b: PublicRoomEntry): number {
  return (
    new Date(latestUpdatedAt(a.game, a.gameStateUpdatedAt)).getTime() -
    new Date(latestUpdatedAt(b.game, b.gameStateUpdatedAt)).getTime()
  )
}

function byLatestUpdatedDesc(a: PublicRoomEntry, b: PublicRoomEntry): number {
  return -byLatestUpdatedAsc(a, b)
}

/**
 * Orders a bucket of in-progress rooms for a given viewer: rooms where it's `userId`'s turn come first, oldest-updated
 * first (the ones that have been waiting longest for their input), then the
 * rest of the rooms, most-recently-updated first.
 */
export function orderInProgressForUser(entries: PublicRoomEntry[], userId: string): PublicRoomEntry[] {
  const myTurn = entries.filter((entry) => isMyTurn(entry, userId)).sort(byLatestUpdatedAsc)
  const rest = entries.filter((entry) => !isMyTurn(entry, userId)).sort(byLatestUpdatedDesc)
  return [...myTurn, ...rest]
}

/**
 * Orders a bucket of not-yet-started rooms for a given viewer: rooms `userId` is already seated in come first, then every
 * other room — each group most-recently-updated first.
 */
export function orderNotStartedForUser(entries: PublicRoomEntry[], userId: string): PublicRoomEntry[] {
  const mine = entries.filter((entry) => isMine(entry, userId)).sort(byLatestUpdatedDesc)
  const others = entries.filter((entry) => !isMine(entry, userId)).sort(byLatestUpdatedDesc)
  return [...mine, ...others]
}

/**
 * Buckets rooms for display, each most-recently-updated first — matching
 * the order the screen lists the three groups in.
 */
export function groupPublicRooms(
  entries: PublicRoomEntry[],
): { notStarted: PublicRoomEntry[]; inProgress: PublicRoomEntry[]; finished: PublicRoomEntry[] } {
  const notStarted = entries.filter((entry) => publicRoomBucket(entry) === 'notStarted').sort(byLatestUpdatedDesc)
  const inProgress = entries.filter((entry) => publicRoomBucket(entry) === 'inProgress').sort(byLatestUpdatedDesc)
  const finished = entries.filter((entry) => publicRoomBucket(entry) === 'finished').sort(byLatestUpdatedDesc)

  return { notStarted, inProgress, finished }
}

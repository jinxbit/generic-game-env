import type { GameState } from '../engine/types'
import type { PlayerRow } from '../lib/dbTypes'
import { MAX_PICK } from './rules'
import type { GameAction } from './types'

/**
 * What the platform (GamePage.tsx) hands the game's own view. The contract a
 * replacement game's view must accept — everything else about how it looks
 * is up to the game.
 */
export interface GameViewProps {
  /** The state to render: live, or a past point while the viewer is reviewing history. */
  state: GameState
  /** Seated players' rows, for display names and colours. */
  players: PlayerRow[]
  /**
   * Which seat this browser acts for, or null to render read-only (a
   * spectator, someone reviewing history, or waiting on the hotseat hand-off).
   * In hotseat and admin mode this follows whoever must act next, not the
   * signed-in account.
   */
  myPlayerId: string | null
  /** True while a submitted action is in flight — disable inputs. */
  submitting: boolean
  /** Submit one game action. The platform routes it to the right write path and shows any rejection. */
  onAction: (action: GameAction) => void
}

function nameOf(players: PlayerRow[], id: string): string {
  return players.find((p) => p.id === id)?.display_name ?? 'Unknown'
}

function colorOf(players: PlayerRow[], id: string): string {
  return players.find((p) => p.id === id)?.color ?? '#737373'
}

/** The example game's board: a number picker, a scoreboard and the last reveal. */
export function GameView({ state, players, myPlayerId, submitting, onAction }: GameViewProps) {
  const { game, options } = state
  const lastRound = game.rounds[game.rounds.length - 1] ?? null
  const myPick = myPlayerId ? game.picks[myPlayerId] : null
  const canPick = state.status === 'active' && myPlayerId !== null && !state.players.find((p) => p.id === myPlayerId)?.eliminated
  const ranked = [...state.players].sort((a, b) => (game.scores[b.id] ?? 0) - (game.scores[a.id] ?? 0))

  return (
    <div className="flex flex-col gap-6">
      {state.status === 'active' && (
        <section className="flex flex-col gap-3 rounded-md border border-neutral-800 p-4">
          <h2 className="font-medium">
            Round {state.turn} of {options.maxRounds} · first to {options.targetScore} wins
          </h2>
          {canPick ? (
            <>
              <p className="text-sm text-neutral-400">
                Pick a number. If nobody else picks the same one, you score it.
                {typeof myPick === 'number' && ' You can change your pick until everyone has picked.'}
              </p>
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: MAX_PICK }, (_, i) => i + 1).map((value) => (
                  <button
                    key={value}
                    type="button"
                    disabled={submitting || myPick === value}
                    onClick={() => myPlayerId && onAction({ type: 'PICK_NUMBER', playerId: myPlayerId, value })}
                    className={`h-12 w-12 rounded-md border text-lg font-semibold disabled:opacity-60 ${
                      myPick === value ? 'border-indigo-400 bg-indigo-600 text-white' : 'border-neutral-700 hover:border-indigo-400'
                    }`}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-neutral-400">Watching.</p>
          )}
          <ul className="flex flex-wrap gap-3 text-sm">
            {state.players
              .filter((p) => !p.eliminated)
              .map((p) => {
                const picked = !state.pendingPlayerIds.includes(p.id)
                return (
                  <li key={p.id} className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: colorOf(players, p.id) }} />
                    {nameOf(players, p.id)}: <span className={picked ? 'text-emerald-400' : 'text-neutral-500'}>{picked ? 'picked' : 'thinking…'}</span>
                  </li>
                )
              })}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-2 rounded-md border border-neutral-800 p-4">
        <h2 className="font-medium">{state.status === 'completed' ? 'Final scores' : 'Scores'}</h2>
        <ol className="flex flex-col gap-1 text-sm">
          {ranked.map((p) => (
            <li key={p.id} className={`flex items-center gap-2 ${p.eliminated ? 'opacity-40' : ''}`}>
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: colorOf(players, p.id) }} />
              <span className="flex-1">
                {nameOf(players, p.id)}
                {state.winnerPlayerIds.includes(p.id) && ' 🏆'}
                {p.conceded && ' (conceded)'}
              </span>
              <span className="font-mono">{game.scores[p.id] ?? 0}</span>
            </li>
          ))}
        </ol>
      </section>

      {lastRound && (
        <section className="flex flex-col gap-2 rounded-md border border-neutral-800 p-4">
          <h2 className="font-medium">Round {lastRound.round} reveal</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {Object.entries(lastRound.picks).map(([id, value]) => (
              <li key={id} className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: colorOf(players, id) }} />
                <span className="flex-1">{nameOf(players, id)}</span>
                <span className="font-mono">{value}</span>
                <span className={`w-12 text-right font-mono ${lastRound.pointsByPlayerId[id] ? 'text-emerald-400' : 'text-neutral-500'}`}>
                  +{lastRound.pointsByPlayerId[id] ?? 0}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

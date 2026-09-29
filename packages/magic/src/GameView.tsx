import type { GameViewProps } from '@game-platform/sdk/ui'
import { findDeck, STEP_LABELS } from './rules.ts'
import type { GameAction, GameData, GameOptions } from './types.ts'
import { nameOf } from './view/helpers.ts'
import { DeckChoice, Mulligan } from './view/Setup.tsx'
import { Table } from './view/Table.tsx'

const END_REASONS = { life: 'ran out of life', library: 'had to draw from an empty library', draw: 'both lost at once — a draw' }

/**
 * Magic: The Gathering: deck choice, mulligans, then the table. Only the
 * viewer's own hand is ever shown face up. The rules (./rules.ts) validate
 * every submission; the controls only guide.
 */
export function GameView({ state, players, myPlayerId, submitting, onAction }: GameViewProps<GameData, GameOptions, GameAction>) {
  const g = state.game
  const props = { state, players, myPlayerId, submitting, onAction }
  const losers = g.seatOrder.filter((id) => g.players[id].lost)
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="text-lg font-semibold">{g.turnNumber > 0 ? `Turn ${g.turnNumber}` : 'Getting ready'}</h2>
        <span className="text-sm text-neutral-400">
          {state.status === 'active' ? (
            <>
              {STEP_LABELS[g.step]}
              {g.turnNumber > 0 && ` · ${nameOf(players, g.activeId)}'s turn`}
            </>
          ) : (
            <>
              Game over
              {g.endReason && losers.length > 0 && ` — ${losers.map((id) => nameOf(players, id)).join(' & ')} ${END_REASONS[g.endReason] ?? ''}`}
            </>
          )}
        </span>
        {g.step !== 'chooseDeck' && (
          <span className="text-xs text-neutral-500">{g.seatOrder.map((id) => `${nameOf(players, id)}: ${findDeck(g.players[id].deck ?? '')?.name ?? '?'}`).join(' · ')}</span>
        )}
      </header>
      {g.step === 'chooseDeck' && state.status === 'active' ? <DeckChoice {...props} /> : g.step === 'mulligan' && state.status === 'active' ? <Mulligan {...props} /> : <Table key={state.actionHistory.length} {...props} />}
    </div>
  )
}

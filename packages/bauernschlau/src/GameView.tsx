import { useState } from 'react'
import type { GameViewProps } from '@game-platform/sdk/ui'
import { actionChoices, cellLabel, emptyFields, faceDownCells, fenceMovesFor, isOpeningRound, specialCount, STEP_LABELS, type FenceMove, type GameState } from './rules.ts'
import type { GameAction, GameData, GameOptions } from './types.ts'
import { Board } from './view/Board.tsx'
import { BTN, BTN_PRIMARY, nameOf } from './view/helpers.ts'
import { Hand, PlayersPanel } from './view/Panels.tsx'

/** What the viewer is in the middle of choosing on the board. */
type Mode = { kind: 'flip' } | { kind: 'herd'; from: number | null } | { kind: 'fence' }

/**
 * Bauernschlau's table: whose turn it is, the action panel, the board (every
 * choice of field or fence is made by clicking it) and the farmers. The rules
 * (./rules.ts) validate every submission; the controls only guide.
 */
export function GameView({ state, players, myPlayerId, submitting, onAction }: GameViewProps<GameData, GameOptions, GameAction>) {
  const g = state.game
  const s = state as GameState
  const mine = state.status === 'active' && myPlayerId !== null && state.pendingPlayerIds.includes(myPlayerId)
  const me = myPlayerId ?? ''
  // A mode belongs to the position it was chosen in; any new move clears it.
  const at = state.actionHistory.length
  const [chosen, setChosen] = useState<{ mode: Mode; at: number } | null>(null)
  const mode = mine && chosen?.at === at ? chosen.mode : null
  const setMode = (m: Mode | null) => setChosen(m ? { mode: m, at } : null)
  const [handIndex, setHandIndex] = useState(0)

  let targets = new Set<number>()
  let fenceOptions: FenceMove[] = []
  let selected: number[] = []
  let onCell: (cell: number) => void = () => {}
  let prompt = ''

  if (mine && g.step === 'place') {
    const index = Math.min(handIndex, g.hand.length - 1)
    targets = new Set(emptyFields(g))
    prompt = g.hand.length > 1 ? `Place your ${g.hand.length} sheep face down: pick one, then an empty field.` : 'Place your sheep face down on an empty field.'
    onCell = (cell) => onAction({ type: 'PLACE_SHEEP', playerId: me, cell, index })
  } else if (mode?.kind === 'flip') {
    targets = new Set(faceDownCells(g))
    prompt = 'Click a face-down sheep to turn it over.'
    onCell = (cell) => onAction({ type: 'FLIP_SHEEP', playerId: me, cell })
  } else if (mode?.kind === 'herd') {
    const free = [...emptyFields(g), ...(g.dog !== null ? [g.dog] : [])]
    if (mode.from === null) {
      targets = new Set(faceDownCells(g))
      prompt = 'Sheepdog: click the face-down sheep the dog goes to.'
      onCell = (from) => setMode({ kind: 'herd', from })
    } else {
      const from = mode.from
      selected = [from]
      targets = new Set(free)
      // R-DOG-04: the dog stays put, so this click finishes the move.
      prompt = `Where does the sheep from ${cellLabel(from)} go? Click an empty field. The dog stays on ${cellLabel(from)}.`
      onCell = (to) => onAction({ type: 'HERD', playerId: me, from, to })
    }
  } else if (mode?.kind === 'fence') {
    fenceOptions = fenceMovesFor(g, me)
    prompt = 'Click a dashed yellow line to build that fence.'
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="text-lg font-semibold">Round {state.turn}</h2>
        {state.status === 'active' ? (
          <span className="text-sm text-neutral-400">
            {nameOf(players, g.turnPlayerId)} · {STEP_LABELS[g.step]}
            {g.actionsLeft > 1 && ` · ${g.actionsLeft} actions left`}
            {isOpeningRound(state) && ' · opening round: everyone places a sheep'}
          </span>
        ) : (
          <span className="text-sm text-neutral-400">
            Game over
            {g.endReason?.kind === 'farmFull' && ` — ${nameOf(players, g.endReason.playerId)}'s farm is enclosed and full`}
            {g.endReason?.kind === 'stalemate' && ' — nobody could do anything more'}
          </span>
        )}
      </header>
      {state.status === 'active' &&
        (mine ? (
          <section className="flex flex-col gap-3 rounded-md border border-indigo-700/60 p-4">
            <h2 className="font-medium">Your move</h2>
            {g.step === 'place' && <Hand hand={g.hand} selected={Math.min(handIndex, g.hand.length - 1)} onSelect={setHandIndex} disabled={submitting} />}
            {g.step === 'choose' && !mode && <ActionButtons state={s} me={me} submitting={submitting} onAction={onAction} onMode={setMode} />}
            {prompt && <p className="text-sm text-neutral-300">{prompt}</p>}
            {mode && (
              <div>
                <button type="button" className={BTN} disabled={submitting} onClick={() => setMode(null)}>
                  Back
                </button>
              </div>
            )}
          </section>
        ) : (
          <section className="rounded-md border border-neutral-800 p-4 text-sm text-neutral-400">
            Waiting for {state.pendingPlayerIds.map((id) => nameOf(players, id)).join(', ') || 'nobody'} — {STEP_LABELS[g.step].toLowerCase()}
          </section>
        ))}
      <Board
        game={g}
        players={players}
        myPlayerId={myPlayerId}
        targets={targets}
        selected={selected}
        fenceOptions={fenceOptions}
        disabled={submitting}
        onCell={onCell}
        onFence={(move) => onAction({ type: 'BUILD_FENCE', playerId: me, ...move })}
      />
      <PlayersPanel state={s} players={players} />
    </div>
  )
}

/** The five actions (R-TURN-01), each enabled only when it's possible. */
function ActionButtons({ state, me, submitting, onAction, onMode }: { state: GameState; me: string; submitting: boolean; onAction: (a: GameAction) => void; onMode: (m: Mode) => void }) {
  const can = actionChoices(state, state.game, me)
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" className={BTN_PRIMARY} disabled={submitting || !can.draw} onClick={() => onAction({ type: 'DRAW_SHEEP', playerId: me })}>
        Take a sheep
      </button>
      {!isOpeningRound(state) && (
        <>
          <button type="button" className={BTN} disabled={submitting || !can.flip} onClick={() => onMode({ kind: 'flip' })}>
            Flip a sheep
          </button>
          <button type="button" className={BTN} disabled={submitting || !can.herd} onClick={() => onMode({ kind: 'herd', from: null })}>
            Sheepdog
          </button>
          <button type="button" className={BTN} disabled={submitting || !can.fence} onClick={() => onMode({ kind: 'fence' })}>
            Build a fence ({state.game.farms[me]?.fencesLeft ?? 0} left)
          </button>
          <button type="button" className={BTN} disabled={submitting || !can.special} onClick={() => onAction({ type: 'SHEEP_SPECIAL', playerId: me })}>
            Sheep special{can.special ? ` (take ${specialCount(state)})` : ''}
          </button>
        </>
      )}
    </div>
  )
}

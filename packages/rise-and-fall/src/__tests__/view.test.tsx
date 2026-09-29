// Smoke tests for the view (../view.ts): the carried-over components render
// every stage of a game — board setup, each round phase, the end-of-game
// screen — for a seated player, a read-only viewer and a redacted viewer,
// and the few controls the view adds submit the right actions.

import { applyAction, redactStateForPlayer, replayActions, type GameState as PlatformState } from '@game-platform/sdk'
import type { SeatInfo } from '@game-platform/sdk/ui'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { GameState } from '../adapter.ts'
import { GameOptionsEditor } from '../GameOptionsEditor.tsx'
import { GameView } from '../GameView.tsx'
import { DEFAULT_GAME_OPTIONS, gameDefinition } from '../rules.ts'
import { newGame, play, simplestMove } from '../testing.ts'

const COLORS = ['#e11d48', '#2563eb', '#16a34a', '#ca8a04']
const seats = (state: GameState): SeatInfo[] => state.players.map((p, i) => ({ id: p.id, display_name: `Player ${i + 1}`, color: COLORS[i % COLORS.length] }))

function renderView(state: GameState, myPlayerId: string | null, onAction = vi.fn()) {
  return render(<GameView state={state} players={seats(state)} myPlayerId={myPlayerId} submitting={false} onAction={onAction} />)
}

/** Plays simplestMove until `stop` says so (or the game ends / `limit` moves pass). */
function playUntil(state: GameState, stop: (s: GameState) => boolean, limit = 500): GameState {
  for (let i = 0; i < limit && !stop(state); i++) {
    const move = simplestMove(state)
    if (!move) break
    state = play(state, move)
  }
  return state
}

/** Replays and full renders of the hex board add up — generous so a loaded CI runner doesn't flake. */
const SLOW = 30_000

const inPhase = (phase: string) => (s: GameState) => s.phase === phase

describe('Rise & Fall view', () => {
  it('asks the first placer to place a tile', () => {
    const state = newGame()
    renderView(state, state.pendingPlayerIds[0])
    expect(screen.getByText('Your turn.')).toBeInTheDocument()
  }, SLOW)

  it('shows a waiting line to a player who may not act, and nothing actionable to a read-only viewer', () => {
    const state = newGame()
    const other = state.players.find((p) => !state.pendingPlayerIds.includes(p.id))!.id
    const { unmount } = renderView(state, other)
    expect(screen.getByText(/^Waiting for/)).toBeInTheDocument()
    unmount()
    renderView(state, null)
    expect(screen.queryByText('Your turn.')).toBeNull()
  }, SLOW)

  it('renders every stage of a long game, for the player to act and for a spectator', () => {
    let state = newGame({ players: 3, options: { gameLength: 1 } })
    const seenPhases = new Set<string>()
    for (let i = 0; i < 300 && state.status === 'active'; i++) {
      const phase = state.phase ?? ''
      if (!seenPhases.has(phase) || i % 40 === 0) {
        seenPhases.add(phase)
        const actor = renderView(state, state.pendingPlayerIds[0] ?? null)
        actor.unmount()
        const spectator = renderView(state, null)
        spectator.unmount()
      }
      const move = simplestMove(state)
      if (!move) break
      state = play(state, move)
    }
    expect([...seenPhases]).toEqual(expect.arrayContaining(['placeTiles', 'placeUnits', 'selectCards', 'actions']))
  }, SLOW)

  it('submits a card choice, and offers to take it back', () => {
    const state = playUntil(newGame(), inPhase('selectCards'))
    const me = state.pendingPlayerIds[0]
    const onAction = vi.fn()
    const { unmount } = renderView(state, me, onAction)
    expect(screen.getByText('Your turn — choose a card to play.')).toBeInTheDocument()
    // The default setting holds the pick that would reveal everyone's cards; the first of two pickers reveals nothing.
    const cardButtons = screen.getAllByRole('button').filter((b) => b.className.includes('rounded-md border px-3 py-1'))
    fireEvent.click(cardButtons[0])
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ type: 'CHOOSE_CARD', playerId: me }))
    unmount()

    const chosen = play(state, onAction.mock.calls[0][0])
    const retract = vi.fn()
    renderView(chosen, me, retract)
    fireEvent.click(screen.getByRole('button', { name: 'Change my card' }))
    expect(retract).toHaveBeenCalledWith({ type: 'RETRACT_CHOICE', playerId: me })
  }, SLOW)

  it('renders a redacted viewer’s state while picks are hidden', () => {
    const start = playUntil(newGame({ hiddenInformationEnabled: true }), inPhase('selectCards'))
    const first = start.pendingPlayerIds[0]
    const state = play(start, simplestMove(start)!)
    const viewer = state.pendingPlayerIds[0]
    expect(viewer).not.toBe(first)
    const redacted = redactStateForPlayer(state as PlatformState, viewer) as unknown as GameState
    expect(redacted.actionHistory.at(-1)?.action.type).toBe('HIDDEN_ACTION')
    renderView(redacted, viewer)
    expect(screen.getByText('Your turn — choose a card to play.')).toBeInTheDocument()
  }, SLOW)

  it('explains a reviewed step: the game’s turns, halos on what acted, and each player’s change', () => {
    const genesis = newGame()
    const live = playUntil(genesis, (s) => s.phase === 'selectCards' && s.turn >= 2)
    const stops = gameDefinition.reviewStops!(live.actionHistory)
    // A new stop whenever the phase group or, in board setup and the actions phase, the acting player changes.
    expect(stops[0]).toBe(0)
    expect(stops.at(-1)).toBe(live.actionHistory.length)
    expect(new Set(stops).size).toBe(stops.length)

    // The last actions-phase turn before now, as the platform would hand it over.
    const end = [...stops].reverse().find((stop, i, all) => i + 1 < all.length && live.actionHistory[stop - 1]?.action.type === 'PASS_ACTIONS')!
    const start = stops[stops.indexOf(end) - 1]
    const at = (index: number) => replayActions(genesis as PlatformState, live.actionHistory.slice(0, index)) as GameState
    const review = { before: at(start), entries: live.actionHistory.slice(start, end), granularity: 'turn' as const }
    render(<GameView state={at(end)} players={seats(live)} myPlayerId={null} submitting={false} onAction={vi.fn()} review={review} />)
    // Review mode: the territory switch replaces the live toggle, nothing is actionable.
    expect(screen.getByRole('button', { name: /Territory:/ })).toBeInTheDocument()
    expect(screen.queryByText(/Your turn/)).toBeNull()
  }, SLOW)

  it('explains a step for a redacted viewer without replaying past a secret move', () => {
    const genesis = newGame({ hiddenInformationEnabled: true })
    const start = playUntil(genesis, inPhase('selectCards'))
    const state = play(start, simplestMove(start)!)
    const viewer = state.pendingPlayerIds[0]
    const redacted = redactStateForPlayer(state as PlatformState, viewer) as unknown as GameState
    const before = redactStateForPlayer(start as PlatformState, viewer) as unknown as GameState
    expect(redacted.actionHistory.at(-1)?.action.type).toBe('HIDDEN_ACTION')
    const stops = gameDefinition.reviewStops!(redacted.actionHistory)
    expect(stops.at(-1)).toBe(redacted.actionHistory.length)
    render(
      <GameView
        state={redacted}
        players={seats(state)}
        myPlayerId={null}
        submitting={false}
        onAction={vi.fn()}
        review={{ before, entries: redacted.actionHistory.slice(-1), granularity: 'move' }}
      />,
    )
    expect(screen.getByRole('button', { name: /Territory:/ })).toBeInTheDocument()
  }, SLOW)

  it('renders the end-of-game screen with its charts', () => {
    const midGame = playUntil(newGame(), (s) => s.phase === 'selectCards' && s.turn >= 3)
    const result = applyAction(midGame as PlatformState, { type: 'CONCEDE', playerId: 'p2' })
    if (!result.ok) throw new Error(result.error)
    const completed = result.state as GameState
    expect(completed.status).toBe('completed')
    renderView(completed, null)
    expect(screen.getByText('Game over')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy screenshot' })).toBeInTheDocument()
    // These charts only render from a successful replay of the whole log.
    expect(screen.getByRole('img', { name: "Line chart of each player's total score by round" })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: "Stacked bar chart comparing each player's unit value by unit kind" })).toBeInTheDocument()
  }, SLOW)

  it('renders the options editor and edits every option', () => {
    const onChange = vi.fn()
    const { rerender } = render(<GameOptionsEditor value={DEFAULT_GAME_OPTIONS} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /Advanced/ }))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ gameLength: 5 }))

    fireEvent.click(screen.getByRole('radio', { name: /Build alone/ }))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ mapMode: 'solo' }))
    rerender(<GameOptionsEditor value={{ ...DEFAULT_GAME_OPTIONS, mapMode: 'solo' }} onChange={onChange} />)
    fireEvent.click(screen.getByRole('radio', { name: /A random seated player/ }))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ soloBuilder: 'random' }))

    fireEvent.click(screen.getByRole('radio', { name: /Pre-made map/ }))
    const templateChange = onChange.mock.lastCall![0]
    expect(templateChange.mapMode).toBe('template')
    expect(templateChange.mapTemplateId).toEqual(expect.any(String))
    rerender(<GameOptionsEditor value={templateChange} onChange={onChange} />)
    expect(screen.getByRole('combobox')).toBeInTheDocument()

    const firstTale = screen.getAllByRole('checkbox')[0]
    fireEvent.click(firstTale)
    expect(onChange.mock.lastCall![0].activeTaleIds).toHaveLength(1)
  }, SLOW)
})

describe('saved map views', () => {
  it('previews a map and builds one tile by tile until it hands the finished map over', async () => {
    const { SavedMapEditor, SavedMapPreview } = await import('../view/SavedMapViews.tsx')
    const { extractSavedMap } = await import('../rules.ts')
    let built = newGame({ players: 2 })
    while (built.phase === 'placeTiles') built = play(built, simplestMove(built)!)
    const map = extractSavedMap(built)!
    const preview = render(<SavedMapPreview data={map} />)
    expect(preview.getByText(/For 2 players/)).toBeInTheDocument()
    preview.unmount()

    const onChange = vi.fn()
    const editor = render(<SavedMapEditor value={null} onChange={onChange} />)
    fireEvent.click(editor.getByRole('button', { name: 'Start building' }))
    expect(editor.getByRole('button', { name: 'Stop building' })).toBeInTheDocument()
    editor.unmount()
  })
})

describe('options editor with a saved map', () => {
  it('replaces the map options with a note', () => {
    const { rerender } = render(<GameOptionsEditor value={DEFAULT_GAME_OPTIONS} onChange={() => {}} assets={{ map: 'chosen' }} />)
    expect(screen.getByText(/starts from a saved map, so the map options/)).toBeInTheDocument()
    expect(screen.queryByText('Build alone')).toBeNull()
    rerender(<GameOptionsEditor value={DEFAULT_GAME_OPTIONS} onChange={() => {}} assets={{ map: 'random' }} />)
    expect(screen.getByText(/picked at random when the game starts/)).toBeInTheDocument()
  })
})

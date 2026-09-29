import type { SeatInfo } from '@game-platform/sdk/ui'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GameOptionsEditor } from '../GameOptionsEditor'
import { GameView } from '../GameView'
import { DEFAULT_GAME_OPTIONS, gameDefinition, type GameState } from '../rules'
import { move, newGame, play, simplestMove } from '../testing'

function seats(state: GameState): SeatInfo[] {
  return state.players.map((p, i) => ({ id: p.id, display_name: `Player ${i + 1}`, color: '#888888' }))
}

describe("Texas Hold'em view", () => {
  it('offers the player to act fold, call and a raise; shows everyone else who is up', () => {
    const state = newGame({ deal: ['Ah', 'Kh', 'Qh', 'Ad', 'Kd', 'Qd'] })
    const onAction = vi.fn()
    const { unmount } = render(<GameView state={state} players={seats(state)} myPlayerId="p1" submitting={false} onAction={onAction} />)
    expect(screen.getByText('Your move')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Call 20' }))
    expect(onAction).toHaveBeenLastCalledWith({ type: 'CALL', playerId: 'p1' })
    fireEvent.click(screen.getByRole('button', { name: 'Fold' }))
    expect(onAction).toHaveBeenLastCalledWith({ type: 'FOLD', playerId: 'p1' })
    fireEvent.click(screen.getByRole('button', { name: 'Raise to 40' }))
    expect(onAction).toHaveBeenLastCalledWith({ type: 'BET', playerId: 'p1', amount: 40 })
    fireEvent.click(screen.getByRole('button', { name: 'Pot' }))
    // Pot raise: call 20 (pot 30 → 50), raise by 50, to 70.
    fireEvent.click(screen.getByRole('button', { name: 'Raise to 70' }))
    expect(onAction).toHaveBeenLastCalledWith({ type: 'BET', playerId: 'p1', amount: 70 })
    fireEvent.click(screen.getByRole('button', { name: 'All in' }))
    expect(screen.getByRole('button', { name: 'All in (1,000)' })).toBeInTheDocument()
    unmount()
    render(<GameView state={state} players={seats(state)} myPlayerId="p2" submitting={false} onAction={vi.fn()} />)
    expect(screen.getByText(/Waiting for Player 1/)).toBeInTheDocument()
  })

  it('shows only the viewer’s own hole cards face up', () => {
    const state = newGame({ deal: ['Ah', 'Kh', 'Qh', 'Ad', 'Kd', 'Qd'] })
    render(<GameView state={state} players={seats(state)} myPlayerId="p2" submitting={false} onAction={vi.fn()} />)
    const table = screen.getByRole('list', { name: 'Seats' })
    expect(within(table).getByRole('img', { name: 'A♥' })).toBeInTheDocument()
    expect(within(table).getByRole('img', { name: 'A♦' })).toBeInTheDocument()
    expect(within(table).queryByRole('img', { name: 'K♥' })).not.toBeInTheDocument()
    expect(within(table).getAllByRole('img', { name: 'Face-down card' })).toHaveLength(4)
  })

  it('renders a redacted view without crashing', () => {
    const state = newGame()
    const view = { ...state, game: gameDefinition.redactGame(state, null) }
    render(<GameView state={view} players={seats(state)} myPlayerId={null} submitting={false} onAction={vi.fn()} />)
    expect(screen.getAllByRole('img', { name: 'Face-down card' })).toHaveLength(6)
  })

  it('offers a check when nothing is owed', () => {
    const state = move(move(newGame(), 'CALL'), 'CALL')
    const onAction = vi.fn()
    render(<GameView state={state} players={seats(state)} myPlayerId="p3" submitting={false} onAction={onAction} />)
    fireEvent.click(screen.getByRole('button', { name: 'Check' }))
    expect(onAction).toHaveBeenCalledWith({ type: 'CHECK', playerId: 'p3' })
    expect(screen.queryByRole('button', { name: 'Fold' })).not.toBeInTheDocument()
  })

  it('plays a whole game through the view without crashing, and shows the final standings', () => {
    let state = newGame({ players: 4, options: { startingStack: 200, blindsDoubleEvery: 2 } })
    for (let i = 0; i < 3000 && state.status === 'active'; i++) {
      if (i % 15 === 0) {
        const { unmount } = render(<GameView state={state} players={seats(state)} myPlayerId={state.pendingPlayerIds[0] ?? null} submitting={false} onAction={vi.fn()} />)
        unmount()
      }
      state = play(state, simplestMove(state), i)
    }
    expect(state.status).toBe('completed')
    render(<GameView state={state} players={seats(state)} myPlayerId={null} submitting={false} onAction={vi.fn()} />)
    expect(screen.getByText('Final standings')).toBeInTheDocument()
    expect(screen.getAllByText('🏆').length).toBeGreaterThan(0)
    expect(screen.getByText(`Hand ${state.game.lastHand!.hand} result`)).toBeInTheDocument()
  })

  it('renders the options editor', () => {
    const onChange = vi.fn()
    render(<GameOptionsEditor value={DEFAULT_GAME_OPTIONS} onChange={onChange} />)
    const inputs = screen.getAllByRole('spinbutton')
    expect(inputs.map((i) => (i as HTMLInputElement).value)).toEqual(['1000', '20', '10', '0'])
    fireEvent.change(inputs[1], { target: { value: '50' } })
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_GAME_OPTIONS, bigBlind: 50 })
  })
})

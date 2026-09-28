import type { SeatInfo } from '@game-platform/sdk/ui'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GameOptionsEditor } from '../GameOptionsEditor'
import { GameView } from '../GameView'
import { DEFAULT_GAME_OPTIONS } from '../rules'
import { newGame, play, roll, simplestMove } from '../testing'
import type { GameState } from '../rules'

function seats(state: GameState): SeatInfo[] {
  return state.players.map((p, i) => ({ id: p.id, display_name: `Player ${i + 1}`, color: '#888888' }))
}

describe('Shark view', () => {
  it('asks the turn player to trade and roll, and shows everyone else who is up', () => {
    const state = newGame()
    const onAction = vi.fn()
    const { unmount } = render(<GameView state={state} players={seats(state)} myPlayerId="p1" submitting={false} onAction={onAction} />)
    expect(screen.getByText('Your move')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Roll the dice' }))
    expect(onAction).toHaveBeenCalledWith({ type: 'ROLL', playerId: 'p1' })
    expect(screen.getByText('Stock exchange')).toBeInTheDocument()
    unmount()
    render(<GameView state={state} players={seats(state)} myPlayerId="p2" submitting={false} onAction={vi.fn()} />)
    expect(screen.getByText(/Waiting for Player 1/)).toBeInTheDocument()
  })

  it('on a white roll offers every colour and places on a ringed box of the rolled zone', () => {
    const state = roll(newGame(), 'white', 3)
    const onAction = vi.fn()
    render(<GameView state={state} players={seats(state)} myPlayerId="p1" submitting={false} onAction={onAction} />)
    expect(screen.getAllByRole('radio')).toHaveLength(4)
    fireEvent.click(screen.getByRole('radio', { name: 'Green' }))
    const legal = screen.getAllByRole('button', { name: /zone 3 · group of 1/ })
    expect(legal).toHaveLength(20)
    fireEvent.click(legal[0])
    expect(onAction).toHaveBeenCalledWith({ type: 'PLACE', playerId: 'p1', cell: 8, colour: 'green' })
  })

  it('plays a whole game through the view without crashing, and shows the final standings', () => {
    let state = newGame({ players: 4, options: { startingCash: 10_000 } })
    for (let i = 0; i < 3000 && state.status === 'active'; i++) {
      if (i % 25 === 0) {
        const { unmount } = render(<GameView state={state} players={seats(state)} myPlayerId={state.pendingPlayerIds[0] ?? null} submitting={false} onAction={vi.fn()} />)
        unmount()
      }
      state = play(state, simplestMove(state), i)
    }
    expect(state.status).toBe('completed')
    render(<GameView state={state} players={seats(state)} myPlayerId={null} submitting={false} onAction={vi.fn()} />)
    expect(screen.getByText('Final standings')).toBeInTheDocument()
    expect(screen.getAllByText('🏆').length).toBeGreaterThan(0)
  })

  it('renders the options editor', () => {
    render(<GameOptionsEditor value={DEFAULT_GAME_OPTIONS} onChange={vi.fn()} />)
    expect(screen.getByRole('spinbutton')).toHaveValue(0)
  })
})

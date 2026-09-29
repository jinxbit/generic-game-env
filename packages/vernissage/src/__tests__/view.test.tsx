import type { SeatInfo } from '@game-platform/sdk/ui'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GameOptionsEditor } from '../GameOptionsEditor'
import { GameView } from '../GameView'
import { DEFAULT_GAME_OPTIONS, gameDefinition, type GameState } from '../rules'
import { arrange, fateDie, newGame, play, simplestMove } from '../testing'

function seats(state: GameState): SeatInfo[] {
  return state.players.map((p, i) => ({ id: p.id, display_name: `Player ${i + 1}`, color: '#888888' }))
}

/** The state as `viewer` receives it with hidden information on. */
function viewFor(state: GameState, viewer: string): GameState {
  return { ...state, game: gameDefinition.redactGame(state, viewer) }
}

describe('Vernissage view', () => {
  it('asks the turn player to roll the fate die, and shows everyone else who is up', () => {
    const state = newGame()
    const onAction = vi.fn()
    const { unmount } = render(<GameView state={viewFor(state, 'p1')} players={seats(state)} myPlayerId="p1" submitting={false} onAction={onAction} />)
    fireEvent.click(screen.getByRole('button', { name: 'Roll the fate die' }))
    expect(onAction).toHaveBeenCalledWith({ type: 'ROLL_FATE', playerId: 'p1' })
    expect(screen.getByText('Success staircase')).toBeInTheDocument()
    expect(screen.getByText('Your hand')).toBeInTheDocument()
    unmount()
    render(<GameView state={viewFor(state, 'p2')} players={seats(state)} myPlayerId="p2" submitting={false} onAction={vi.fn()} />)
    expect(screen.getByText(/Waiting for Player 1/)).toBeInTheDocument()
  })

  it('places a counter of the rolled kind on the chosen artist', () => {
    const state = play(newGame(), { type: 'ROLL_FATE', playerId: 'p1' }, fateDie('scandal'))
    const onAction = vi.fn()
    render(<GameView state={viewFor(state, 'p1')} players={seats(state)} myPlayerId="p1" submitting={false} onAction={onAction} />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Artist' }), { target: { value: 'kali' } })
    fireEvent.click(screen.getByRole('button', { name: 'Place scandal −4' }))
    expect(onAction).toHaveBeenCalledWith({ type: 'PLACE_COUNTER', playerId: 'p1', artist: 'kali', kind: 'scandal', value: 4 })
  })

  it('lets an objector accept or propose another value', () => {
    let state = play(newGame(), { type: 'ROLL_FATE', playerId: 'p1' }, fateDie('purchase'))
    state = play(state, { type: 'PLACE_COUNTER', playerId: 'p1', artist: 'boyz', kind: 'purchase', value: 7 })
    const onAction = vi.fn()
    render(<GameView state={viewFor(state, 'p2')} players={seats(state)} myPlayerId="p2" submitting={false} onAction={onAction} />)
    fireEvent.click(screen.getByRole('button', { name: 'Object: propose purchase +2' }))
    expect(onAction).toHaveBeenCalledWith({ type: 'RESPOND', playerId: 'p2', value: 2 })
  })

  it('shows the buyer the pile they bought', () => {
    let state = arrange(newGame(), (g) => {
      g.step = 'buy'
    })
    state = play(state, { type: 'BUY_PILE', playerId: 'p1', pile: 2 })
    const onAction = vi.fn()
    render(<GameView state={viewFor(state, 'p1')} players={seats(state)} myPlayerId="p1" submitting={false} onAction={onAction} />)
    expect(screen.getAllByRole('button', { name: /^Take / })).toHaveLength(8)
    fireEvent.click(screen.getByRole('button', { name: 'Take nothing' }))
    expect(onAction).toHaveBeenCalledWith({ type: 'TAKE_CARD', playerId: 'p1', cardId: null })
  })

  it('plays a whole game through the view without crashing, and shows the final standings', () => {
    let state = newGame({ players: 4 })
    for (let i = 0; i < 3000 && state.status === 'active'; i++) {
      if (i % 15 === 0) {
        const viewer = state.pendingPlayerIds[0]
        const { unmount } = render(<GameView state={viewFor(state, viewer)} players={seats(state)} myPlayerId={viewer} submitting={false} onAction={vi.fn()} />)
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
    const onChange = vi.fn()
    render(<GameOptionsEditor value={DEFAULT_GAME_OPTIONS} onChange={onChange} />)
    fireEvent.click(screen.getByRole('checkbox'))
    expect(onChange).toHaveBeenCalledWith({ mightVariant: true })
  })
})

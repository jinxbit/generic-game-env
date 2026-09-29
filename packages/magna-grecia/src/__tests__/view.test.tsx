import type { SeatInfo } from '@game-platform/sdk/ui'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GameOptionsEditor } from '../GameOptionsEditor'
import { GameView } from '../GameView'
import { DEFAULT_GAME_OPTIONS, type GameState } from '../rules'
import { newGame, play, simplestMove } from '../testing'
import { at, fresh, putCity } from './helpers'

function seats(state: GameState): SeatInfo[] {
  return state.players.map((p, i) => ({ id: p.id, display_name: `Player ${i + 1}`, color: '#888888' }))
}

function show(state: GameState, me: string | null) {
  const onAction = vi.fn()
  const view = render(<GameView state={state} players={seats(state)} myPlayerId={me} submitting={false} onAction={onAction} />)
  return { onAction, ...view }
}

describe('Magna Grecia view', () => {
  it('lets the turn player found a city on a ringed village, and tells everyone else who is building', () => {
    const state = fresh()
    const { onAction, unmount } = show(state, 'p1')
    expect(screen.getByText('Your turn')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Place city tiles/ })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('button', { name: /^H1 · green-bordered village.*found a city \(1 point\)/ }))
    expect(onAction).toHaveBeenCalledWith({ type: 'PLACE_CITY', playerId: 'p1', cell: at(0, 7) })
    unmount()
    show(state, 'p2')
    expect(screen.getByText(/Waiting for Player 1 to build/)).toBeInTheDocument()
    expect(screen.getByText(/Round 1 of 12 — action card/)).toBeInTheDocument()
  })

  it('asks which way a road runs, offering only the legal shapes', () => {
    const state = fresh((g) => putCity(g, 'p1', at(0, 7)))
    const { onAction } = show(state, 'p1')
    fireEvent.click(screen.getByRole('radio', { name: /Build roads/ }))
    fireEvent.click(screen.getByRole('button', { name: /^H2 · road: 3 shapes/ }))
    expect(screen.getByText('Choose the road for H2:')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'north–south (straight)' }))
    expect(onAction).toHaveBeenCalledWith({ type: 'PLACE_ROAD', playerId: 'p1', cell: at(1, 7), ends: [0, 2] })
  })

  it('resupplies and ends the turn', () => {
    const { onAction } = show(fresh(), 'p1')
    fireEvent.change(screen.getByLabelText('Road tiles to resupply'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('City tiles to resupply'), { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: 'Resupply 7' }))
    expect(onAction).toHaveBeenCalledWith({ type: 'RESUPPLY', playerId: 'p1', roads: 3, cities: 4 })
    fireEvent.click(screen.getByRole('button', { name: 'End turn' }))
    expect(onAction).toHaveBeenLastCalledWith({ type: 'END_TURN', playerId: 'p1' })
  })

  it('plays a whole game through the view without crashing, and shows the final standings', () => {
    let state = newGame({ players: 3, seed: 5 })
    for (let i = 0; i < 2000 && state.status === 'active'; i++) {
      if (i % 15 === 0) show(state, state.pendingPlayerIds[0] ?? null).unmount()
      state = play(state, simplestMove(state), i)
    }
    expect(state.status).toBe('completed')
    show(state, null)
    expect(screen.getByText('Final standings')).toBeInTheDocument()
    expect(screen.getAllByText('🏆').length).toBeGreaterThan(0)
  })

  it('renders the options editor', () => {
    const onChange = vi.fn()
    render(<GameOptionsEditor value={DEFAULT_GAME_OPTIONS} onChange={onChange} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '8' } })
    expect(onChange).toHaveBeenCalledWith({ rounds: 8 })
  })
})

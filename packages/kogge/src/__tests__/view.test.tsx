import type { SeatInfo } from '@game-platform/sdk/ui'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GameOptionsEditor } from '../GameOptionsEditor'
import { GameView } from '../GameView'
import { DEFAULT_GAME_OPTIONS } from '../rules'
import type { GameState } from '../engine'
import { arrange, atTurn, goods, newGame, play, simplestMove, startAll } from '../testing'
import { createRandom } from '@game-platform/sdk'

const seats = (state: GameState): SeatInfo[] => state.players.map((p, i) => ({ id: p.id, display_name: `Player ${i + 1}`, color: '#888888' }))

describe('Kogge view', () => {
  it('asks for a starting city and submits the pick', () => {
    const state = newGame()
    const onAction = vi.fn()
    render(<GameView state={state} players={seats(state)} myPlayerId="p1" submitting={false} onAction={onAction} />)
    expect(screen.getByText('Choose your starting city')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '4 · Riga' }))
    expect(onAction).toHaveBeenCalledWith({ type: 'START_PICK', playerId: 'p1', attempt: 1, value: 4 })
  })

  it('composes a bid from the hand', () => {
    const state = startAll(newGame(), [0, 4, 7])
    const onAction = vi.fn()
    render(<GameView state={state} players={seats(state)} myPlayerId="p1" submitting={false} onAction={onAction} />)
    fireEvent.click(screen.getByTitle('Add a 5'))
    fireEvent.click(screen.getByRole('button', { name: 'Bid' }))
    expect(onAction).toHaveBeenCalledWith({ type: 'BID', playerId: 'p1', markers: [5] })
  })

  it('hides another player’s face-down route and hand, even with the full state on the device', () => {
    let state = atTurn(startAll(newGame(), [0, 4, 7]), 'p1', 0)
    state = play(state, { type: 'CHANGE_ROUTE', playerId: 'p1', slot: 0, value: 6, placementId: 1 })
    const { unmount } = render(<GameView state={state} players={seats(state)} myPlayerId="p2" submitting={false} onAction={vi.fn()} />)
    expect(screen.getAllByTitle('Face down').length).toBe(1)
    expect(screen.getAllByText(/hidden$/).length).toBe(2)
    unmount()
    render(<GameView state={state} players={seats(state)} myPlayerId="p1" submitting={false} onAction={vi.fn()} />)
    expect(screen.queryByTitle('Face down')).toBeNull()
  })

  it('offers the turn’s actions', () => {
    const state = arrange(atTurn(startAll(newGame(), [0, 4, 7]), 'p1', 4), (g) => {
      g.guildmaster = 4
      g.players.p1.goods = goods({ grey: 1, purple: 1, white: 1 })
    })
    render(<GameView state={state} players={seats(state)} myPlayerId="p1" submitting={false} onAction={vi.fn()} />)
    for (const label of ['Build a house', 'Trade with the Guildmaster', 'Buy route markers', 'Trade with the city', 'Change a route', 'Raid', 'Offer a trade']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
    expect(screen.getByRole('button', { name: 'End turn' })).toBeEnabled()
  })

  it('renders every stage of a game played to the end, and the final standings', () => {
    let state = newGame({ players: 4 })
    const r = createRandom('view')
    const seen = new Set<string>()
    for (let i = 0; i < 3000 && state.status === 'active'; i++) {
      if (!seen.has(state.phase ?? '')) {
        seen.add(state.phase ?? '')
        const { unmount } = render(<GameView state={state} players={seats(state)} myPlayerId={state.pendingPlayerIds[0] ?? null} submitting={false} onAction={vi.fn()} />)
        unmount()
      }
      state = play(state, simplestMove(state, r))
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
    expect(onChange).toHaveBeenCalledWith({ taxes: true })
  })
})

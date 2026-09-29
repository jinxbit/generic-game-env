import type { SeatInfo } from '@game-platform/sdk/ui'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GameOptionsEditor } from '../GameOptionsEditor'
import { GameView } from '../GameView'
import { DEFAULT_GAME_OPTIONS, gameDefinition, handOf, type GameState } from '../rules'
import { arrange, blankBoard, give, newGame, play, put, simplestMove } from '../testing'

function seats(state: GameState): SeatInfo[] {
  return state.players.map((p) => ({ id: p.id, display_name: p.displayName, color: '#888888' }))
}

function view(state: GameState, myPlayerId: string | null, onAction = vi.fn()) {
  return { onAction, ...render(<GameView state={state} players={seats(state)} myPlayerId={myPlayerId} submitting={false} onAction={onAction} />) }
}

describe('Magic view', () => {
  it('offers the decks while choosing, and waits for the other player', () => {
    const state = newGame()
    const { onAction, unmount } = view(state, 'p1')
    fireEvent.click(screen.getByRole('button', { name: 'Play Red Fire' }))
    expect(onAction).toHaveBeenCalledWith({ type: 'CHOOSE_DECK', playerId: 'p1', deck: 'red' })
    unmount()
    const after = play(state, { type: 'CHOOSE_DECK', playerId: 'p1', deck: 'red' })
    view(after, 'p1')
    expect(screen.getByText(/Waiting for Bob to choose a deck/)).toBeInTheDocument()
  })

  it('shows the opening hand with keep and mulligan; after a mulligan, a keep needs cards for the bottom', () => {
    let state = play(play(newGame(), { type: 'CHOOSE_DECK', playerId: 'p1', deck: 'red' }), { type: 'CHOOSE_DECK', playerId: 'p2', deck: 'green' })
    const first = view(state, 'p1')
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }))
    expect(first.onAction).toHaveBeenCalledWith({ type: 'KEEP', playerId: 'p1', bottom: [] })
    first.unmount()
    state = play(state, { type: 'MULLIGAN', playerId: 'p1' })
    const { onAction } = view(state, 'p1')
    expect(screen.getByRole('button', { name: 'Keep' })).toBeDisabled()
    const hand = within(screen.getByLabelText('Your hand')).getAllByRole('button')
    fireEvent.click(hand[3])
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }))
    expect(onAction).toHaveBeenCalledWith({ type: 'KEEP', playerId: 'p1', bottom: [handOf(state.game, 'p1')[3].id] })
  })

  it('plays a land with a click and casts a targeted spell by picking its target', () => {
    const state = arrange(blankBoard(), (g) => {
      give(g, 'p1', 'lightning-bolt')
      put(g, 'p1', 'mountain')
      put(g, 'p2', 'grizzly-bears')
    })
    const { onAction } = view(state, 'p1')
    const hand = screen.getByLabelText('Your hand')
    fireEvent.click(within(hand).getByRole('button', { name: 'Mountain' }))
    expect(onAction).toHaveBeenLastCalledWith({ type: 'PLAY_LAND', playerId: 'p1', cardId: handOf(state.game, 'p1')[0].id })
    fireEvent.click(within(hand).getByRole('button', { name: 'Lightning Bolt' }))
    expect(screen.getByText('Choose a target for Lightning Bolt.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Target Bob' }))
    const bolt = handOf(state.game, 'p1')[1]
    expect(onAction).toHaveBeenLastCalledWith({ type: 'CAST', playerId: 'p1', cardId: bolt.id, targets: [{ kind: 'player', id: 'p2' }] })
    fireEvent.click(within(hand).getByRole('button', { name: 'Lightning Bolt' }))
    fireEvent.click(within(screen.getByLabelText("Bob's permanents")).getByRole('button', { name: 'Grizzly Bears' }))
    const bears = state.game.battlefield.find((p) => p.def === 'grizzly-bears')!
    expect(onAction).toHaveBeenLastCalledWith({ type: 'CAST', playerId: 'p1', cardId: bolt.id, targets: [{ kind: 'permanent', id: bears.id }] })
    fireEvent.click(screen.getByRole('button', { name: 'Go to combat' }))
    expect(onAction).toHaveBeenLastCalledWith({ type: 'PASS', playerId: 'p1' })
  })

  it('declares attackers and blockers by clicking creatures', () => {
    let state = arrange(blankBoard(), (g) => {
      put(g, 'p1', 'hill-giant')
      put(g, 'p2', 'grizzly-bears')
    })
    state = play(state, { type: 'PASS', playerId: 'p1' })
    const giant = state.game.battlefield[0]
    const bears = state.game.battlefield[1]
    const attacking = view(state, 'p1')
    fireEvent.click(screen.getByRole('button', { name: 'Hill Giant' }))
    fireEvent.click(screen.getByRole('button', { name: 'Attack with 1' }))
    expect(attacking.onAction).toHaveBeenLastCalledWith({ type: 'DECLARE_ATTACKERS', playerId: 'p1', attackers: [giant.id] })
    attacking.unmount()
    state = play(state, { type: 'DECLARE_ATTACKERS', playerId: 'p1', attackers: [giant.id] })
    const { onAction } = view(state, 'p2')
    fireEvent.click(screen.getByRole('button', { name: 'Grizzly Bears' }))
    fireEvent.click(screen.getByRole('button', { name: 'Hill Giant' }))
    fireEvent.click(screen.getByRole('button', { name: 'Block with 1' }))
    expect(onAction).toHaveBeenLastCalledWith({ type: 'DECLARE_BLOCKERS', playerId: 'p2', blocks: [{ blocker: bears.id, attacker: giant.id }] })
  })

  it('shows only the viewer’s own hand face up, and renders a redacted view', () => {
    const state = arrange(blankBoard(), (g) => give(g, 'p2', 'giant-growth'))
    const { unmount } = view(state, 'p1')
    expect(within(screen.getByLabelText("Bob's hand")).getAllByRole('img', { name: 'Face-down card' })).toHaveLength(2)
    unmount()
    const redacted = { ...state, game: gameDefinition.redactGame(state, null) }
    view(redacted, null)
    expect(screen.getAllByRole('img', { name: 'Face-down card' }).length).toBe(3)
  })

  it('plays a whole game through the view without crashing', () => {
    let state = newGame({ seed: 4 })
    for (let i = 0; i < 3000 && state.status === 'active'; i++) {
      if (i % 7 === 0) {
        const { unmount } = view(state, state.pendingPlayerIds[0] ?? null)
        unmount()
      }
      state = play(state, simplestMove(state), i)
    }
    expect(state.status).toBe('completed')
    view(state, null)
    expect(screen.getByText(/Game over/)).toBeInTheDocument()
  })

  it('renders the options editor', () => {
    const onChange = vi.fn()
    render(<GameOptionsEditor value={DEFAULT_GAME_OPTIONS} onChange={onChange} />)
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '30' } })
    expect(onChange).toHaveBeenCalledWith({ startingLife: 30 })
  })
})

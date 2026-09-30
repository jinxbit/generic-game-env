import type { SeatInfo } from '@game-platform/sdk/ui'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GameOptionsEditor } from '../GameOptionsEditor'
import { GameView } from '../GameView'
import { bonusFields, cellLabel, DEFAULT_GAME_OPTIONS, emptyFields, gameDefinition, radiusOf, type GameState } from '../rules'
import { arrange, newGame, placeSheep, play, simplestMove, skipOpening } from '../testing'

function seats(state: GameState): SeatInfo[] {
  return state.players.map((p, i) => ({ id: p.id, display_name: `Player ${i + 1}`, color: '#888888' }))
}

describe('Bauernschlau view', () => {
  it('in the opening round offers only taking a sheep, and shows everyone else who is up', () => {
    const state = newGame()
    const onAction = vi.fn()
    const { unmount } = render(<GameView state={state} players={seats(state)} myPlayerId="p1" submitting={false} onAction={onAction} />)
    expect(screen.getByText('Your move')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Flip a sheep' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Take a sheep' }))
    expect(onAction).toHaveBeenCalledWith({ type: 'DRAW_SHEEP', playerId: 'p1' })
    unmount()
    render(<GameView state={state} players={seats(state)} myPlayerId="p2" submitting={false} onAction={vi.fn()} />)
    expect(screen.getByText(/Waiting for Player 1/)).toBeInTheDocument()
  })

  it('shows the drawn sheep to its drawer only, and places it by clicking a field', () => {
    const state = play(arrange(newGame(), (g) => (g.bag = [{ value: 4, black: false }])), { type: 'DRAW_SHEEP', playerId: 'p1' })
    const onAction = vi.fn()
    const { unmount } = render(<GameView state={state} players={seats(state)} myPlayerId="p1" submitting={false} onAction={onAction} />)
    expect(screen.getByRole('radio', { name: '+4' })).toBeInTheDocument()
    const first = emptyFields(state.game)[0]
    fireEvent.click(screen.getByRole('button', { name: cellLabel(first, radiusOf(state.game)) }))
    expect(onAction).toHaveBeenCalledWith({ type: 'PLACE_SHEEP', playerId: 'p1', cell: first, index: 0 })
    unmount()
    const redacted = { ...state, game: gameDefinition.redactGame(state, 'p2') }
    render(<GameView state={redacted} players={seats(state)} myPlayerId="p2" submitting={false} onAction={vi.fn()} />)
    expect(screen.queryByText('+4')).toBeNull()
  })

  it('walks the sheepdog through its two clicks: the sheep, then where it goes', () => {
    let state = skipOpening(newGame({ players: 2 }))
    // Plain fields, so their labels carry no bonus.
    const [a, b] = emptyFields(state.game).filter((c) => !bonusFields(state.rulesVersion).has(c))
    state = placeSheep(state, a, { value: -2, black: false })
    const me = state.game.turnPlayerId!
    const onAction = vi.fn()
    render(<GameView state={state} players={seats(state)} myPlayerId={me} submitting={false} onAction={onAction} />)
    fireEvent.click(screen.getByRole('button', { name: 'Sheepdog' }))
    fireEvent.click(screen.getByRole('button', { name: `${cellLabel(a, radiusOf(state.game))} · face-down sheep` }))
    fireEvent.click(screen.getByRole('button', { name: cellLabel(b, radiusOf(state.game)) }))
    expect(onAction).toHaveBeenCalledWith({ type: 'HERD', playerId: me, from: a, to: b })
  })

  it('in a rules-version-1 game, still asks where the dog ends up', () => {
    let state = skipOpening(newGame({ players: 2, rulesVersion: 1 }))
    // Plain fields, so their labels carry no bonus.
    const [a, b] = emptyFields(state.game).filter((c) => !bonusFields(state.rulesVersion).has(c))
    state = placeSheep(state, a, { value: -2, black: false })
    const me = state.game.turnPlayerId!
    const onAction = vi.fn()
    render(<GameView state={state} players={seats(state)} myPlayerId={me} submitting={false} onAction={onAction} />)
    fireEvent.click(screen.getByRole('button', { name: 'Sheepdog' }))
    fireEvent.click(screen.getByRole('button', { name: `${cellLabel(a, radiusOf(state.game))} · face-down sheep` }))
    fireEvent.click(screen.getByRole('button', { name: cellLabel(b, radiusOf(state.game)) }))
    fireEvent.click(screen.getByRole('button', { name: 'Centre' }))
    expect(onAction).toHaveBeenCalledWith({ type: 'HERD', playerId: me, from: a, to: b, dog: null })
  })

  it('offers fences as clickable lines', () => {
    const state = skipOpening(newGame({ players: 6 }))
    const me = state.game.turnPlayerId!
    const onAction = vi.fn()
    render(<GameView state={state} players={seats(state)} myPlayerId={me} submitting={false} onAction={onAction} />)
    fireEvent.click(screen.getByRole('button', { name: /Build a fence/ }))
    const lines = screen.getAllByRole('button', { name: /^Fence between/ })
    expect(lines).toHaveLength(4)
    fireEvent.click(lines[0])
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ type: 'BUILD_FENCE', playerId: me }))
  })

  it('plays a whole game through the view without crashing, and shows the final standings', () => {
    let state = newGame({ players: 4 })
    for (let i = 0; i < 2000 && state.status === 'active'; i++) {
      if (i % 20 === 0) {
        const viewer = state.pendingPlayerIds[0] ?? null
        const view = { ...state, game: gameDefinition.redactGame(state, viewer) }
        const { unmount } = render(<GameView state={view} players={seats(state)} myPlayerId={viewer} submitting={false} onAction={vi.fn()} />)
        unmount()
      }
      state = play(state, simplestMove(state), i)
    }
    expect(state.status).toBe('completed')
    render(<GameView state={state} players={seats(state)} myPlayerId={null} submitting={false} onAction={vi.fn()} />)
    expect(screen.getByText('Final standings')).toBeInTheDocument()
    expect(screen.getAllByText('🏆').length).toBeGreaterThan(0)
  })

  it('renders the options editor, first edition on by default', () => {
    const onChange = vi.fn()
    render(<GameOptionsEditor value={DEFAULT_GAME_OPTIONS} onChange={onChange} />)
    const [firstEdition, multiRound] = screen.getAllByRole('checkbox')
    expect(firstEdition).toBeChecked()
    fireEvent.click(firstEdition)
    expect(onChange).toHaveBeenCalledWith({ multiRoundScoring: false, firstEdition: false })
    fireEvent.click(multiRound)
    expect(onChange).toHaveBeenCalledWith({ multiRoundScoring: true, firstEdition: true })
  })
})

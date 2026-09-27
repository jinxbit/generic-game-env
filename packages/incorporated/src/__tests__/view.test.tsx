import type { SeatInfo } from '@game-platform/sdk/ui'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GameOptionsEditor } from '../GameOptionsEditor'
import { GameView } from '../GameView'
import { DEFAULT_GAME_OPTIONS } from '../rules'
import { newGame, play, simplestMove } from '../testing'

describe('Incorporated view', () => {
  it('renders a new game with the prompt panel for the player to act', () => {
    const state = newGame()
    const players: SeatInfo[] = state.players.map((p, i) => ({ id: p.id, display_name: `Player ${i + 1}`, color: '#888888' }))
    render(<GameView state={state} players={players} myPlayerId={state.pendingPlayerIds[0]} submitting={false} onAction={vi.fn()} />)
    expect(screen.getByText('Your move')).toBeInTheDocument()
    expect(screen.getByText('Board')).toBeInTheDocument()
  })

  it('renders every prompt reached in a passive game, and the final standings', () => {
    let state = newGame({ options: { threeRounds: true, freeCubes: true, factionTweaks: true } })
    const players: SeatInfo[] = state.players.map((p, i) => ({ id: p.id, display_name: `Player ${i + 1}`, color: '#888888' }))
    const seen = new Set<string>()
    for (let i = 0; i < 2000 && state.status === 'active'; i++) {
      const kind = state.game.prompt?.kind ?? 'none'
      if (!seen.has(kind)) {
        seen.add(kind)
        const { unmount } = render(<GameView state={state} players={players} myPlayerId={state.pendingPlayerIds[0] ?? null} submitting={false} onAction={vi.fn()} />)
        unmount()
      }
      state = play(state, simplestMove(state))
    }
    expect(state.status).toBe('completed')
    render(<GameView state={state} players={players} myPlayerId={null} submitting={false} onAction={vi.fn()} />)
    expect(screen.getByText('Final standings')).toBeInTheDocument()
    expect(screen.getAllByText('🏆').length).toBeGreaterThan(0)
  })

  it('renders the options editor', () => {
    render(<GameOptionsEditor value={DEFAULT_GAME_OPTIONS} onChange={vi.fn()} />)
    expect(screen.getByText("Designer's recommended")).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Three rounds' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Free cubes/ })).toBeDisabled()
  })
})

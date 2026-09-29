import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { GameEvent } from '@game-platform/sdk'
import type { PlayerRow } from '../../lib/dbTypes'
import { GameLogPanel } from '../GameLogPanel'

const players = [{ id: 'p1', display_name: 'Alice', color: '#ef4444' }] as PlayerRow[]
const events: GameEvent[] = [0, 1, 2].map((entryIndex) => ({
  id: `e${entryIndex}`,
  turn: 1,
  playerId: 'p1',
  message: `{player} made move ${entryIndex + 1}.`,
  timestamp: '',
  entryIndex,
}))

describe('GameLogPanel', () => {
  it('marks the reviewed step and dims what comes after it', () => {
    render(<GameLogPanel events={events} players={players} review={{ from: 1, to: 2 }} />)
    const line = (n: number) => screen.getByText(`made move ${n}.`, { exact: false }).closest('li')!
    expect(line(2)).toHaveAttribute('data-in-step', 'true')
    expect(line(1)).not.toHaveAttribute('data-in-step')
    expect(line(3).className).toMatch(/opacity-40/)
    expect(line(1).className).not.toMatch(/opacity-40/)
  })

  it('jumps review to right after a clicked line’s entry', () => {
    const onSelectEntry = vi.fn()
    render(<GameLogPanel events={events} players={players} onSelectEntry={onSelectEntry} />)
    fireEvent.click(screen.getByText('made move 2.', { exact: false }))
    expect(onSelectEntry).toHaveBeenCalledWith(1)
  })
})

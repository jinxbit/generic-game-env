import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { getGameDefinition } from '@game-platform/sdk'
import { gameUiFor } from '../../games/ui'
import type { GameAssetRow } from '../../lib/dbTypes'
import type { RoomAssets } from '../../lib/roomAssets'
import { RoomAssetPicker } from '../RoomAssetPicker'

const map = { playerCount: 2, board: { shape: 'hex', tiles: { '0,0': { id: '0,0', coord: { q: 0, r: 0 }, terrain: 'water', occupantIds: [] } } } }
const asset: GameAssetRow = {
  id: 'asset-1',
  game_type: 'rise-and-fall',
  kind: 'map',
  name: 'Isles',
  visibility: 'public',
  min_players: 2,
  max_players: 2,
  data: map,
  created_by: 'someone',
  created_at: '',
  updated_at: '',
}

vi.mock('../../lib/gameApi', () => ({ listGameAssets: vi.fn(async () => [asset]) }))

function renderPicker(value: RoomAssets, onChange = vi.fn()) {
  render(
    <MemoryRouter>
      <RoomAssetPicker definition={getGameDefinition('rise-and-fall')} ui={gameUiFor('rise-and-fall')} value={value} onChange={onChange} minPlayers={2} maxPlayers={4} />
    </MemoryRouter>,
  )
  return onChange
}

describe('RoomAssetPicker', () => {
  it('copies a chosen asset’s payload into the room', async () => {
    const onChange = renderPicker({})
    const select = screen.getByLabelText(/Map/)
    await waitFor(() => expect(screen.getByRole('option', { name: /Isles/ })).toBeInTheDocument())
    fireEvent.change(select, { target: { value: 'asset-1' } })
    expect(onChange).toHaveBeenCalledWith({ map: { mode: 'chosen', assetId: 'asset-1', name: 'Isles', data: map } })
  })

  it('offers a random pick at Start, and none', async () => {
    const onChange = renderPicker({ map: { mode: 'chosen', assetId: 'asset-1', name: 'Isles', data: map } })
    await waitFor(() => expect(screen.getByRole('option', { name: /Isles/ })).toBeInTheDocument())
    const select = screen.getByLabelText(/Map/)
    fireEvent.change(select, { target: { value: '__random' } })
    expect(onChange).toHaveBeenLastCalledWith({ map: { mode: 'random' } })
    fireEvent.change(select, { target: { value: '' } })
    expect(onChange).toHaveBeenLastCalledWith({})
    expect(screen.getByText(/For 2 players/)).toBeInTheDocument()
  })

  it('renders nothing for a game with no asset kinds', () => {
    const { container } = render(
      <MemoryRouter>
        <RoomAssetPicker definition={getGameDefinition('unique-pick')} ui={null} value={{}} onChange={() => {}} minPlayers={2} maxPlayers={4} />
      </MemoryRouter>,
    )
    expect(container).toBeEmptyDOMElement()
  })
})

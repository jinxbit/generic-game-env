// This package's `view` entry point: the React half of the game, kept apart
// from ./rules.ts so the Edge Functions never load React. Nothing under
// ./view/ (nor ./GameView.tsx or ./GameOptionsEditor.tsx) may be imported by
// the rules, the engine or the content — the view imports them, never the
// other way round.

import type { GameUi } from '@game-platform/sdk/ui'
import { GameOptionsEditor } from './GameOptionsEditor.tsx'
import { GameView } from './GameView.tsx'
import { SavedMapEditor, SavedMapPreview } from './view/SavedMapViews.tsx'
import type { GameAction, GameData, GameOptions } from './types.ts'

export { GameOptionsEditor, GameView }

export const ui: GameUi<GameData, GameOptions, GameAction> = {
  id: 'rise-and-fall',
  tagline: 'Lay out a hex map, then rise and fall across it with unit-kind cards, achievements and victory points.',
  View: GameView,
  OptionsEditor: GameOptionsEditor,
  assetKinds: { map: { Preview: SavedMapPreview, Editor: SavedMapEditor } },
}

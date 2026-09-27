// This package's `view` entry point: the React half of the game, kept apart
// from ./rules.ts so the Edge Functions never load React.

import type { GameUi } from '@game-platform/sdk/ui'
import { GameOptionsEditor } from './GameOptionsEditor.tsx'
import { GameView } from './GameView.tsx'
import type { GameAction, GameData, GameOptions } from './types.ts'

export { GameOptionsEditor, GameView }

export const ui: GameUi<GameData, GameOptions, GameAction> = {
  id: 'incorporated',
  tagline: 'Corporations bid for shares, fight over industries and lobby the world powers.',
  View: GameView,
  OptionsEditor: GameOptionsEditor,
}

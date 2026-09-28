// Rise & Fall's creation-time options form (the platform's create-game screen
// and lobby config editor): game length, the map (built together, built by one
// player, or a pre-made template) and the Tales variants — the standalone
// app's create-game selectors, minus its saved-map pool, which needed a
// database table the platform doesn't have.

import type { GameOptionsEditorProps } from '@game-platform/sdk/ui'
import { normalizeGameOptions } from './rules.ts'
import type { GameOptions } from './types.ts'
import { GameLengthSelector } from './view/GameLengthSelector.tsx'
import { MapModeSelector } from './view/MapModeSelector.tsx'
import { TaleSelector } from './view/TaleSelector.tsx'

export function GameOptionsEditor({ value, onChange, disabled = false }: GameOptionsEditorProps<GameOptions>) {
  // Stored settings may predate an option or carry junk — read them the way the rules will.
  const options = normalizeGameOptions(value)

  return (
    <div className="flex flex-col gap-3 text-left">
      <h3 className="text-sm font-medium text-neutral-400">Game length</h3>
      <GameLengthSelector value={options.gameLength} onChange={(gameLength) => onChange({ ...options, gameLength })} disabled={disabled} />
      <MapModeSelector value={options} onChange={(map) => onChange({ ...options, ...map })} disabled={disabled} />
      <details className="rounded-md border border-neutral-800 p-3" open={options.activeTaleIds.length > 0}>
        <summary className="cursor-pointer text-sm font-medium text-neutral-400">Tales</summary>
        <div className="mt-3">
          <TaleSelector value={options.activeTaleIds} onChange={(activeTaleIds) => onChange({ ...options, activeTaleIds })} disabled={disabled} />
        </div>
      </details>
    </div>
  )
}

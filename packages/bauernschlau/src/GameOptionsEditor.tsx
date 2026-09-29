import type { GameOptionsEditorProps } from '@game-platform/sdk/ui'
import type { GameOptions } from './types.ts'

/**
 * Bauernschlau's creation-time options: only the multi-round variant's
 * scoring (RULES.md R-SCORE-05). normalizeGameOptions (rules.ts) reads
 * anything that isn't `true` as off.
 */
export function GameOptionsEditor({ value, onChange, disabled = false }: GameOptionsEditorProps<GameOptions>) {
  return (
    <label className="flex items-center gap-2 text-sm text-neutral-300">
      <input type="checkbox" checked={value.multiRoundScoring} disabled={disabled} onChange={(e) => onChange({ ...value, multiRoundScoring: e.target.checked })} />
      Multi-round scoring — an unenclosed farm scores 10 less than the lowest enclosed one
    </label>
  )
}

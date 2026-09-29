import type { GameOptionsEditorProps } from '@game-platform/sdk/ui'
import type { GameOptions } from './types.ts'

/** Vernissage's creation-time options: the rulebook's might-card variant (RULES.md R-TRIAL-06). */
export function GameOptionsEditor({ value, onChange, disabled = false }: GameOptionsEditorProps<GameOptions>) {
  return (
    <label className="flex items-center gap-2 text-sm text-neutral-400">
      <input type="checkbox" checked={value.mightVariant} disabled={disabled} onChange={(e) => onChange({ ...value, mightVariant: e.target.checked })} />
      Might-card variant: a Trial total of 14 or more costs one committed might card
    </label>
  )
}

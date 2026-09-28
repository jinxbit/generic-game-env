import type { GameOptionsEditorProps } from '@game-platform/sdk/ui'
import type { GameOptions } from './types.ts'

/** The variant toggles (RULES.md §9). */
export function GameOptionsEditor({ value, onChange, disabled = false }: GameOptionsEditorProps<GameOptions>) {
  return (
    <label className="flex items-center gap-2 text-sm text-neutral-300">
      <input type="checkbox" checked={value.taxes} disabled={disabled} onChange={(e) => onChange({ ...value, taxes: e.target.checked })} className="h-4 w-4 accent-indigo-500 disabled:opacity-50" />
      Taxes: when the Guildmaster arrives, every boat there pays a good and the city loses goods of other colours
    </label>
  )
}

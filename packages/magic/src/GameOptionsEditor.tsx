import type { GameOptionsEditorProps } from '@game-platform/sdk/ui'
import { LIFE_RANGE } from './rules.ts'
import type { GameOptions } from './types.ts'

/**
 * Magic's creation-time options (RULES.md §9). normalizeGameOptions
 * (rules.ts) clamps whatever is stored, so an out-of-range value here can't
 * break genesis.
 */
export function GameOptionsEditor({ value, onChange, disabled = false }: GameOptionsEditorProps<GameOptions>) {
  return (
    <label className="flex flex-col gap-1 text-sm text-neutral-400">
      Starting life
      <input
        type="number"
        inputMode="numeric"
        min={LIFE_RANGE.min}
        max={LIFE_RANGE.max}
        value={value.startingLife}
        disabled={disabled}
        onChange={(e) => onChange({ ...value, startingLife: Number(e.target.value) })}
        className="w-32 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-center text-neutral-100 disabled:opacity-50"
      />
    </label>
  )
}

import type { GameOptionsEditorProps } from '@game-platform/sdk/ui'
import { STARTING_CASH_RANGE } from './rules.ts'
import type { GameOptions } from './types.ts'

/**
 * Shark's creation-time options. The rulebook starts everyone with nothing;
 * starting cash is a house rule. normalizeGameOptions (rules.ts) clamps
 * whatever is stored, so an out-of-range value here can't break genesis.
 */
export function GameOptionsEditor({ value, onChange, disabled = false }: GameOptionsEditorProps<GameOptions>) {
  return (
    <label className="flex flex-col gap-1 text-sm text-neutral-400">
      Starting cash (F.T.) — the rulebook says 0
      <input
        type="number"
        inputMode="numeric"
        min={STARTING_CASH_RANGE.min}
        max={STARTING_CASH_RANGE.max}
        step={STARTING_CASH_RANGE.step}
        value={value.startingCash}
        disabled={disabled}
        onChange={(e) => onChange({ ...value, startingCash: Number(e.target.value) })}
        className="w-32 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-center text-neutral-100 disabled:opacity-50"
      />
    </label>
  )
}

import type { GameOptionsEditorProps } from '@game-platform/sdk/ui'
import { OPTION_RANGES } from './rules.ts'
import type { GameOptions } from './types.ts'

const FIELDS: { key: keyof GameOptions; label: string; step: number }[] = [
  { key: 'startingStack', label: 'Starting chips', step: 100 },
  { key: 'bigBlind', label: 'Big blind (first level)', step: 2 },
  { key: 'blindsDoubleEvery', label: 'Blinds double every … hands (0 = never)', step: 1 },
  { key: 'maxHands', label: 'Hand limit (0 = play to the last player)', step: 1 },
]

/**
 * Texas Hold'em's creation-time options (RULES.md §8). normalizeGameOptions
 * (rules.ts) clamps whatever is stored, so an out-of-range value here can't
 * break genesis.
 */
export function GameOptionsEditor({ value, onChange, disabled = false }: GameOptionsEditorProps<GameOptions>) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {FIELDS.map(({ key, label, step }) => (
        <label key={key} className="flex flex-col gap-1 text-sm text-neutral-400">
          {label}
          <input
            type="number"
            inputMode="numeric"
            min={OPTION_RANGES[key].min}
            max={OPTION_RANGES[key].max}
            step={step}
            value={value[key]}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, [key]: Number(e.target.value) })}
            className="w-32 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-center text-neutral-100 disabled:opacity-50"
          />
        </label>
      ))}
    </div>
  )
}

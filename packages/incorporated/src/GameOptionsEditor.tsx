import type { GameOptionsEditorProps } from '@game-platform/sdk/ui'
import { DESIGNERS_RECOMMENDED, OPTION_LABELS } from './rules.ts'
import type { GameOptions, R3SalesMode } from './types.ts'

const FLAGS = Object.keys(OPTION_LABELS) as (keyof typeof OPTION_LABELS)[]

const SALES_MODES: [R3SalesMode, string][] = [
  ['normal', 'Normal'],
  ['reverseOnly', 'Reverse sales only'],
  ['banned', 'No sales'],
]

/**
 * The §11 variant toggles. Free cubes needs Three rounds ([AMBIG-16]):
 * normalizeGameOptions drops it otherwise, so it's disabled (and cleared)
 * here while Three rounds is off.
 */
export function GameOptionsEditor({ value, onChange, disabled = false }: GameOptionsEditorProps<GameOptions>) {
  const setFlag = (key: keyof typeof OPTION_LABELS, on: boolean) => {
    const next = { ...value, [key]: on }
    if (key === 'threeRounds' && !on) next.freeCubes = false
    onChange(next)
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {FLAGS.map((key) => {
          const locked = key === 'freeCubes' && !value.threeRounds
          return (
            <label key={key} className={`flex items-center gap-2 text-sm ${locked ? 'text-neutral-600' : 'text-neutral-300'}`}>
              <input type="checkbox" checked={value[key]} disabled={disabled || locked} onChange={(e) => setFlag(key, e.target.checked)} className="h-4 w-4 accent-indigo-500 disabled:opacity-50" />
              {OPTION_LABELS[key]}
              {locked && <span className="text-xs">(needs Three rounds)</span>}
            </label>
          )
        })}
      </div>
      <label className="flex flex-wrap items-center gap-2 text-sm text-neutral-400">
        Final-round sales
        <select
          value={value.r3SalesMode}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, r3SalesMode: e.target.value as R3SalesMode })}
          className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-neutral-100 disabled:opacity-50"
        >
          {SALES_MODES.map(([mode, label]) => (
            <option key={mode} value={mode}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <div>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange({ ...DESIGNERS_RECOMMENDED })}
          className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm hover:border-indigo-400 disabled:opacity-50"
        >
          Designer&apos;s recommended
        </button>
      </div>
    </div>
  )
}

import type { GameOptionsEditorProps } from '@game-platform/sdk/ui'
import type { GameOptions } from './types.ts'

/**
 * Magna Grecia's creation-time option: the full 12-round game or the short
 * 8-round one (R-ROUND-01). normalizeGameOptions (rules.ts) accepts only
 * these two, so nothing here can break genesis.
 */
export function GameOptionsEditor({ value, onChange, disabled = false }: GameOptionsEditorProps<GameOptions>) {
  return (
    <label className="flex flex-col gap-1 text-sm text-neutral-400">
      Length
      <select
        value={value.rounds}
        disabled={disabled}
        onChange={(e) => onChange({ ...value, rounds: e.target.value === '8' ? 8 : 12 })}
        className="w-48 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-neutral-100 disabled:opacity-50"
      >
        <option value={12}>12 rounds (full game)</option>
        <option value={8}>8 rounds (short game)</option>
      </select>
    </label>
  )
}

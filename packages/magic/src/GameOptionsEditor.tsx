import type { GameOptionsEditorProps } from '@game-platform/sdk/ui'
import { COMMANDER_LIFE, DEFAULT_GAME_OPTIONS, LIFE_RANGE } from './rules.ts'
import type { GameOptions } from './types.ts'

/**
 * Magic's creation-time options (RULES.md §9): the format and the starting
 * life. Switching to Commander proposes its 40 life (and back to 20), but
 * the life stays editable. normalizeGameOptions (rules.ts) clamps whatever
 * is stored, so an out-of-range value here can't break genesis.
 */
export function GameOptionsEditor({ value, onChange, disabled = false }: GameOptionsEditorProps<GameOptions>) {
  const setCommander = (on: boolean) => {
    const rest: GameOptions = { ...value }
    delete rest.commander
    onChange(on ? { ...rest, commander: true, startingLife: COMMANDER_LIFE } : { ...rest, startingLife: DEFAULT_GAME_OPTIONS.startingLife })
  }
  return (
    <div className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-1 text-sm text-neutral-400" disabled={disabled}>
        <legend className="mb-1">Format</legend>
        <label className="flex items-center gap-2 text-neutral-200">
          <input type="radio" name="magic-format" checked={!value.commander} onChange={() => setCommander(false)} />
          Base set — 40-card decks, one per colour
        </label>
        <label className="flex items-center gap-2 text-neutral-200">
          <input type="radio" name="magic-format" checked={!!value.commander} onChange={() => setCommander(true)} />
          Commander — 100-card singleton decks led by a legendary commander
        </label>
      </fieldset>
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
    </div>
  )
}

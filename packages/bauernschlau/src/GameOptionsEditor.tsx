import type { GameOptionsEditorProps } from '@game-platform/sdk/ui'
import type { GameOptions } from './types.ts'

/**
 * Bauernschlau's creation-time options: the first-edition rule (on by
 * default: a black sheep herded by the dog gives no extra actions, RULES.md
 * R-DOG-03) and the multi-round variant's scoring (R-SCORE-05).
 * normalizeGameOptions (rules.ts) makes sense of whatever is stored.
 */
export function GameOptionsEditor({ value, onChange, disabled = false }: GameOptionsEditorProps<GameOptions>) {
  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-2 text-sm text-neutral-300">
        <input type="checkbox" checked={value.firstEdition} disabled={disabled} onChange={(e) => onChange({ ...value, firstEdition: e.target.checked })} />
        First edition — a black sheep turned over with the dog gives no extra actions
      </label>
      <label className="flex items-center gap-2 text-sm text-neutral-300">
        <input type="checkbox" checked={value.multiRoundScoring} disabled={disabled} onChange={(e) => onChange({ ...value, multiRoundScoring: e.target.checked })} />
        Multi-round scoring — an unenclosed farm scores 10 less than the lowest enclosed one
      </label>
    </div>
  )
}

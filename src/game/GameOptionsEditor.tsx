import { MAX_ROUNDS_RANGE, TARGET_SCORE_RANGE } from './rules'
import type { GameOptions } from './types'

/**
 * The game's own creation-time options, as shown on CreateGamePage.tsx and
 * in LobbyPage.tsx's config editor. The platform passes the value in and
 * stores whatever comes back in `games.settings.gameOptions`; the game's
 * setup normalizes it (rules.ts's normalizeGameOptions), so an out-of-range
 * value typed here can't break genesis.
 */
export function GameOptionsEditor({ value, onChange, disabled = false }: { value: GameOptions; onChange: (value: GameOptions) => void; disabled?: boolean }) {
  return (
    <div className="flex gap-4">
      <label className="flex flex-col gap-1 text-sm text-neutral-400">
        Target score
        <input
          type="number"
          inputMode="numeric"
          min={TARGET_SCORE_RANGE.min}
          max={TARGET_SCORE_RANGE.max}
          value={value.targetScore}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, targetScore: Number(e.target.value) })}
          className="w-20 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-center text-neutral-100 disabled:opacity-50"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-neutral-400">
        Max rounds
        <input
          type="number"
          inputMode="numeric"
          min={MAX_ROUNDS_RANGE.min}
          max={MAX_ROUNDS_RANGE.max}
          value={value.maxRounds}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, maxRounds: Number(e.target.value) })}
          className="w-20 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-center text-neutral-100 disabled:opacity-50"
        />
      </label>
    </div>
  )
}

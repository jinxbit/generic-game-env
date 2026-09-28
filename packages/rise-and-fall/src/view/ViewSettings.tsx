import { DEFAULT_CONFIRM_BEFORE_REVEALING_CARDS } from './cardRevealConfirmation.ts'
import type { ViewPreferences } from './preferences.ts'
import { DEFAULT_UNIT_PLATE_COLORS, type UnitPlateColors } from './unitColors.ts'
import { DEFAULT_UNIT_RESERVE_DISPLAY_MODE, type UnitReserveDisplayMode } from './unitReserveDisplay.ts'

const PLATE_LABELS: { key: keyof UnitPlateColors; label: string }[] = [
  { key: 'hand', label: 'In hand' },
  { key: 'selected', label: 'Chosen this round' },
  { key: 'discard', label: 'Discarded' },
]

const RESERVE_MODES: { value: UnitReserveDisplayMode; label: string }[] = [
  { value: 'remaining', label: 'Remaining supply' },
  { value: 'placed', label: 'Units on the board' },
  { value: 'both', label: 'Both (on board / remaining)' },
]

/**
 * The in-game "Display settings" disclosure — the three preferences the
 * standalone app had settings pages for (unit plate colours, unit reserve
 * badge, confirm before revealing cards), stored per browser
 * (./preferences.ts). Collapsed by default so it costs one line of space.
 */
export function ViewSettings({ value, onChange }: { value: ViewPreferences; onChange: (next: ViewPreferences) => void }) {
  const isDefault =
    value.unitReserveDisplayMode === DEFAULT_UNIT_RESERVE_DISPLAY_MODE &&
    value.confirmBeforeRevealingCards === DEFAULT_CONFIRM_BEFORE_REVEALING_CARDS &&
    PLATE_LABELS.every(({ key }) => value.unitPlateColors[key] === DEFAULT_UNIT_PLATE_COLORS[key])

  return (
    <details className="rounded-md border border-neutral-800 px-3 py-2 text-sm">
      <summary className="cursor-pointer text-neutral-400">Display settings</summary>
      <div className="mt-3 flex flex-col gap-4">
        <div>
          <p className="mb-1.5 text-neutral-400">Unit plate colours, by where the unit&apos;s card is</p>
          <div className="flex flex-wrap gap-4">
            {PLATE_LABELS.map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2">
                <input
                  type="color"
                  value={value.unitPlateColors[key]}
                  onChange={(e) => onChange({ ...value, unitPlateColors: { ...value.unitPlateColors, [key]: e.target.value } })}
                  className="h-6 w-8 cursor-pointer rounded border border-neutral-700 bg-neutral-900"
                />
                {label}
              </label>
            ))}
          </div>
        </div>
        <label className="flex flex-wrap items-center gap-2">
          <span className="text-neutral-400">Unit badges show</span>
          <select
            value={value.unitReserveDisplayMode}
            onChange={(e) => onChange({ ...value, unitReserveDisplayMode: e.target.value as UnitReserveDisplayMode })}
            className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1"
          >
            {RESERVE_MODES.map((mode) => (
              <option key={mode.value} value={mode.value}>
                {mode.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={value.confirmBeforeRevealingCards}
            onChange={(e) => onChange({ ...value, confirmBeforeRevealingCards: e.target.checked })}
            className="h-4 w-4 rounded border-neutral-700 bg-neutral-900"
          />
          Ask before my pick reveals everyone&apos;s cards
        </label>
        {!isDefault && (
          <button
            type="button"
            onClick={() =>
              onChange({
                unitPlateColors: { ...DEFAULT_UNIT_PLATE_COLORS },
                unitReserveDisplayMode: DEFAULT_UNIT_RESERVE_DISPLAY_MODE,
                confirmBeforeRevealingCards: DEFAULT_CONFIRM_BEFORE_REVEALING_CARDS,
              })
            }
            className="self-start text-xs text-neutral-500 hover:text-neutral-300"
          >
            Reset to defaults
          </button>
        )}
      </div>
    </details>
  )
}

// The viewer's display settings for Rise & Fall — the unit plate colours
// (./unitColors.ts), how the unit-reserve badge counts (./unitReserveDisplay.ts)
// and whether to confirm before a pick reveals everyone's cards
// (./cardRevealConfirmation.ts).
//
// The standalone app kept these on the player's profile row. A game package
// can't touch the platform's profiles, so they live in this browser's
// localStorage instead: per device rather than per account, which is fine for
// what are purely cosmetic / comfort settings. Storage can be missing or throw
// (private mode, blocked site data, tests), so every access is guarded and the
// defaults are what a viewer gets when nothing can be read.

import { useCallback, useState } from 'react'
import { resolveConfirmBeforeRevealingCards } from './cardRevealConfirmation.ts'
import { isValidHexColor, resolveUnitPlateColors, type UnitPlateColors } from './unitColors.ts'
import { resolveUnitReserveDisplayMode, type UnitReserveDisplayMode } from './unitReserveDisplay.ts'

export interface ViewPreferences {
  unitPlateColors: UnitPlateColors
  unitReserveDisplayMode: UnitReserveDisplayMode
  confirmBeforeRevealingCards: boolean
}

const STORAGE_KEY = 'rise-and-fall:view-preferences'

/** Anything read back from storage, made valid — unknown or malformed fields fall back to their defaults. */
export function resolvePreferences(raw: unknown): ViewPreferences {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const colors = (input.unitPlateColors && typeof input.unitPlateColors === 'object' ? input.unitPlateColors : {}) as Record<string, unknown>
  const color = (key: keyof UnitPlateColors) => (typeof colors[key] === 'string' && isValidHexColor(colors[key]) ? colors[key] : null)
  return {
    unitPlateColors: resolveUnitPlateColors({ hand: color('hand'), selected: color('selected'), discard: color('discard') }),
    unitReserveDisplayMode: resolveUnitReserveDisplayMode(typeof input.unitReserveDisplayMode === 'string' ? input.unitReserveDisplayMode : null),
    confirmBeforeRevealingCards: resolveConfirmBeforeRevealingCards(typeof input.confirmBeforeRevealingCards === 'boolean' ? input.confirmBeforeRevealingCards : null),
  }
}

export function loadPreferences(): ViewPreferences {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return resolvePreferences(stored ? JSON.parse(stored) : null)
  } catch {
    return resolvePreferences(null)
  }
}

function savePreferences(preferences: ViewPreferences): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences))
  } catch {
    // Not persisted — the setting still applies for this page view.
  }
}

/** The viewer's settings and a setter that also persists them. */
export function usePreferences(): [ViewPreferences, (next: ViewPreferences) => void] {
  const [preferences, setPreferences] = useState(loadPreferences)
  const update = useCallback((next: ViewPreferences) => {
    setPreferences(next)
    savePreferences(next)
  }, [])
  return [preferences, update]
}

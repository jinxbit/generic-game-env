// The defaults for the open questions in RULES.md §10, as one-line switches.
// Changing one changes how existing games replay: ship it with a new
// rulesVersion.

import type { Color } from './types.ts'

/** [AMBIG-1] The game ends after the Actions phase of the round in which the Guildmaster reaches its start for the last time (false: at once). */
export const END_AFTER_FINAL_ROUND = true

/** [AMBIG-2] Whether a single marker counts as a set (R-AUC-03a). */
export const SINGLE_MARKER_IS_SET = false

/** [AMBIG-4] Whether the house supply rule (R-AUC-08) also applies to the Guildmaster's goods. */
export const HOUSE_SUPPLY_ON_GUILDMASTER = true

/** [AMBIG-5] The order a taxed player's good is chosen in (R-GM-01a). */
export const TAX_ORDER: readonly Color[] = ['grey', 'orange', 'purple', 'white']

import type { AnyGameDefinition } from './gameDefinition.ts'

/**
 * The games this deployment can run, keyed by `GameDefinition.id` and
 * `rulesVersion`. The app fills it once at startup (src/games/registry.ts —
 * imported by the browser entry, the Edge Functions and the test setup);
 * every engine function then finds a state's rules from its own
 * `gameType`/`rulesVersion`.
 *
 * Module-level, but configuration rather than game data: every process that
 * registers the same definitions resolves every state identically, so it
 * doesn't threaten replay determinism.
 */
const definitions = new Map<string, AnyGameDefinition[]>()

/**
 * Registers a game's rules. Idempotent for the same definition object, so a
 * module imported from several entry points can call it freely; registering
 * a *different* definition under an id+version that's already taken throws.
 */
export function registerGame(definition: AnyGameDefinition): void {
  // Same format the `games.game_type` column's check constraint enforces.
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(definition.id)) throw new Error(`Game id "${definition.id}" must be lowercase letters, digits and dashes (max 64).`)
  if (!Number.isInteger(definition.rulesVersion) || definition.rulesVersion < 1) throw new Error(`Game "${definition.id}" rulesVersion must be a positive integer.`)
  for (const kind of Object.keys(definition.assetKinds ?? {})) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(kind)) throw new Error(`Game "${definition.id}" asset kind "${kind}" must be lowercase letters, digits and dashes (max 64).`)
  }
  const versions = definitions.get(definition.id) ?? []
  const existing = versions.find((d) => d.rulesVersion === definition.rulesVersion)
  if (existing === definition) return
  if (existing) throw new Error(`Game "${definition.id}" rules version ${definition.rulesVersion} is already registered.`)
  definitions.set(
    definition.id,
    [...versions, definition].sort((a, b) => a.rulesVersion - b.rulesVersion),
  )
}

/**
 * The definition for `gameType` — at exactly `rulesVersion` when given (an
 * existing game), otherwise the newest registered version (a new game).
 * Throws when it isn't registered in this deployment.
 */
export function getGameDefinition(gameType: string, rulesVersion?: number): AnyGameDefinition {
  const versions = definitions.get(gameType)
  if (!versions || versions.length === 0) throw new Error(`Unknown game type "${gameType}" — it isn't registered in this deployment.`)
  if (rulesVersion === undefined) return versions[versions.length - 1]
  const match = versions.find((d) => d.rulesVersion === rulesVersion)
  if (!match) throw new Error(`Game "${gameType}" rules version ${rulesVersion} isn't registered in this deployment.`)
  return match
}

/** Like getGameDefinition, but null instead of throwing — for display code that can degrade gracefully. */
export function findGameDefinition(gameType: string, rulesVersion?: number): AnyGameDefinition | null {
  try {
    return getGameDefinition(gameType, rulesVersion)
  } catch {
    return null
  }
}

/** The rules a given state runs under. */
export function definitionFor(state: { gameType: string; rulesVersion: number }): AnyGameDefinition {
  return getGameDefinition(state.gameType, state.rulesVersion)
}

/** The newest version of every registered game, in registration order. */
export function listGames(): AnyGameDefinition[] {
  return [...definitions.values()].map((versions) => versions[versions.length - 1])
}

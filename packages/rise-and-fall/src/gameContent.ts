// The content bundles the engine runs on for one game: content/*.json
// resolved for its player count, active Tales and game length. The engine
// never imports content itself (it takes these as parameters), so every
// caller that runs rules — ./rules.ts, the view's previews and replays —
// resolves them here, the one way.

import {
  resolveAchievementContent,
  resolveBoardGenerationContent,
  resolveTaleContent,
  resolveUnitContent,
} from './content/resolveContent.ts'
import type { AchievementContent } from './engine/achievementContent.ts'
import type { BoardGenerationContent } from './engine/boardGenerationContent.ts'
import type { TaleContent } from './engine/taleContent.ts'
import { applyTaleAchievementModifiers, applyTaleModifiers } from './engine/tales.ts'
import type { UnitContent } from './engine/unitContent.ts'

export interface GameContent {
  unitContent: UnitContent
  achievementContent: AchievementContent
  boardGenerationContent: BoardGenerationContent
  taleContent: TaleContent
}

// Resolving walks every content file, and the rules run it on every action
// and every replayed entry. The result is a pure function of the key and is
// never mutated (the engine doesn't mutate its inputs), so caching it can't
// change any outcome — it only saves the work.
const cache = new Map<string, GameContent>()

export function resolveGameContent(activeTaleIds: readonly string[], gameLength: number, playerCount: number): GameContent {
  const key = `${playerCount}|${gameLength}|${activeTaleIds.join(',')}`
  const cached = cache.get(key)
  if (cached) return cached
  const boardGenerationContent = resolveBoardGenerationContent(playerCount)
  const taleContent = resolveTaleContent([...activeTaleIds], playerCount)
  const unitContent = applyTaleModifiers(resolveUnitContent(playerCount), taleContent)
  const achievementContent = applyTaleAchievementModifiers(resolveAchievementContent(gameLength), taleContent)
  const content = { unitContent, achievementContent, boardGenerationContent, taleContent }
  cache.set(key, content)
  return content
}

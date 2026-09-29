import { cardIdFor } from './cards.ts'
import { calculateTerrainControlDetail, calculateTerrainControlVP } from './scoring.ts'
import type { TerrainControlDetail } from './scoring.ts'
import type { AchievementContent } from './achievementContent.ts'
import { EMPTY_TALE_CONTENT } from './taleContent.ts'
import type { TaleContent, TaleControllableStructure } from './taleContent.ts'
import type { GameState, Player, Unit } from './types.ts'

/**
 * Rule 7: a card sits in decline until bought back, and per ruling a unit
 * whose owner's card for its kind is currently declined doesn't count
 * toward that kind's board-count VP — the card being "down" takes its
 * units out of scoring, not just out of play. Looks the card up by
 * (ownerId, kind) via `cardIdFor` rather than needing the unit to carry a
 * card id itself, matching how the rest of the engine derives a unit's
 * card (see `syncCardZonesWithBoard` in ./cards.ts).
 */
function isCardDeclined(players: Player[], ownerId: string, kind: string): boolean {
  const player = players.find((p) => p.id === ownerId)
  return player ? player.declineCardIds.includes(cardIdFor(ownerId, kind)) : false
}

/**
 * Victory-point source 1 (achievements): sums `victoryPoints` for whichever
 * achievement each player has claimed.
 *
 * @param claimedByAchievementId Maps achievement id -> the player id who
 *   claimed it. An achievement can only ever be claimed by one player for
 *   the whole game (see content/achievements.json) — achievements nobody
 *   has claimed yet are simply absent from this map.
 * @param achievementVictoryPoints Achievement id -> VP value
 *   (content/achievements.json's per-achievement `victoryPoints`). Missing
 *   entries score 0.
 */
export function calculateAchievementVP(
  claimedByAchievementId: Record<string, string>,
  achievementVictoryPoints: Record<string, number>,
): Record<string, number> {
  const vpByPlayerId: Record<string, number> = {}
  for (const [achievementId, playerId] of Object.entries(claimedByAchievementId)) {
    const vp = achievementVictoryPoints[achievementId] ?? 0
    vpByPlayerId[playerId] = (vpByPlayerId[playerId] ?? 0) + vp
  }
  return vpByPlayerId
}

export interface AchievementDetail {
  achievementId: string
  vp: number
}

/**
 * Same achievement scoring as calculateAchievementVP, itemized per claimed
 * achievement instead of summed into one number — for a player-facing
 * breakdown (e.g. "City Mastery: 5 points"). Achievement names aren't
 * included (the engine never has them — see listAchievements() in
 * content/resolveContent.ts) so a display caller resolves achievementId to
 * a name itself.
 */
export function calculateAchievementDetail(
  claimedByAchievementId: Record<string, string>,
  achievementVictoryPoints: Record<string, number>,
): Record<string, AchievementDetail[]> {
  const detailByPlayerId: Record<string, AchievementDetail[]> = {}
  for (const [achievementId, playerId] of Object.entries(claimedByAchievementId)) {
    const vp = achievementVictoryPoints[achievementId] ?? 0
    const list = detailByPlayerId[playerId] ?? []
    detailByPlayerId[playerId] = list
    list.push({ achievementId, vp })
  }
  return detailByPlayerId
}

/**
 * Victory-point source 2 (board count): for each unit kind, scores each
 * player based on how many of that kind they currently have on the board —
 * excluding any unit whose owner currently has that kind's card in decline
 * (see isCardDeclined above): a declined card doesn't remove its units from
 * the board, but per ruling they stop contributing to this VP source while
 * it's down.
 *
 * @param vpCurveByUnitKind Unit kind -> `victoryPoints.byBoardCount` array
 *   (content/units.json): index 0 is the score for having exactly 1 of that
 *   unit, index 1 for 2, etc. A count past the array's length scores the
 *   last entry; a kind with no entry (or an empty array) scores 0.
 * @param players Used to look up whether a unit's (ownerId, kind) card is
 *   currently in decline.
 */
export function calculateBoardCountVP(units: Unit[], vpCurveByUnitKind: Record<string, number[]>, players: Player[]): Record<string, number> {
  const countedUnits = units.filter((u) => !isCardDeclined(players, u.ownerId, u.kind))
  const countByPlayerAndKind = new Map<string, number>()
  for (const unit of countedUnits) {
    const key = `${unit.ownerId}\u0000${unit.kind}`
    countByPlayerAndKind.set(key, (countByPlayerAndKind.get(key) ?? 0) + 1)
  }

  const vpByPlayerId: Record<string, number> = {}
  for (const [key, count] of countByPlayerAndKind) {
    const [playerId, kind] = key.split('\u0000')
    const curve = vpCurveByUnitKind[kind]
    if (!curve || curve.length === 0) continue

    const score = curve[Math.min(count, curve.length) - 1]
    vpByPlayerId[playerId] = (vpByPlayerId[playerId] ?? 0) + score
  }
  return vpByPlayerId
}

export interface BoardCountDetail {
  kind: string
  count: number
  vp: number
}

/**
 * Same board-count scoring as calculateBoardCountVP, itemized per unit kind
 * instead of summed into one number — for a player-facing breakdown (e.g.
 * "3 City: 4 points"). A kind with no curve entry (or an empty curve) is
 * omitted, same as it not contributing to calculateBoardCountVP's total.
 * Same decline exclusion as calculateBoardCountVP — see isCardDeclined
 * above.
 */
export function calculateBoardCountDetail(
  units: Unit[],
  vpCurveByUnitKind: Record<string, number[]>,
  players: Player[],
): Record<string, BoardCountDetail[]> {
  const countedUnits = units.filter((u) => !isCardDeclined(players, u.ownerId, u.kind))
  const countByPlayerAndKind = new Map<string, number>()
  for (const unit of countedUnits) {
    const key = `${unit.ownerId} ${unit.kind}`
    countByPlayerAndKind.set(key, (countByPlayerAndKind.get(key) ?? 0) + 1)
  }

  const detailByPlayerId: Record<string, BoardCountDetail[]> = {}
  for (const [key, count] of countByPlayerAndKind) {
    const [playerId, kind] = key.split(' ')
    const curve = vpCurveByUnitKind[kind]
    if (!curve || curve.length === 0) continue

    const vp = curve[Math.min(count, curve.length) - 1]
    const list = detailByPlayerId[playerId] ?? []
    detailByPlayerId[playerId] = list
    list.push({ kind, count, vp })
  }
  return detailByPlayerId
}

/**
 * Victory-point source 4 (gold): each player's held gold, converted at
 * `goldPerVictoryPoint` gold per point, rounded down (e.g. 5 gold at 2
 * gold/point is worth 2 VP, not 2.5). `null` (no gold-VP content
 * supplied) scores every player 0, same as an unset VP source elsewhere.
 */
export function calculateGoldVP(players: Player[], goldPerVictoryPoint: number | null): Record<string, number> {
  const vpByPlayerId: Record<string, number> = {}
  if (goldPerVictoryPoint === null) return vpByPlayerId

  for (const player of players) {
    vpByPlayerId[player.id] = Math.floor(player.resources.gold / goldPerVictoryPoint)
  }
  return vpByPlayerId
}

/**
 * Victory-point source 5 (Tale controllable structures): a flat bonus to
 * whoever controls a unique Tale-contributed game piece at game end — e.g.
 * The Cathedral Tale's 15 VP to whoever controls the Cathedral. See
 * TaleControllableStructure's own doc comment (./taleContent.ts) for why
 * this is tracked dynamically from board state rather than a permanent
 * claim like a real achievement. Empty `structures` (no such Tale active)
 * scores every player 0, same as an unset VP source elsewhere.
 */
export function calculateControllableStructureVP(units: Unit[], structures: TaleControllableStructure[]): Record<string, number> {
  const vpByPlayerId: Record<string, number> = {}
  for (const structure of structures) {
    const controller = units.find((u) => u.kind === structure.kind)
    if (!controller) continue
    vpByPlayerId[controller.ownerId] = (vpByPlayerId[controller.ownerId] ?? 0) + structure.victoryPoints
  }
  return vpByPlayerId
}

export interface ControllableStructureDetail {
  kind: string
  name: string
  vp: number
}

/**
 * Same scoring as calculateControllableStructureVP, itemized per
 * controlled structure instead of summed into one number — for a
 * player-facing breakdown (e.g. "The Cathedral: 15 points").
 */
export function calculateControllableStructureDetail(units: Unit[], structures: TaleControllableStructure[]): Record<string, ControllableStructureDetail[]> {
  const detailByPlayerId: Record<string, ControllableStructureDetail[]> = {}
  for (const structure of structures) {
    const controller = units.find((u) => u.kind === structure.kind)
    if (!controller) continue
    const list = detailByPlayerId[controller.ownerId] ?? []
    detailByPlayerId[controller.ownerId] = list
    list.push({ kind: structure.kind, name: structure.name, vp: structure.victoryPoints })
  }
  return detailByPlayerId
}

/** Merges any number of per-source VP-by-player maps (e.g. the five VP sources) into totals. */
export function sumVP(...sources: Array<Record<string, number>>): Record<string, number> {
  const totals: Record<string, number> = {}
  for (const source of sources) {
    for (const [playerId, vp] of Object.entries(source)) {
      totals[playerId] = (totals[playerId] ?? 0) + vp
    }
  }
  return totals
}

export interface VPBreakdown {
  achievements: number
  boardCount: number
  terrainControl: number
  gold: number
  controllableStructures: number
  total: number
}

/**
 * Every player's full VP breakdown across all five sources — the same
 * combination `finishRound()` (./round.ts) uses for the end-of-game win
 * check, and the live score display / end-of-game screen
 * (`RoundView.tsx`/`EndGameView.tsx`) use for the player-facing score —
 * one place this combination lives, instead of each caller re-summing the
 * five source functions itself. Includes every player in `state.players`
 * even if every source scored them 0 (unlike the individual `calculate*VP`
 * functions, which omit a player entirely once at 0). `taleContent`
 * defaults to EMPTY_TALE_CONTENT (no controllable structures) for a caller
 * that doesn't touch Tales, same convention as achievementContent
 * elsewhere.
 */
export function calculateVPBreakdown(
  state: GameState,
  achievementContent: AchievementContent,
  taleContent: TaleContent = EMPTY_TALE_CONTENT,
): Record<string, VPBreakdown> {
  const achievements = calculateAchievementVP(state.claimedByAchievementId, achievementContent.achievementVictoryPoints)
  const boardCount = calculateBoardCountVP(state.units, achievementContent.unitBoardCountVP, state.players)
  const terrainControl = calculateTerrainControlVP(state.board, state.units, achievementContent.terrainVictoryPoints, achievementContent.terrainScoresAs)
  const gold = calculateGoldVP(state.players, achievementContent.goldPerVictoryPoint)
  const controllableStructures = calculateControllableStructureVP(state.units, taleContent.controllableStructures)
  const total = sumVP(achievements, boardCount, terrainControl, gold, controllableStructures)

  const breakdownByPlayerId: Record<string, VPBreakdown> = {}
  for (const player of state.players) {
    breakdownByPlayerId[player.id] = {
      achievements: achievements[player.id] ?? 0,
      boardCount: boardCount[player.id] ?? 0,
      terrainControl: terrainControl[player.id] ?? 0,
      gold: gold[player.id] ?? 0,
      controllableStructures: controllableStructures[player.id] ?? 0,
      total: total[player.id] ?? 0,
    }
  }
  return breakdownByPlayerId
}

export interface VPDetail {
  achievements: AchievementDetail[]
  boardCount: BoardCountDetail[]
  terrainControl: TerrainControlDetail[]
  gold: { amount: number; vp: number }
  controllableStructures: ControllableStructureDetail[]
  total: number
}

/**
 * Every player's itemized VP breakdown across all five sources — what each
 * total is actually made of ("4 Forest: 12 points", "City Mastery: 5
 * points"), not just the number calculateVPBreakdown gives. Built for the
 * end-of-game screen (EndGameView.tsx), which is the one place that needs
 * this level of detail rather than just a per-source total. `taleContent`
 * defaults to EMPTY_TALE_CONTENT, same convention as calculateVPBreakdown.
 *
 * `total` here is computed by summing the itemized entries themselves
 * (rather than delegating to calculateVPBreakdown/sumVP) so it's always
 * exactly consistent with the list a caller renders below it — no risk of
 * the displayed items and the displayed total coming from two different
 * calculations that could drift apart.
 */
export function calculateVPDetail(
  state: GameState,
  achievementContent: AchievementContent,
  taleContent: TaleContent = EMPTY_TALE_CONTENT,
): Record<string, VPDetail> {
  const achievements = calculateAchievementDetail(state.claimedByAchievementId, achievementContent.achievementVictoryPoints)
  const boardCount = calculateBoardCountDetail(state.units, achievementContent.unitBoardCountVP, state.players)
  const terrainControl = calculateTerrainControlDetail(state.board, state.units, achievementContent.terrainVictoryPoints, achievementContent.terrainScoresAs)
  const goldVP = calculateGoldVP(state.players, achievementContent.goldPerVictoryPoint)
  const controllableStructures = calculateControllableStructureDetail(state.units, taleContent.controllableStructures)

  const detailByPlayerId: Record<string, VPDetail> = {}
  for (const player of state.players) {
    const achievementsList = achievements[player.id] ?? []
    const boardCountList = boardCount[player.id] ?? []
    const terrainControlList = terrainControl[player.id] ?? []
    const goldVpValue = goldVP[player.id] ?? 0
    const controllableStructuresList = controllableStructures[player.id] ?? []

    const total =
      achievementsList.reduce((sum, item) => sum + item.vp, 0) +
      boardCountList.reduce((sum, item) => sum + item.vp, 0) +
      terrainControlList.reduce((sum, item) => sum + item.vp, 0) +
      goldVpValue +
      controllableStructuresList.reduce((sum, item) => sum + item.vp, 0)

    detailByPlayerId[player.id] = {
      achievements: achievementsList,
      boardCount: boardCountList,
      terrainControl: terrainControlList,
      gold: { amount: player.resources.gold, vp: goldVpValue },
      controllableStructures: controllableStructuresList,
      total,
    }
  }
  return detailByPlayerId
}

/**
 * Rule: the winner is whoever has the most total VP — there is no
 * tiebreaker, so this returns every player id tied for the highest total
 * (usually one, more than one on a tie). Takes `playerIds` explicitly (not
 * just `Object.keys(totalVPByPlayerId)`) so a player with 0 VP from every
 * source — who'd otherwise never appear in a VP-source map — is still
 * correctly included in the comparison. Empty if `playerIds` is empty.
 */
export function determineWinners(playerIds: string[], totalVPByPlayerId: Record<string, number>): string[] {
  if (playerIds.length === 0) return []

  const maxVP = Math.max(...playerIds.map((id) => totalVPByPlayerId[id] ?? 0))
  return playerIds.filter((id) => (totalVPByPlayerId[id] ?? 0) === maxVP)
}

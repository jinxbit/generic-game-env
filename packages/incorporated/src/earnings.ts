// Phase 5: Earnings (RULES.md §9) and End of Game (§10).

import { AMBIGUITY_DEFAULTS } from './ambiguities.ts'
import { industrySquares, marketLeader } from './board.ts'
import { shiftSlider } from './cubes.ts'
import { activeSeats, cashOf, displayName, expectPrompt, fail, isFinalRound, note, player, playerCount, playerWithCorp, requireWhole, runNext, setPrompt, type Ctx } from './context.ts'
import { INDUSTRIES } from './data/board.ts'
import { discardPayoffs } from './payoffs.ts'
import { growthPercent, interestValue } from './sliders.ts'
import type { CrisisDecisionAction, CrisisDiscardAction, FinalScore, Industry, PlayerId, RepayAction, Task } from './types.ts'

/** R-EARN-01: difficulty = growth% + stress; the crisis die (d12) must reach it. */
export const crisisDifficulty = (ctx: Ctx): number => growthPercent(ctx.g.sliders) + ctx.g.sliders.stress

export function startEarnings(ctx: Ctx): void {
  const g = ctx.g
  g.phase = 'earnings'
  const difficulty = crisisDifficulty(ctx)
  const roll = ctx.random.int(1, 12)
  const squid = playerWithCorp(ctx, 'GIANT_SQUID')
  runNext(ctx, { t: 'payoff' }, { t: 'interest' }, { t: 'repayment', stage: 'all' }, { t: 'endPhase' }, { t: 'startRound' })
  // ⚑ FACTION_TWEAKS: Giant Squid may, once per game, reroll or declare no crisis after seeing a crisis roll.
  if (ctx.options.factionTweaks && squid && !player(ctx, squid).abilitiesUsed.gsCrisis && roll < difficulty) {
    note(ctx, `Crisis check: difficulty ${difficulty}, rolled ${roll}.`)
    setPrompt(ctx, { kind: 'crisisDecision', playerId: squid, roll, difficulty })
    return
  }
  runNext(ctx, { t: 'crisisApply', roll, difficulty, capIntensity: null })
}

export function onCrisisDecision(ctx: Ctx, action: CrisisDecisionAction): void {
  const prompt = expectPrompt(ctx, 'crisisDecision', action.playerId)
  const g = ctx.g
  g.prompt = null
  if (action.decision === 'accept') {
    runNext(ctx, { t: 'crisisApply', roll: prompt.roll, difficulty: prompt.difficulty, capIntensity: null })
    return
  }
  if (action.decision !== 'reroll' && action.decision !== 'noCrisis') fail('Accept, reroll or declare no crisis.')
  player(ctx, action.playerId).abilitiesUsed.gsCrisis = true
  if (action.decision === 'noCrisis') {
    g.lastCrisis = { round: g.round, difficulty: prompt.difficulty, roll: prompt.roll, intensity: 0, ability: 'noCrisis' }
    note(ctx, `${displayName(ctx, action.playerId)} declares no crisis.`)
    return
  }
  const roll = ctx.random.int(1, 12)
  note(ctx, `${displayName(ctx, action.playerId)} rerolls the crisis die: ${roll}.`)
  runNext(ctx, { t: 'crisisApply', roll, difficulty: prompt.difficulty, capIntensity: 3 })
}

/** R-EARN-02/03: intensity = difficulty − roll; Growth and Interest move left by it, as many payoffs are discarded, Stress resets. */
export function crisisApply(ctx: Ctx, task: Extract<Task, { t: 'crisisApply' }>): void {
  const g = ctx.g
  const { roll, difficulty } = task
  if (roll >= difficulty) {
    g.lastCrisis = { round: g.round, difficulty, roll, intensity: 0 }
    note(ctx, `No crisis (difficulty ${difficulty}, rolled ${roll}).`)
    return
  }
  const raw = difficulty - roll
  const intensity = task.capIntensity === null ? raw : Math.min(raw, task.capIntensity)
  g.crisisOccurred = true
  g.lastCrisis = { round: g.round, difficulty, roll, intensity, ...(task.capIntensity !== null ? { ability: 'reroll' as const } : {}) }
  note(ctx, `Crisis! Difficulty ${difficulty}, rolled ${roll}: intensity ${intensity}.`)
  shiftSlider(ctx, 'growth', -intensity)
  shiftSlider(ctx, 'interest', -intensity)
  g.sliders = { ...g.sliders, stress: 0 }
  const count = Math.min(intensity, g.revealed.length)
  if (count === 0) return
  if (count === g.revealed.length) {
    discardRevealed(ctx, g.revealed.map((_, i) => i))
    return
  }
  const squid = playerWithCorp(ctx, 'GIANT_SQUID')
  if (squid) {
    setPrompt(ctx, { kind: 'crisisDiscard', playerId: squid, count })
    return
  }
  // [AMBIG-6]: without Giant Squid the discards are random.
  discardRevealed(ctx, ctx.random.shuffle(g.revealed.map((_, i) => i)).slice(0, count))
}

function discardRevealed(ctx: Ctx, indices: number[]): void {
  const g = ctx.g
  const cards = indices.map((i) => g.revealed[i])
  g.revealed = g.revealed.filter((_, i) => !indices.includes(i))
  discardPayoffs(ctx, cards)
  note(ctx, `Crisis discards: ${cards.join(', ')}.`)
}

export function onCrisisDiscard(ctx: Ctx, action: CrisisDiscardAction): void {
  const prompt = expectPrompt(ctx, 'crisisDiscard', action.playerId)
  const indices = Array.isArray(action.indices) ? action.indices : []
  const unique = new Set(indices)
  if (indices.length !== prompt.count || unique.size !== indices.length || indices.some((i) => !Number.isInteger(i) || i < 0 || i >= ctx.g.revealed.length)) {
    fail(`Choose ${prompt.count} different revealed card(s).`)
  }
  ctx.g.prompt = null
  discardRevealed(ctx, indices)
}

/** R-EARN-04..06: industry by industry, k cards × weighted squares, +$2 (+$1 with 2 players) for a sole leader. */
export function payoff(ctx: Ctx): void {
  const g = ctx.g
  const seats = activeSeats(ctx)
  const earned: Record<PlayerId, number> = Object.fromEntries(seats.map((id) => [id, 0]))
  const leaders: Partial<Record<Industry, PlayerId>> = {}
  const bonus = playerCount(ctx) === 2 ? 1 : 2
  for (const industry of INDUSTRIES) {
    const k = g.revealed.filter((c) => c === industry).length
    const counts = Object.fromEntries(seats.map((id) => [id, industrySquares(g, id, industry)]))
    for (const id of seats) earned[id] += k * counts[id]
    const leader = marketLeader(counts)
    if (leader && k >= 1) {
      earned[leader] += bonus
      leaders[industry] = leader
    }
    discardPayoffs(
      ctx,
      g.revealed.filter((c) => c === industry),
    )
    g.revealed = g.revealed.filter((c) => c !== industry)
  }
  for (const id of seats) player(ctx, id).cash = cashOf(ctx, id) + earned[id]
  g.lastEarnings = { round: g.round, payoff: earned, leaders, interest: {}, repaid: {} }
  note(ctx, `Earnings: ${seats.map((id) => `${displayName(ctx, id)} +$${earned[id]}`).join(', ')}.`)
}

/** R-LOAN-03: $1 per bond; short of cash, pay everything (bailout) and keep the bonds. */
export function interest(ctx: Ctx): void {
  const g = ctx.g
  const paid: Record<PlayerId, number> = {}
  for (const id of activeSeats(ctx)) {
    const p = player(ctx, id)
    if (p.bonds === 0) continue
    const due = Math.min(p.bonds, cashOf(ctx, id))
    if (due < p.bonds) note(ctx, `${displayName(ctx, id)} can't cover their interest and is bailed out.`)
    p.cash = cashOf(ctx, id) - due
    paid[id] = due
  }
  if (g.lastEarnings) g.lastEarnings.interest = paid
}

/**
 * ⚑ FACTION_TWEAKS: with no crisis all game, Giant Squid's bonds cost $2
 * less ([AMBIG-19]: per bond) to repay in the final round and at the end.
 */
function squidReduction(ctx: Ctx, playerId: PlayerId, atEnd: boolean): number {
  if (!ctx.options.factionTweaks || ctx.g.crisisOccurred || player(ctx, playerId).corp !== 'GIANT_SQUID') return 0
  return atEnd || isFinalRound(ctx) ? AMBIGUITY_DEFAULTS.giantSquidReductionPerBond : 0
}

/** R-LOAN-04: each bond repaid costs the current interest value. */
export function repaymentCost(ctx: Ctx, playerId: PlayerId): number {
  return Math.max(0, interestValue(ctx.g.sliders) - squidReduction(ctx, playerId, false))
}

function maxRepayable(ctx: Ctx, playerId: PlayerId): number {
  const cost = repaymentCost(ctx, playerId)
  const p = player(ctx, playerId)
  return cost === 0 ? p.bonds : Math.min(p.bonds, Math.floor(cashOf(ctx, playerId) / cost))
}

/** R-LOAN-04, R-EARN-07: everyone decides together; Big Brother decides after seeing the others. */
export function repayment(ctx: Ctx, stage: 'all' | 'bigBrother'): void {
  const g = ctx.g
  const bigBrother = playerWithCorp(ctx, 'BIG_BROTHER')
  const eligible = activeSeats(ctx).filter((id) => maxRepayable(ctx, id) > 0)
  const waiting = stage === 'all' ? eligible.filter((id) => id !== bigBrother) : eligible.filter((id) => id === bigBrother)
  if (stage === 'all' && bigBrother && eligible.includes(bigBrother)) runNext(ctx, { t: 'repayment', stage: 'bigBrother' })
  if (waiting.length === 0) return
  setPrompt(ctx, { kind: 'repayment', promptId: g.nextPromptId++, waiting, decisions: Object.fromEntries(waiting.map((id) => [id, null])), bigBrotherLast: stage === 'all' ? bigBrother : null })
}

export function onRepay(ctx: Ctx, action: RepayAction): void {
  const prompt = ctx.g.prompt
  if (!prompt || prompt.kind !== 'repayment' || prompt.promptId !== action.promptId) fail('No repayment is open.')
  if (!prompt.waiting.includes(action.playerId)) fail('You have no repayment decision to make.')
  const count = requireWhole(action.count, 'The number of bonds')
  if (count > maxRepayable(ctx, action.playerId)) fail(`You can repay at most ${maxRepayable(ctx, action.playerId)} bond(s).`)
  prompt.decisions[action.playerId] = count
  prompt.waiting = prompt.waiting.filter((id) => id !== action.playerId)
  if (prompt.waiting.length === 0) settleRepayments(ctx)
}

export function settleRepayments(ctx: Ctx): void {
  const prompt = ctx.g.prompt
  if (!prompt || prompt.kind !== 'repayment') return
  ctx.g.prompt = null
  const lines: string[] = []
  for (const [id, count] of Object.entries(prompt.decisions)) {
    const n = count ?? 0
    const p = player(ctx, id)
    p.cash = cashOf(ctx, id) - n * repaymentCost(ctx, id)
    p.bonds -= n
    if (ctx.g.lastEarnings) ctx.g.lastEarnings.repaid[id] = n
    lines.push(`${displayName(ctx, id)} ${n}`)
  }
  note(ctx, `Bonds repaid: ${lines.join(', ')}.`)
}

/** R-END-01..04: $5 per (weighted) square, +$10 (+$5 with 2 players) per sole leader, −$20 per bond; most cash wins, ties share. */
export function endGame(ctx: Ctx): void {
  const g = ctx.g
  const seats = activeSeats(ctx)
  const bonus = playerCount(ctx) === 2 ? 5 : 10
  const scores: Record<PlayerId, FinalScore> = {}
  for (const id of seats) {
    scores[id] = { squares: { FIN: 0, TECH: 0, HEAVY: 0, ENERGY: 0, MINING: 0 }, industryCash: 0, leaderBonus: 0, bondPenalty: 0, startingCash: cashOf(ctx, id), total: 0 }
  }
  for (const industry of INDUSTRIES) {
    const counts = Object.fromEntries(seats.map((id) => [id, industrySquares(g, id, industry)]))
    for (const id of seats) {
      scores[id].squares[industry] = counts[id]
      scores[id].industryCash += 5 * counts[id]
    }
    const leader = marketLeader(counts)
    if (leader) scores[leader].leaderBonus += bonus
  }
  for (const id of seats) {
    const p = player(ctx, id)
    const perBond = (ctx.options.lessCruelLoans ? interestValue(g.sliders) : 20) - squidReduction(ctx, id, true)
    const s = scores[id]
    s.bondPenalty = p.bonds * perBond
    s.total = s.startingCash + s.industryCash + s.leaderBonus - s.bondPenalty
    p.cash = s.total
  }
  g.finalScores = scores
  g.phase = 'ended'
  g.prompt = null
  g.queue = []
  note(ctx, `Final cash: ${seats.map((id) => `${displayName(ctx, id)} $${scores[id].total}`).join(', ')}.`)
}

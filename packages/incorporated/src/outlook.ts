// Phase 1: Global Outlook (RULES.md §4) and the Outlook effect DSL (§4.3).

import { countryDef, countryName } from './board.ts'
import { bopToward, clearSquare, occupySquare, shiftSlider } from './cubes.ts'
import { displayName, expectPrompt, fail, note, outlookChooser, player, playerWithCorp, runNext, setPrompt, type Ctx } from './context.ts'
import { COUNTRIES } from './data/board.ts'
import { OUTLOOK_CARDS, type OutlookEffect } from './data/outlookCards.ts'
import { describeCards, drawPayoffs } from './payoffs.ts'
import { payoffsToReveal } from './sliders.ts'
import type { ChooseSquareAction, OutlookChoiceAction, PickOutlookAction, Task, UseAbilityAction } from './types.ts'

export function outlookCard(id: string) {
  const card = OUTLOOK_CARDS.find((c) => c.id === id)
  if (!card) throw new Error(`Unknown Outlook card: ${id}`)
  return card
}

/** R-TURN-01/03, R-OUT-01: a new turn starts with phase 1, unless the Outlook pile is empty, which ends the game. */
export function startRound(ctx: Ctx): void {
  const g = ctx.g
  if (g.outlookDeck.length === 0) {
    runNext(ctx, { t: 'endGame' })
    return
  }
  g.round += 1
  g.phase = 'outlook'
  g.cursor = null
  note(ctx, `Turn ${g.round} begins.`)
  runNext(ctx, { t: 'outlookDraw' })
}

/** R-OUT-02: the chooser draws the top card — or, ⚑ FACTION_TWEAKS, Big Brother may use their once-per-game redraw instead. */
export function outlookDraw(ctx: Ctx): void {
  const g = ctx.g
  const bigBrother = playerWithCorp(ctx, 'BIG_BROTHER')
  if (ctx.options.factionTweaks && bigBrother && !player(ctx, bigBrother).abilitiesUsed.bbOutlook && g.outlookOut.length > 0) {
    setPrompt(ctx, { kind: 'useAbility', playerId: bigBrother, ability: 'bbOutlook' })
    return
  }
  const top = g.outlookDeck.shift() as string
  runNext(ctx, { t: 'playOutlook', cardId: top })
}

export function playOutlook(ctx: Ctx, cardId: string): void {
  const card = outlookCard(cardId)
  ctx.g.outlookPlayed.push(cardId)
  note(ctx, `Outlook: ${card.name}.`)
  runNext(ctx, ...card.effects.map((effect): Task => ({ t: 'effect', effect, remaining: effectRepeats(effect) })), { t: 'revealPayoffs' }, { t: 'endPhase' }, { t: 'startInvestment' })
}

function effectRepeats(effect: OutlookEffect): number {
  return effect.op === 'unlockSquare' || effect.op === 'lockSquare' ? (effect.count ?? 1) : 1
}

/** The options a choice-making effect offers right now, or null for an effect that never asks. */
function effectOptions(ctx: Ctx, effect: OutlookEffect): (string | number)[] | null {
  const g = ctx.g
  switch (effect.op) {
    case 'unlockSquare':
      return indicesWhere(g.countries[effect.country].squares, (s) => s.occupant === 'LOCK')
    case 'lockSquare': {
      const squares = g.countries[effect.country].squares
      const empty = indicesWhere(squares, (s) => s.occupant === null)
      if (empty.length > 0) return empty
      // Otherwise a player's cube is displaced — never a fortified one (⚑ ACCUM_RD).
      return indicesWhere(squares, (s) => s.occupant !== null && s.occupant !== 'LOCK' && !s.fortified)
    }
    case 'flipAffiliation':
      return COUNTRIES.filter(
        (c) =>
          c.zone !== null &&
          (effect.filter.zone === undefined || c.zone === effect.filter.zone) &&
          (effect.filter.major === undefined || c.isMajor === effect.filter.major) &&
          g.countries[c.id].affiliation === effect.from,
      ).map((c) => c.id)
    default:
      return null
  }
}

function indicesWhere<T>(items: T[], test: (item: T) => boolean): number[] {
  return items.flatMap((item, index) => (test(item) ? [index] : []))
}

/** Runs one effect (§4.3); an effect with a real choice asks the Outlook chooser first. */
export function runEffect(ctx: Ctx, task: Extract<Task, { t: 'effect' }>): void {
  const { effect } = task
  switch (effect.op) {
    case 'moveSlider':
      shiftSlider(ctx, effect.slider, effect.delta)
      return
    case 'campGainsPower': {
      const affiliation = ctx.g.countries[effect.country].affiliation
      if (affiliation === 'NATO' || affiliation === 'SCO') bopToward(ctx, affiliation)
      return
    }
    default: {
      const options = effectOptions(ctx, effect) ?? []
      if (options.length === 0) return
      // Unlocking every lock left needs no choice.
      if (options.length === 1 || (effect.op === 'unlockSquare' && options.length <= task.remaining)) {
        const picks = effect.op === 'unlockSquare' ? options.slice(0, task.remaining) : [options[0]]
        for (const pick of picks) applyEffectChoice(ctx, effect, pick)
        const left = task.remaining - picks.length
        if (left > 0 && effect.op !== 'unlockSquare') runNext(ctx, { t: 'effect', effect, remaining: left })
        return
      }
      if (task.remaining > 1) runNext(ctx, { t: 'effect', effect, remaining: task.remaining - 1 })
      setPrompt(ctx, { kind: 'outlookChoice', playerId: outlookChooser(ctx), effect, options })
    }
  }
}

function applyEffectChoice(ctx: Ctx, effect: OutlookEffect, choice: string | number): void {
  const g = ctx.g
  switch (effect.op) {
    case 'unlockSquare': {
      const square = choice as number
      g.countries[effect.country].squares[square].occupant = null
      note(ctx, `${countryName(effect.country)}'s ${countryDef(effect.country).squares[square]} square is unlocked.`)
      if (ctx.options.factionTweaks) runNext(ctx, { t: 'offerUnlocked', country: effect.country, square })
      return
    }
    case 'lockSquare': {
      const square = choice as number
      clearSquare(ctx, effect.country, square)
      g.countries[effect.country].squares[square].occupant = 'LOCK'
      note(ctx, `${countryName(effect.country)}'s ${countryDef(effect.country).squares[square]} square is locked.`)
      return
    }
    case 'flipAffiliation': {
      // [AMBIG-7]: an Outlook flip never wipes a major's cubes or shares.
      g.countries[choice as string].affiliation = effect.to
      note(ctx, `${countryName(choice as string)} joins ${effect.to}.`)
      return
    }
    default:
      throw new Error(`Effect ${effect.op} takes no choice`)
  }
}

export function onOutlookChoice(ctx: Ctx, action: OutlookChoiceAction): void {
  const prompt = expectPrompt(ctx, 'outlookChoice', action.playerId)
  if (!prompt.options.includes(action.choice)) fail('Pick one of the offered options.')
  ctx.g.prompt = null
  applyEffectChoice(ctx, prompt.effect, action.choice)
}

/** ⚑ FACTION_TWEAKS: Big Brother may take a square an event unlocked, for free. */
export function offerUnlocked(ctx: Ctx, task: Extract<Task, { t: 'offerUnlocked' }>): void {
  const bigBrother = playerWithCorp(ctx, 'BIG_BROTHER')
  if (!bigBrother || player(ctx, bigBrother).supply === 0) return
  if (ctx.g.countries[task.country].squares[task.square].occupant !== null) return
  setPrompt(ctx, { kind: 'chooseSquare', playerId: bigBrother, reason: 'takeUnlocked', country: task.country, options: [task.square], optional: true })
}

export function onTakeUnlocked(ctx: Ctx, action: ChooseSquareAction): void {
  const prompt = expectPrompt(ctx, 'chooseSquare', action.playerId)
  if (action.square !== null && !prompt.options.includes(action.square)) fail('Pick one of the offered squares.')
  ctx.g.prompt = null
  if (action.square === null) return
  occupySquare(ctx, action.playerId, prompt.country, action.square)
  note(ctx, `${displayName(ctx, action.playerId)} takes the unlocked square in ${countryName(prompt.country)}.`)
}

/** ⚑ FACTION_TWEAKS: Big Brother discards the top card, draws 2 from those out of the game and plays 1 — or declines and plays the top card. */
export function onUseOutlookAbility(ctx: Ctx, action: UseAbilityAction): void {
  expectPrompt(ctx, 'useAbility', action.playerId)
  const g = ctx.g
  g.prompt = null
  const top = g.outlookDeck.shift() as string
  if (!action.use) {
    runNext(ctx, { t: 'playOutlook', cardId: top })
    return
  }
  player(ctx, action.playerId).abilitiesUsed.bbOutlook = true
  const pool = ctx.random.shuffle(g.outlookOut as string[])
  const drawn = pool.slice(0, 2)
  g.outlookOut = [...pool.slice(2), top]
  note(ctx, `${displayName(ctx, action.playerId)} discards the top Outlook card and draws 2 others.`)
  setPrompt(ctx, { kind: 'pickOutlook', playerId: action.playerId, drawn })
}

export function onPickOutlook(ctx: Ctx, action: PickOutlookAction): void {
  const prompt = expectPrompt(ctx, 'pickOutlook', action.playerId)
  const cardId = prompt.drawn[action.index]
  if (!Number.isInteger(action.index) || typeof cardId !== 'string') fail('Pick one of the drawn cards.')
  ctx.g.prompt = null
  ctx.g.outlookOut.push(...prompt.drawn.filter((_, i) => i !== action.index))
  runNext(ctx, { t: 'playOutlook', cardId })
}

/** R-OUT-03: reveal as many payoffs as Growth now says, reshuffling only when a draw is impossible. */
export function revealPayoffs(ctx: Ctx): void {
  const drawn = drawPayoffs(ctx, payoffsToReveal(ctx.g.sliders))
  ctx.g.revealed.push(...drawn)
  note(ctx, `Payoffs revealed: ${describeCards(drawn)}.`)
}

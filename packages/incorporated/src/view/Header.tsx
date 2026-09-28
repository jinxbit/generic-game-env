import { bondsOutstanding, growthPercent, interestValue, OUTLOOK_CARDS, payoffsToReveal, TOTAL_BONDS } from '../rules.ts'
import type { GameState } from '../rules.ts'
import { PHASE_NAMES, signedBop } from './helpers.tsx'
import { Badge, Section, Stat } from './Section.tsx'


function outlookName(id: string): { name: string; placeholder: boolean } {
  const card = OUTLOOK_CARDS.find((c) => c.id === id)
  return card ? { name: card.name, placeholder: card.placeholder } : { name: id, placeholder: false }
}

/**
 * Turn, phase, the four sliders, bonds and the payoff cards. The payoff
 * discard is face up but not inspectable (R-GEN-01), so only its size shows.
 */
export function Header({ state }: { state: GameState }) {
  const game = state.game
  const { sliders } = game
  const top = game.outlookDeck[0] ?? null
  return (
    <Section
      title={
        <span className="flex flex-wrap items-baseline gap-x-3">
          <span>
            Turn {Math.min(game.round, game.totalRounds)} of {game.totalRounds}
          </span>
          <span className="text-sm text-neutral-400">{PHASE_NAMES[game.phase]}</span>
        </span>
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Growth">
          {growthPercent(sliders)}% · reveals {payoffsToReveal(sliders)}
        </Stat>
        <Stat label="Interest (loan value)">${interestValue(sliders)}</Stat>
        <Stat label="Stress">{sliders.stress > 0 ? `+${sliders.stress}` : sliders.stress}</Stat>
        <Stat label="Balance of Power">{signedBop(sliders.bop)}</Stat>
        <Stat label="Bonds outstanding">
          {bondsOutstanding(game)} / {TOTAL_BONDS}
        </Stat>
        <Stat label="Payoff deck / discard">
          {game.payoffDeck.length} / {game.payoffDiscard.length}
        </Stat>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-neutral-400">Revealed payoffs:</span>
        {game.revealed.length === 0 ? <span className="text-neutral-500">none</span> : game.revealed.map((card, i) => <Badge key={i}>{card}</Badge>)}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-neutral-400">Outlook played:</span>
        {game.outlookPlayed.length === 0 ? (
          <span className="text-neutral-500">none</span>
        ) : (
          game.outlookPlayed.map((id, i) => {
            const card = outlookName(id)
            return (
              <Badge key={i}>
                {card.name}
                {card.placeholder && <span className="ml-1 text-neutral-500">(placeholder)</span>}
              </Badge>
            )
          })
        )}
      </div>
      {top !== null && (
        <p className="text-sm text-amber-300">
          Next Outlook card (only you see this): {outlookName(top).name}
          {outlookName(top).placeholder && <span className="ml-1 text-neutral-500">(placeholder)</span>}
        </p>
      )}
    </Section>
  )
}

import type { SeatInfo } from '@game-platform/sdk/ui'
import { useState } from 'react'
import { bondsOutstanding, COUNTRIES, countryName, loanProceeds, OUTLOOK_CARDS, TOTAL_BONDS } from '../rules.ts'
import type { GameState } from '../rules.ts'
import type { CountryId, GameAction, GameData, OutlookEffect, Prompt } from '../types.ts'
import { CompetitionTurnControls, FreeAttackControls, IncomeControls } from './CompetitionControls.tsx'
import { BTN, BTN_PRIMARY, BTN_SELECTED, cubeRefLabel, playerLabel, squareLabel } from './helpers.tsx'
import type { ControlProps, PromptOf } from './helpers.tsx'
import { LobbyTurnControls } from './LobbyControls.tsx'
import { NumberField, Section, SelectField } from './Section.tsx'


function outlookCardName(id: string | null): string {
  if (id === null) return 'Hidden card'
  const card = OUTLOOK_CARDS.find((c) => c.id === id)
  return card ? `${card.name}${card.placeholder ? ' (placeholder)' : ''}` : id
}

function describeEffect(effect: OutlookEffect): string {
  switch (effect.op) {
    case 'unlockSquare':
      return `Unlock a square in ${countryName(effect.country)}`
    case 'lockSquare':
      return `Lock a square in ${countryName(effect.country)}`
    case 'flipAffiliation':
      return `Switch a ${effect.from} country to ${effect.to}`
    case 'moveSlider':
      return `Move ${effect.slider} by ${effect.delta}`
    case 'campGainsPower':
      return `${countryName(effect.country)}'s camp gains power`
  }
}

/** One line on what the game is waiting for — shown to everyone. */
function describePrompt(game: GameData, players: SeatInfo[], prompt: Prompt): string {
  const who = (id: string) => playerLabel(game, players, id)
  switch (prompt.kind) {
    case 'investTurn':
      return `${who(prompt.playerId)}'s Investment turn.`
    case 'auction': {
      const what = prompt.mode === 'public' ? 'Auction' : prompt.mode === 'reverse' ? 'Reverse auction (lowest sale price wins)' : `Private sale by ${who(prompt.ownerId)}`
      const high = prompt.high ? `standing bid $${prompt.high.amount} by ${who(prompt.high.playerId)}` : prompt.mode === 'private' ? `minimum $${prompt.limit}` : `below $${prompt.limit}`
      return `${what} for a ${countryName(prompt.country)} share — ${high}. ${who(prompt.current)} to bid.`
    }
    case 'sealedAuction':
      return `Sealed auction for a ${countryName(prompt.country)} share, opened by ${who(prompt.initiatorId)}. Submitted: ${prompt.submitted.length} / ${Object.keys(prompt.bids).length}.`
    case 'sealedTie':
      return `Sealed bids tied at $${prompt.amount}: ${who(prompt.playerId)} picks the winner.`
    case 'closedSell':
      return `${who(prompt.playerId)} may sell a ${countryName(prompt.country)} share to the bank at $${prompt.price}.`
    case 'chooseSquare':
      return `${who(prompt.playerId)} chooses a square in ${countryName(prompt.country)}.`
    case 'removeCubes':
      return `${who(prompt.playerId)} removes ${prompt.count} cube(s) (${prompt.reason === 'sold' ? 'share sold' : 'sale cost'}).`
    case 'freeAttack':
      return `${who(prompt.playerId)} may make a free attack in ${countryName(prompt.country)}.`
    case 'income':
      return `${who(prompt.playerId)} places ${prompt.available} income cube(s).`
    case 'competitionTurn':
      return `${who(prompt.playerId)}'s Competition turn.`
    case 'lobbyTurn':
      return `${who(prompt.playerId)}'s Lobbying turn.`
    case 'moveMarker':
      return `${who(prompt.playerId)} moves the battleground marker.`
    case 'subsidies':
      return `${who(prompt.playerId)} is choosing a Subsidies swap.`
    case 'stimulus':
      return `${who(prompt.playerId)} keeps one Stimulus card.`
    case 'outlookChoice':
      return `${who(prompt.playerId)} resolves an Outlook effect: ${describeEffect(prompt.effect)}.`
    case 'useAbility':
      return `${who(prompt.playerId)} decides whether to use their ability.`
    case 'pickOutlook':
      return `${who(prompt.playerId)} picks an Outlook card.`
    case 'crisisDecision':
      return `${who(prompt.playerId)} decides on the crisis roll (${prompt.roll} vs difficulty ${prompt.difficulty}).`
    case 'crisisDiscard':
      return `${who(prompt.playerId)} discards ${prompt.count} revealed payoff card(s).`
    case 'repayment':
      return `Loan repayment: waiting for ${prompt.waiting.map(who).join(', ')}.`
  }
}

function InvestTurnControls({ state, me, submitting, send }: ControlProps) {
  const game = state.game
  const majors = COUNTRIES.filter((c) => c.isMajor && (game.bank[c.id] ?? 0) >= 1 && !game.retiredMajors.includes(c.id)).map((c) => c.id)
  const [country, setCountry] = useState<CountryId>(majors[0] ?? '')
  const [bid, setBid] = useState(3)
  const owned = Object.entries(game.players[me].shares)
    .filter(([, n]) => n > 0)
    .map(([c]) => c)
  const [saleCountry, setSaleCountry] = useState<CountryId>(owned[0] ?? '')
  const [minPrice, setMinPrice] = useState(3)
  const sealed = state.options.closedAuctionSco && country !== '' && game.countries[country]?.affiliation === 'SCO'
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-neutral-400">Executives left: {game.players[me].executives}</p>
      <div className="flex flex-wrap items-center gap-2">
        <SelectField label="Auction" value={country} options={majors.map((id) => [id, `${countryName(id)} (bank ${game.bank[id]})`])} onChange={setCountry} disabled={submitting} />
        {sealed ? <span className="text-neutral-400">sealed bids</span> : <NumberField label="Opening bid $" min={3} value={bid} onChange={setBid} disabled={submitting} />}
        <button
          type="button"
          className={BTN_PRIMARY}
          disabled={submitting || !country || (!sealed && bid < 3)}
          onClick={() => send(sealed ? { type: 'START_AUCTION', playerId: me, country } : { type: 'START_AUCTION', playerId: me, country, bid })}
        >
          Open auction
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SelectField label="Private sale" value={saleCountry} options={owned.map((id) => [id, countryName(id)])} onChange={setSaleCountry} disabled={submitting} />
        <NumberField label="Minimum $" min={0} value={minPrice} onChange={setMinPrice} disabled={submitting} />
        <button type="button" className={BTN} disabled={submitting || !saleCountry || minPrice < 0} onClick={() => send({ type: 'START_PRIVATE_SALE', playerId: me, country: saleCountry, minPrice })}>
          Offer share
        </button>
      </div>
      <div>
        <button type="button" className={BTN} disabled={submitting} onClick={() => send({ type: 'INVEST_PASS', playerId: me })}>
          Pass (use an executive)
        </button>
      </div>
    </div>
  )
}

function AuctionControls({ me, submitting, send, prompt }: ControlProps & { prompt: PromptOf<'auction'> }) {
  const ceiling = prompt.high?.amount ?? prompt.limit
  const suggested = prompt.mode === 'reverse' ? ceiling - 1 : prompt.high ? prompt.high.amount + 1 : prompt.limit
  const [amount, setAmount] = useState(Math.max(0, suggested))
  const valid = prompt.mode === 'reverse' ? amount < ceiling && amount >= 0 : prompt.high ? amount > prompt.high.amount : amount >= prompt.limit
  return (
    <div className="flex flex-wrap items-center gap-2">
      <NumberField label={prompt.mode === 'reverse' ? `Bid below $${ceiling}: $` : 'Bid $'} min={0} value={amount} onChange={setAmount} disabled={submitting} />
      <button type="button" className={BTN_PRIMARY} disabled={submitting || !valid} onClick={() => send({ type: 'BID', playerId: me, amount })}>
        Bid
      </button>
      <button type="button" className={BTN} disabled={submitting || prompt.high?.playerId === me} onClick={() => send({ type: 'PASS_BID', playerId: me })}>
        Pass
      </button>
    </div>
  )
}

function SealedAuctionControls({ state, me, submitting, send, prompt }: ControlProps & { prompt: PromptOf<'sealedAuction'> }) {
  const [amount, setAmount] = useState(0)
  const cash = state.game.players[me].cash
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-neutral-400">Bid no more than your cash{cash !== null ? ` ($${cash})` : ''}; $0 passes.</p>
      <div className="flex flex-wrap items-center gap-2">
        <NumberField label="Sealed bid $" min={0} max={cash ?? undefined} value={amount} onChange={setAmount} disabled={submitting} />
        <button type="button" className={BTN_PRIMARY} disabled={submitting || amount < 0} onClick={() => send({ type: 'SEALED_BID', playerId: me, auctionId: prompt.auctionId, amount })}>
          Submit
        </button>
      </div>
    </div>
  )
}

function ChooseSquareControls({ me, submitting, send, prompt }: ControlProps & { prompt: PromptOf<'chooseSquare'> }) {
  const reason = prompt.reason === 'placeBought' ? 'Place your cube for the share you bought.' : prompt.reason === 'replaceSeller' ? "Replace the seller's cube." : 'Take the unlocked square for free?'
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-neutral-400">{reason}</p>
      <div className="flex flex-wrap gap-2">
        {prompt.options.map((square) => (
          <button key={square} type="button" className={BTN} disabled={submitting} onClick={() => send({ type: 'CHOOSE_SQUARE', playerId: me, square })}>
            {countryName(prompt.country)} {squareLabel(prompt.country, square)}
          </button>
        ))}
        {prompt.optional && (
          <button type="button" className={BTN} disabled={submitting} onClick={() => send({ type: 'CHOOSE_SQUARE', playerId: me, square: null })}>
            Decline
          </button>
        )}
      </div>
    </div>
  )
}

/** Pick exactly `count` of the offered cubes; identical loose refs are separate entries. */
function RemoveCubesControls({ me, submitting, send, prompt }: ControlProps & { prompt: PromptOf<'removeCubes'> }) {
  const [picked, setPicked] = useState<number[]>([])
  const toggle = (i: number) => setPicked(picked.includes(i) ? picked.filter((j) => j !== i) : [...picked, i])
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-neutral-400">
        Choose {prompt.count} cube(s) to remove ({picked.length} chosen).
      </p>
      <div className="flex flex-wrap gap-2">
        {prompt.options.map((ref, i) => (
          <button key={i} type="button" className={picked.includes(i) ? BTN_SELECTED : BTN} disabled={submitting || (!picked.includes(i) && picked.length >= prompt.count)} onClick={() => toggle(i)}>
            {cubeRefLabel(ref)}
          </button>
        ))}
      </div>
      <div>
        <button type="button" className={BTN_PRIMARY} disabled={submitting || picked.length !== prompt.count} onClick={() => send({ type: 'REMOVE_CUBES', playerId: me, cubes: picked.map((i) => prompt.options[i]) })}>
          Remove
        </button>
      </div>
    </div>
  )
}

function SubsidiesControls({ state, me, submitting, send, prompt }: ControlProps & { prompt: PromptOf<'subsidies'> }) {
  const [peekIndex, setPeekIndex] = useState(() => Math.max(0, prompt.peek.findIndex((c) => c !== null)))
  const [revealedIndex, setRevealedIndex] = useState('0')
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-neutral-400">Pick one card you looked at to replace a revealed payoff card.</p>
      <div className="flex flex-wrap gap-2">
        {prompt.peek.map((card, i) =>
          card === null ? null : (
            <button key={i} type="button" className={peekIndex === i ? BTN_SELECTED : BTN} disabled={submitting} onClick={() => setPeekIndex(i)}>
              {card}
            </button>
          ),
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SelectField label="Replace" value={revealedIndex} options={state.game.revealed.map((card, i) => [String(i), `${card} (#${i + 1})`])} onChange={setRevealedIndex} disabled={submitting} />
        <button type="button" className={BTN_PRIMARY} disabled={submitting} onClick={() => send({ type: 'SUBSIDIES_SWAP', playerId: me, peekIndex, revealedIndex: Number(revealedIndex) })}>
          Swap
        </button>
      </div>
    </div>
  )
}

function OutlookChoiceControls({ me, submitting, send, prompt }: ControlProps & { prompt: PromptOf<'outlookChoice'> }) {
  const effect = prompt.effect
  const label = (option: string | number): string => {
    if ((effect.op === 'lockSquare' || effect.op === 'unlockSquare') && typeof option === 'number') return `${countryName(effect.country)} ${squareLabel(effect.country, option)}`
    return typeof option === 'string' ? countryName(option) : String(option)
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-neutral-400">{describeEffect(effect)}:</p>
      <div className="flex flex-wrap gap-2">
        {prompt.options.map((option) => (
          <button key={String(option)} type="button" className={BTN} disabled={submitting} onClick={() => send({ type: 'OUTLOOK_CHOICE', playerId: me, choice: option })}>
            {label(option)}
          </button>
        ))}
      </div>
    </div>
  )
}

function CrisisDiscardControls({ state, me, submitting, send, prompt }: ControlProps & { prompt: PromptOf<'crisisDiscard'> }) {
  const [picked, setPicked] = useState<number[]>([])
  const toggle = (i: number) => setPicked(picked.includes(i) ? picked.filter((j) => j !== i) : [...picked, i])
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-neutral-400">
        Discard {prompt.count} revealed payoff card(s) ({picked.length} chosen).
      </p>
      <div className="flex flex-wrap gap-2">
        {state.game.revealed.map((card, i) => (
          <button key={i} type="button" className={picked.includes(i) ? BTN_SELECTED : BTN} disabled={submitting || (!picked.includes(i) && picked.length >= prompt.count)} onClick={() => toggle(i)}>
            {card}
          </button>
        ))}
      </div>
      <div>
        <button type="button" className={BTN_PRIMARY} disabled={submitting || picked.length !== prompt.count} onClick={() => send({ type: 'CRISIS_DISCARD', playerId: me, indices: picked })}>
          Discard
        </button>
      </div>
    </div>
  )
}

function RepaymentControls({ state, me, submitting, send, prompt }: ControlProps & { prompt: PromptOf<'repayment'> }) {
  const bonds = state.game.players[me].bonds
  const [count, setCount] = useState(0)
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-neutral-400">Repay how many of your {bonds} bond(s)?</p>
      <div className="flex flex-wrap items-center gap-2">
        <NumberField label="Bonds" min={0} max={bonds} value={count} onChange={(v) => setCount(Math.max(0, Math.min(bonds, v || 0)))} disabled={submitting} />
        <button type="button" className={BTN_PRIMARY} disabled={submitting} onClick={() => send({ type: 'REPAY', playerId: me, promptId: prompt.promptId, count })}>
          Repay {count}
        </button>
      </div>
    </div>
  )
}

function Buttons({ items, submitting }: { items: [string, () => void][]; submitting: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map(([label, onClick]) => (
        <button key={label} type="button" className={BTN} disabled={submitting} onClick={onClick}>
          {label}
        </button>
      ))}
    </div>
  )
}

function PromptControls(props: ControlProps & { prompt: Prompt }) {
  const { prompt, me, send, submitting, state, players } = props
  const game = state.game
  switch (prompt.kind) {
    case 'investTurn':
      return <InvestTurnControls {...props} />
    case 'auction':
      return <AuctionControls {...props} prompt={prompt} />
    case 'sealedAuction':
      return <SealedAuctionControls {...props} prompt={prompt} />
    case 'sealedTie':
      return <Buttons submitting={submitting} items={prompt.tied.map((id): [string, () => void] => [`Award to ${playerLabel(game, players, id)}`, () => send({ type: 'PICK_WINNER', playerId: me, winnerId: id })])} />
    case 'closedSell':
      return (
        <Buttons
          submitting={submitting}
          items={[
            [`Sell at $${prompt.price}`, () => send({ type: 'CLOSED_SELL', playerId: me, sell: true })],
            ['Keep my share', () => send({ type: 'CLOSED_SELL', playerId: me, sell: false })],
          ]}
        />
      )
    case 'chooseSquare':
      return <ChooseSquareControls {...props} prompt={prompt} />
    case 'removeCubes':
      return <RemoveCubesControls {...props} prompt={prompt} />
    case 'freeAttack':
      return <FreeAttackControls {...props} prompt={prompt} />
    case 'income':
      return <IncomeControls {...props} prompt={prompt} />
    case 'competitionTurn':
      return <CompetitionTurnControls {...props} />
    case 'lobbyTurn':
      return <LobbyTurnControls {...props} prompt={prompt} />
    case 'moveMarker':
      return <Buttons submitting={submitting} items={prompt.options.map((id): [string, () => void] => [countryName(id), () => send({ type: 'MOVE_MARKER', playerId: me, country: id })])} />
    case 'subsidies':
      return <SubsidiesControls {...props} prompt={prompt} />
    case 'stimulus':
      return (
        <Buttons
          submitting={submitting}
          items={prompt.drawn.flatMap((card, i): [string, () => void][] => (card === null ? [] : [[`Keep ${card} (#${i + 1})`, () => send({ type: 'STIMULUS_KEEP', playerId: me, index: i })]]))}
        />
      )
    case 'outlookChoice':
      return <OutlookChoiceControls {...props} prompt={prompt} />
    case 'useAbility':
      return (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-neutral-400">
            {prompt.ability === 'bbOutlook' ? 'Discard the top Outlook card and choose one of two others instead?' : 'Take the first Lobbying action (a Power Play)?'}
          </p>
          <Buttons
            submitting={submitting}
            items={[
              ['Use ability', () => send({ type: 'USE_ABILITY', playerId: me, use: true })],
              ['Decline', () => send({ type: 'USE_ABILITY', playerId: me, use: false })],
            ]}
          />
        </div>
      )
    case 'pickOutlook':
      return (
        <Buttons
          submitting={submitting}
          items={prompt.drawn.flatMap((id, i): [string, () => void][] => (id === null ? [] : [[`Play ${outlookCardName(id)}`, () => send({ type: 'PICK_OUTLOOK', playerId: me, index: i })]]))}
        />
      )
    case 'crisisDecision':
      return (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-neutral-400">
            Crisis roll {prompt.roll} against difficulty {prompt.difficulty}.
          </p>
          <Buttons
            submitting={submitting}
            items={[
              ['Accept', () => send({ type: 'CRISIS_DECISION', playerId: me, decision: 'accept' })],
              ['Reroll', () => send({ type: 'CRISIS_DECISION', playerId: me, decision: 'reroll' })],
              ['Declare no crisis', () => send({ type: 'CRISIS_DECISION', playerId: me, decision: 'noCrisis' })],
            ]}
          />
        </div>
      )
    case 'crisisDiscard':
      return <CrisisDiscardControls {...props} prompt={prompt} />
    case 'repayment':
      return <RepaymentControls {...props} prompt={prompt} />
  }
}

/**
 * What the game is waiting on, and — when it's waiting on this seat — the
 * controls to answer it (driven entirely by `state.game.prompt`). A loan can
 * be taken at any time during Investment and Competition (R-LOAN-01).
 */
export function ActionPanel({ state, players, myPlayerId, submitting, onAction }: { state: GameState; players: SeatInfo[]; myPlayerId: string | null; submitting: boolean; onAction: (action: GameAction) => void }) {
  const game = state.game
  const prompt = game.prompt
  if (state.status !== 'active' || !prompt) return null
  const me = myPlayerId !== null && game.players[myPlayerId] && !state.players.find((p) => p.id === myPlayerId)?.eliminated ? myPlayerId : null
  const mine = me !== null && state.pendingPlayerIds.includes(me) && (prompt.kind !== 'repayment' || prompt.waiting.includes(me))
  const canLoan = me !== null && (game.phase === 'investment' || game.phase === 'competition')
  const myBonds = me !== null ? game.players[me].bonds : 0
  return (
    <Section title={mine ? 'Your move' : 'Waiting'} className={mine ? 'border-indigo-700' : ''}>
      <p className="text-sm text-neutral-300">{describePrompt(game, players, prompt)}</p>
      {mine && me !== null && <PromptControls key={state.actionHistory.length} state={state} players={players} me={me} submitting={submitting} send={onAction} prompt={prompt} />}
      {canLoan && me !== null && (
        <div className="flex flex-wrap items-center gap-2 border-t border-neutral-800 pt-3 text-sm">
          <button type="button" className={BTN} disabled={submitting || bondsOutstanding(game) >= TOTAL_BONDS} onClick={() => onAction({ type: 'TAKE_LOAN', playerId: me })}>
            Take a loan (+${loanProceeds(game, state.options, myBonds)})
          </button>
          <span className="text-neutral-500">You hold {myBonds} bond(s).</span>
        </div>
      )}
    </Section>
  )
}

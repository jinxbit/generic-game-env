import { useState, type ReactNode } from 'react'
import type { SeatInfo } from '@game-platform/sdk/ui'
import { bidStrength, BONUS_INFO, BONUS_TYPES, buildCost, canBid, CITIES, COLORS, describeBid, goodsTotal, guildmasterPath, markerColor, moveCost, sameBid } from '../rules.ts'
import type { GameState } from '../rules.ts'
import type { BonusType, Color, GameAction, GameData, Goods, GuildTrade, Payment, PlayerId } from '../types.ts'
import { cityLabel, nameOf, visibleRoute } from './format.ts'
import { BTN, BTN_PRIMARY, BTN_SELECTED, GoodDot, GoodsList, Marker, Section } from './helpers.tsx'

interface Props {
  state: GameState
  players: SeatInfo[]
  myPlayerId: string | null
  submitting: boolean
  onAction: (action: GameAction) => void
}

const noGoods = (): Goods => ({ grey: 0, orange: 0, purple: 0, white: 0 })

/** Everything the player may do now. The rules validate every submission; the controls only guide. */
export function ActionPanel(props: Props) {
  const { state, players, myPlayerId } = props
  const g = state.game
  if (state.status === 'completed') {
    const winners = state.winnerPlayerIds.map((id) => nameOf(players, id)).join(' and ')
    return (
      <Section title="Game over">
        <p className="text-sm">
          🏆 {winners} {state.winnerPlayerIds.length === 1 ? 'wins' : 'share the win'}
          {g.scores && state.winnerPlayerIds.length > 0 && ` with ${g.scores[state.winnerPlayerIds[0]].total} VP`}.
        </p>
      </Section>
    )
  }
  const acting = myPlayerId !== null && state.pendingPlayerIds.includes(myPlayerId)
  const waiting = state.pendingPlayerIds.map((id) => nameOf(players, id)).join(', ')
  let body: ReactNode = <p className="text-sm text-neutral-400">Waiting for {waiting}.</p>
  if (g.stage === 'start' && myPlayerId && g.players[myPlayerId]?.city === null && g.order.includes(myPlayerId)) body = <StartPick {...props} me={myPlayerId} />
  else if (acting && myPlayerId) {
    if (g.stage === 'auction') body = <Bidding {...props} me={myPlayerId} />
    else if (g.stage === 'guildmaster') body = <GuildmasterMove {...props} me={myPlayerId} />
    else if (g.offer) body = <OfferResponse {...props} me={myPlayerId} />
    else if (g.raid) body = <RaidPrompt {...props} me={myPlayerId} />
    else if (g.turn) body = <TurnControls key={`${g.round}-${myPlayerId}`} {...props} me={myPlayerId} />
  }
  return (
    <Section title={<Title g={g} players={players} />}>
      {body}
      {g.stage === 'auction' && g.bids.length > 0 && <BidList g={g} players={players} />}
    </Section>
  )
}

function Title({ g, players }: { g: GameData; players: SeatInfo[] }) {
  switch (g.stage) {
    case 'start':
      return <>Choose your starting city</>
    case 'auction':
      return <>Round {g.round} · bidding for turn order</>
    case 'guildmaster':
      return <>Round {g.round} · the Guildmaster moves</>
    default:
      return (
        <>
          Round {g.round} · {g.turn ? `${nameOf(players, g.turn.playerId)}’s turn` : 'actions'}
          {g.raid && ' · raid'}
          {g.offer && ' · trade offer'}
        </>
      )
  }
}

function BidList({ g, players }: { g: GameData; players: SeatInfo[] }) {
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {g.bids.map((bid) => (
        <li key={bid.playerId} className="flex items-center gap-2">
          <span className="w-24 truncate">{nameOf(players, bid.playerId)}</span>
          {bid.markers ? (
            <>
              <span className="inline-flex gap-0.5">
                {bid.markers.map((m, i) => (
                  <Marker key={i} value={m} />
                ))}
              </span>
              <span className="text-neutral-400">{describeBid(bid.markers)}</span>
            </>
          ) : (
            <span className="text-neutral-500">could not bid</span>
          )}
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------- start

function StartPick({ state, submitting, onAction, me }: Props & { me: PlayerId }) {
  const g = state.game
  const mine = g.startPicks[me]
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="text-neutral-400">
        Secretly pick a route marker: your house and boat start in that city. If three or more players pick the same city, they pick again. {mine !== null && 'You can change your pick until everyone has picked.'}
        {g.startAttempt > 1 && ' (Picking again.)'}
      </p>
      <div className="flex flex-wrap gap-2">
        {CITIES.map((c) => {
          const full = g.cities[c.id].houses.length >= 2
          return (
            <button
              key={c.id}
              type="button"
              disabled={submitting || full || mine === c.id || g.players[me].markers[c.id] < 1}
              onClick={() => onAction({ type: 'START_PICK', playerId: me, attempt: g.startAttempt, value: c.id })}
              className={mine === c.id ? BTN_SELECTED : BTN}
            >
              {c.id} · {c.name}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- auction

function Bidding({ state, submitting, onAction, me }: Props & { me: PlayerId }) {
  const g = state.game
  const hand = g.players[me].markers
  const [bid, setBid] = useState<number[]>([])
  const taken = g.bids.flatMap((b) => (b.markers ? [b.markers] : []))
  const duplicate = taken.some((b) => sameBid(b, bid))
  const add = (v: number) => {
    if (bid.filter((m) => m === v).length < hand[v]) setBid([...bid, v].sort((a, b) => a - b))
  }
  const [isSet] = bid.length ? bidStrength(bid) : [0]
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="text-neutral-400">
        Bid one or more markers. Sets of identical markers (2+) beat any mix: bigger sets first, then higher numbers. Mixes compare by sum. You can’t repeat an earlier bid exactly. Bid markers feed goods to their cities.
      </p>
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-neutral-400">Your hand:</span>
        {hand.map((n, v) =>
          n > 0 ? (
            <button key={v} type="button" onClick={() => add(v)} disabled={submitting} className="disabled:opacity-50" title={`Add a ${v}`}>
              <Marker value={v} count={n - bid.filter((m) => m === v).length} />
            </button>
          ) : null,
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-neutral-400">Bid:</span>
        {bid.length === 0 ? <span className="text-neutral-500">click markers to add</span> : bid.map((m, i) => (
          <button key={i} type="button" onClick={() => setBid(bid.filter((_, k) => k !== i))} title="Remove">
            <Marker value={m} />
          </button>
        ))}
        {bid.length > 0 && <span className="text-neutral-400">{isSet ? 'set' : 'mix'} · {describeBid(bid)}</span>}
        {duplicate && <span className="text-red-400">already bid</span>}
      </div>
      <div>
        <button type="button" className={BTN_PRIMARY} disabled={submitting || bid.length === 0 || duplicate || !canBid(hand, taken)} onClick={() => onAction({ type: 'BID', playerId: me, markers: bid })}>
          Bid
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- Guildmaster

function GuildmasterMove({ state, submitting, onAction, me }: Props & { me: PlayerId }) {
  const g = state.game
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="text-neutral-400">You start this round: move the Guildmaster one or two cities clockwise (raided cities are skipped). It brings two goods to the city it stops in.</p>
      <div className="flex flex-wrap gap-2">
        {([1, 2] as const).map((steps) => {
          const path = guildmasterPath(g, steps)
          const dest = path.length ? path[path.length - 1] : g.guildmaster
          return (
            <button key={steps} type="button" className={BTN} disabled={submitting} onClick={() => onAction({ type: 'MOVE_GUILDMASTER', playerId: me, steps })}>
              {steps} → {cityLabel(dest)}
              {path.includes(g.guildmasterStart) && ' ⌛'}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- turn

/** Picks `count` goods or markers to pay a move with. */
function PaymentPicker({ g, me, count, label, value, onChange }: { g: GameData; me: PlayerId; count: number; label: string; value: Payment[]; onChange: (p: Payment[]) => void }) {
  const p = g.players[me]
  const usedGood = (c: Color) => value.filter((x) => x.kind === 'good' && x.color === c).length
  const usedMarker = (v: number) => value.filter((x) => x.kind === 'marker' && x.value === v).length
  const add = (pay: Payment) => value.length < count && onChange([...value, pay])
  return (
    <div className="flex flex-wrap items-center gap-1 text-sm">
      <span className="text-neutral-400">
        {label} — pick {count} good{count === 1 ? '' : 's'} or marker{count === 1 ? '' : 's'} ({value.length} chosen):
      </span>
      {COLORS.filter((c) => p.goods[c] - usedGood(c) > 0).map((c) => (
        <button key={c} type="button" className="inline-flex items-center gap-1 rounded border border-neutral-700 px-1.5 py-0.5" onClick={() => add({ kind: 'good', color: c })}>
          <GoodDot color={c} />
          {p.goods[c] - usedGood(c)}
        </button>
      ))}
      {p.markers.map((n, v) =>
        n - usedMarker(v) > 0 ? (
          <button key={v} type="button" onClick={() => add({ kind: 'marker', value: v })}>
            <Marker value={v} count={n - usedMarker(v)} />
          </button>
        ) : null,
      )}
      {value.length > 0 && (
        <button type="button" className="text-xs text-neutral-400 underline" onClick={() => onChange([])}>
          clear
        </button>
      )}
    </div>
  )
}

function TurnControls({ state, players, submitting, onAction, me }: Props & { me: PlayerId }) {
  const g = state.game
  const turn = g.turn!
  const p = g.players[me]
  const here = p.city!
  const city = g.cities[here]
  const [payments, setPayments] = useState<Payment[]>([])
  const used = (kind: string) => turn.used.includes(kind as never)
  const act = (action: GameAction) => {
    setPayments([])
    onAction(action)
  }
  const cost = moveCost(g, me, turn.moves, false)
  const passageCost = moveCost(g, me, turn.moves, true)
  const canPassage = p.bonuses.includes('passage') && g.guildmaster !== here && !g.cities[g.guildmaster].raids.includes(me)
  const neededPayments = Math.max(cost, canPassage ? passageCost : 0)
  const house = buildCost(here, city.houses.length)
  const boatsHere = g.order.filter((id) => id !== me && g.players[id].city === here)

  return (
    <div className="flex flex-col gap-4 text-sm">
      <p className="text-neutral-400">
        Your boat is in <b className="text-neutral-200">{cityLabel(here)}</b>. {turn.movementDone ? 'Movement is over: take actions, each once.' : `Moves made: ${turn.moves}. Your next move ${cost === 0 ? 'is free' : `costs ${cost}`}.`}
      </p>

      {!turn.movementDone && (
        <Group title="Sail">
          {neededPayments > 0 && <PaymentPicker g={g} me={me} count={neededPayments} label={cost > 0 ? 'Pay for this move' : 'Pay for the Secret Passage'} value={payments} onChange={setPayments} />}
          <div className="flex flex-wrap items-center gap-2">
            {city.routes.map((slot, i) => {
              const shown = visibleRoute(state, slot, me)
              const blocked = !slot.faceDown && g.cities[slot.value ?? 0].raids.includes(me)
              return (
                <button
                  key={i}
                  type="button"
                  className={BTN}
                  disabled={submitting || blocked || payments.length < cost}
                  onClick={() => act({ type: 'MOVE', playerId: me, route: i as 0 | 1, payments: payments.slice(0, cost) })}
                >
                  <span className="inline-flex items-center gap-1">
                    <Marker value={shown} faceDown={slot.faceDown} /> {shown === null ? 'face down — sail blind' : `→ ${CITIES[shown].name}`}
                    {blocked && ' (raided)'}
                  </span>
                </button>
              )
            })}
            {canPassage && (
              <button type="button" className={BTN} disabled={submitting || payments.length !== passageCost} onClick={() => act({ type: 'MOVE', playerId: me, route: 'passage', payments })}>
                Secret Passage → {CITIES[g.guildmaster].name} (costs {passageCost})
              </button>
            )}
            <button type="button" className={BTN} disabled={submitting} onClick={() => act({ type: 'END_MOVEMENT', playerId: me })}>
              Stop here
            </button>
          </div>
        </Group>
      )}

      <Group title="Actions">
        <Row label="Build a house" hint={`${Object.entries(house.goods).filter(([, n]) => n > 0).map(([c]) => c).join(', ')} + ${house.markers}× marker ${here}`}>
          <button type="button" className={BTN} disabled={submitting || used('build') || city.houses.length >= 2} onClick={() => act({ type: 'BUILD_HOUSE', playerId: me })}>
            Build
          </button>
          {city.houses.length >= 2 && <span className="text-neutral-500">city full</span>}
        </Row>
        {g.guildmaster === here && <GuildTradeRow g={g} me={me} disabled={submitting || used('guildmaster')} act={act} />}
        <BuyRoutesRow g={g} me={me} disabled={submitting || used('buyRoutes') || g.market.length === 0} act={act} />
        <CityTradeRow g={g} me={me} disabled={submitting || used('cityTrade') || !turn.moved} act={act} />
        <ChangeRouteRow state={state} me={me} disabled={submitting || used('changeRoute')} act={act} />
        <RaidRow g={g} me={me} players={players} boatsHere={boatsHere} disabled={submitting || used('raid') || p.raidMarkers < 1} act={act} />
        {boatsHere.length > 0 && <TradeOfferRow g={g} me={me} players={players} boatsHere={boatsHere} disabled={submitting} act={act} />}
      </Group>

      <div>
        <button type="button" className={BTN_PRIMARY} disabled={submitting} onClick={() => act({ type: 'END_TURN', playerId: me })}>
          End turn
        </button>
      </div>
    </div>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-neutral-800 p-3">
      <h3 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">{title}</h3>
      {children}
    </div>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-36 shrink-0 text-neutral-300">{label}</span>
      {children}
      {hint && <span className="text-xs text-neutral-500">{hint}</span>}
    </div>
  )
}

const SELECT = 'rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100 disabled:opacity-50'

function ColorSelect({ value, onChange, disabled, options = COLORS }: { value: Color; onChange: (c: Color) => void; disabled?: boolean; options?: readonly Color[] }) {
  return (
    <select className={SELECT} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as Color)}>
      {options.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  )
}

function MarkerSelect({ value, onChange, values, disabled }: { value: number; onChange: (v: number) => void; values: number[]; disabled?: boolean }) {
  return (
    <select className={SELECT} value={values.includes(value) ? value : ''} disabled={disabled || values.length === 0} onChange={(e) => onChange(Number(e.target.value))}>
      {values.length === 0 && <option value="">—</option>}
      {values.map((v) => (
        <option key={v} value={v}>
          {v} ({markerColor(v)})
        </option>
      ))}
    </select>
  )
}

type Act = (action: GameAction) => void

function GuildTradeRow({ g, me, disabled, act }: { g: GameData; me: PlayerId; disabled: boolean; act: Act }) {
  const p = g.players[me]
  const [kind, setKind] = useState<GuildTrade['kind']>('sellMarker')
  const [value, setValue] = useState(0)
  const [color, setColor] = useState<Color>('grey')
  const [bonus, setBonus] = useState<BonusType>(BONUS_TYPES.find((b) => g.bonusesAvailable[b] > 0) ?? 'trading')
  const held = p.markers.map((n, v) => [v, n]).filter(([, n]) => n > 0).map(([v]) => v)
  const values = kind === 'raidMarker' ? p.markers.map((n, v) => [v, n]).filter(([, n]) => n >= 3).map(([v]) => v) : kind === 'buyMarker' ? CITIES.map((c) => c.id).filter((v) => p.goods[markerColor(v)] > 0) : held
  const trade: GuildTrade = kind === 'bonus' ? { kind, color, bonus } : { kind, value }
  return (
    <Row label="Trade with the Guildmaster">
      <select className={SELECT} value={kind} disabled={disabled} onChange={(e) => setKind(e.target.value as GuildTrade['kind'])}>
        <option value="sellMarker">1 marker → 1 good of its colour</option>
        <option value="buyMarker">1 good → 1 marker of its colour</option>
        <option value="raidMarker" disabled={p.secondRaidTaken}>
          3 identical markers → 2nd Raid marker
        </option>
        <option value="bonus">6 goods of a colour → bonus marker</option>
      </select>
      {kind === 'bonus' ? (
        <>
          <ColorSelect value={color} onChange={setColor} disabled={disabled} />
          <select className={SELECT} value={bonus} disabled={disabled} onChange={(e) => setBonus(e.target.value as BonusType)}>
            {BONUS_TYPES.map((b) => (
              <option key={b} value={b} disabled={g.bonusesAvailable[b] < 1}>
                {BONUS_INFO[b].name} ({g.bonusesAvailable[b]} left)
              </option>
            ))}
          </select>
        </>
      ) : (
        <MarkerSelect value={value} onChange={setValue} values={values} disabled={disabled} />
      )}
      <button type="button" className={BTN} disabled={disabled || (kind !== 'bonus' && !values.includes(value))} onClick={() => act({ type: 'GUILD_TRADE', playerId: me, trade })}>
        Trade
      </button>
    </Row>
  )
}

function BuyRoutesRow({ g, me, disabled, act }: { g: GameData; me: PlayerId; disabled: boolean; act: Act }) {
  const owned = COLORS.filter((c) => g.players[me].goods[c] > 0)
  const [lot, setLot] = useState(0)
  const [color, setColor] = useState<Color>(owned[0] ?? 'grey')
  return (
    <Row label="Buy route markers" hint="one good for a lot">
      <select className={SELECT} value={lot} disabled={disabled} onChange={(e) => setLot(Number(e.target.value))}>
        {g.market.map((l, i) => (
          <option key={i} value={i}>
            Lot {i + 1}: {l.join(' + ')}
          </option>
        ))}
      </select>
      <ColorSelect value={color} onChange={setColor} disabled={disabled || owned.length === 0} options={owned.length ? owned : COLORS} />
      <button type="button" className={BTN} disabled={disabled || owned.length === 0 || lot >= g.market.length} onClick={() => act({ type: 'BUY_ROUTES', playerId: me, lot, payment: color })}>
        Buy
      </button>
    </Row>
  )
}

function CityTradeRow({ g, me, disabled, act }: { g: GameData; me: PlayerId; disabled: boolean; act: Act }) {
  const p = g.players[me]
  const count = p.bonuses.includes('trading') ? 3 : 2
  const owned = COLORS.filter((c) => p.goods[c] > 0)
  const [give, setGive] = useState<Color>(owned[0] ?? 'grey')
  const [take, setTake] = useState<Color[]>([])
  const here = g.cities[p.city!].goods
  const counts = (c: Color) => take.filter((t) => t === c).length
  return (
    <Row label="Trade with the city" hint={`1 good in, ${count} of other colours out · only after sailing`}>
      <span className="text-neutral-400">give</span>
      <ColorSelect value={give} onChange={(c) => { setGive(c); setTake(take.filter((t) => t !== c)) }} disabled={disabled} options={owned.length ? owned : COLORS} />
      <span className="text-neutral-400">take</span>
      {COLORS.filter((c) => c !== give && here[c] - counts(c) > 0).map((c) => (
        <button key={c} type="button" disabled={disabled || take.length >= count} className="inline-flex items-center gap-1 rounded border border-neutral-700 px-1.5 py-0.5 disabled:opacity-50" onClick={() => setTake([...take, c])}>
          <GoodDot color={c} /> +
        </button>
      ))}
      {take.length > 0 && (
        <button type="button" className="inline-flex items-center gap-1 text-xs text-neutral-400 underline" onClick={() => setTake([])}>
          {take.map((c, i) => <GoodDot key={i} color={c} />)} clear
        </button>
      )}
      <button type="button" className={BTN} disabled={disabled || owned.length === 0 || take.length !== count} onClick={() => { setTake([]); act({ type: 'CITY_TRADE', playerId: me, give, take }) }}>
        Trade
      </button>
    </Row>
  )
}

function ChangeRouteRow({ state, me, disabled, act }: { state: GameState; me: PlayerId; disabled: boolean; act: Act }) {
  const g = state.game
  const p = g.players[me]
  const here = p.city!
  const slots = ([0, 1] as const).filter((i) => !g.cities[here].routes[i].faceDown)
  const values = p.markers.map((n, v) => [v, n]).filter(([v, n]) => n > 0 && v !== here).map(([v]) => v)
  const [slot, setSlot] = useState<0 | 1>(slots[0] ?? 0)
  const [value, setValue] = useState(values[0] ?? 0)
  return (
    <Row label="Change a route" hint="your marker goes in face down">
      <select className={SELECT} value={slot} disabled={disabled || slots.length === 0} onChange={(e) => setSlot(Number(e.target.value) as 0 | 1)}>
        {slots.map((i) => (
          <option key={i} value={i}>
            take the {g.cities[here].routes[i].value}
          </option>
        ))}
      </select>
      <span className="text-neutral-400">place</span>
      <MarkerSelect value={value} onChange={setValue} values={values} disabled={disabled} />
      <button
        type="button"
        className={BTN}
        disabled={disabled || !slots.includes(slot) || !values.includes(value)}
        onClick={() => act({ type: 'CHANGE_ROUTE', playerId: me, slot, value, placementId: g.nextPlacementId })}
      >
        Exchange
      </button>
    </Row>
  )
}

function RaidRow({ g, me, players, boatsHere, disabled, act }: { g: GameData; me: PlayerId; players: SeatInfo[]; boatsHere: PlayerId[]; disabled: boolean; act: Act }) {
  const victims = boatsHere.filter((id) => goodsTotal(g.players[id].goods) > 0)
  const [target, setTarget] = useState('city')
  return (
    <Row label="Raid" hint="places a Raid marker for good, then your boat is sent on and your turn ends">
      <select className={SELECT} value={target} disabled={disabled} onChange={(e) => setTarget(e.target.value)}>
        <option value="city">all goods in the city</option>
        {victims.map((id) => (
          <option key={id} value={id}>
            half of {nameOf(players, id)}’s goods
          </option>
        ))}
      </select>
      <button
        type="button"
        className="rounded-md border border-red-800 px-3 py-1.5 text-sm text-red-300 hover:border-red-500 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled || (target !== 'city' && !victims.includes(target))}
        onClick={() => act({ type: 'RAID', playerId: me, target: target === 'city' ? { kind: 'city' } : { kind: 'player', victim: target } })}
      >
        Raid
      </button>
    </Row>
  )
}

function GoodsStepper({ value, onChange, max }: { value: Goods; onChange: (g: Goods) => void; max?: Goods }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {COLORS.map((c) => (
        <label key={c} className="inline-flex items-center gap-1">
          <GoodDot color={c} />
          <input
            type="number"
            min={0}
            max={max?.[c]}
            value={value[c]}
            onChange={(e) => onChange({ ...value, [c]: Math.max(0, Math.min(max?.[c] ?? 99, Math.trunc(Number(e.target.value)) || 0)) })}
            className="w-12 rounded border border-neutral-700 bg-neutral-900 px-1 py-0.5 text-center"
          />
        </label>
      ))}
    </span>
  )
}

function parseMarkers(text: string): number[] {
  return text
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map(Number)
    .filter((n) => n >= 0 && n <= 8)
}

function TradeOfferRow({ g, me, players, boatsHere, disabled, act }: { g: GameData; me: PlayerId; players: SeatInfo[]; boatsHere: PlayerId[]; disabled: boolean; act: Act }) {
  const [to, setTo] = useState(boatsHere[0])
  const [give, setGive] = useState(noGoods())
  const [get, setGet] = useState(noGoods())
  const [giveMarkers, setGiveMarkers] = useState('')
  const [getMarkers, setGetMarkers] = useState('')
  return (
    <div className="flex flex-col gap-2 rounded border border-neutral-800 p-2">
      <Row label="Offer a trade">
        <select className={SELECT} value={to} onChange={(e) => setTo(e.target.value)}>
          {boatsHere.map((id) => (
            <option key={id} value={id}>
              {nameOf(players, id)}
            </option>
          ))}
        </select>
      </Row>
      <Row label="You give">
        <GoodsStepper value={give} onChange={setGive} max={g.players[me].goods} />
        <input placeholder="markers, e.g. 3 5" value={giveMarkers} onChange={(e) => setGiveMarkers(e.target.value)} className={`${SELECT} w-36`} />
      </Row>
      <Row label="You get">
        <GoodsStepper value={get} onChange={setGet} max={g.players[to]?.goods} />
        <input placeholder="markers, e.g. 7" value={getMarkers} onChange={(e) => setGetMarkers(e.target.value)} className={`${SELECT} w-36`} />
      </Row>
      <div>
        <button
          type="button"
          className={BTN}
          disabled={disabled || !to}
          onClick={() => act({ type: 'PROPOSE_TRADE', playerId: me, to, give: { goods: give, markers: parseMarkers(giveMarkers) }, get: { goods: get, markers: parseMarkers(getMarkers) } })}
        >
          Offer
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- prompts for other players

function OfferResponse({ state, players, submitting, onAction, me }: Props & { me: PlayerId }) {
  const offer = state.game.offer!
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p>
        {nameOf(players, offer.from)} offers you{' '}
        <GoodsList goods={offer.give.goods} empty="no goods" /> {offer.give.markers.length > 0 && <>and markers {offer.give.markers.join(', ')}</>} in exchange for{' '}
        <GoodsList goods={offer.get.goods} empty="no goods" /> {offer.get.markers.length > 0 && <>and markers {offer.get.markers.join(', ')}</>}.
      </p>
      <div className="flex gap-2">
        <button type="button" className={BTN_PRIMARY} disabled={submitting} onClick={() => onAction({ type: 'RESPOND_TRADE', playerId: me, accept: true })}>
          Accept
        </button>
        <button type="button" className={BTN} disabled={submitting} onClick={() => onAction({ type: 'RESPOND_TRADE', playerId: me, accept: false })}>
          Decline
        </button>
      </div>
    </div>
  )
}

function RaidPrompt({ state, players, submitting, onAction, me }: Props & { me: PlayerId }) {
  const g = state.game
  const raid = g.raid!
  const [group, setGroup] = useState(noGoods())
  if (raid.step === 'divide') {
    const own = g.players[me].goods
    const size = goodsTotal(group)
    const ok = Math.abs(2 * size - goodsTotal(own)) <= 1
    const rest = { ...own }
    for (const c of COLORS) rest[c] -= group[c]
    return (
      <div className="flex flex-col gap-2 text-sm">
        <p>{nameOf(players, raid.raider)} is raiding you. Split your goods into two groups as equal in size as possible; they take one.</p>
        <Row label="Group A">
          <GoodsStepper value={group} onChange={setGroup} max={own} />
        </Row>
        <Row label="Group B">
          <GoodsList goods={rest} />
        </Row>
        <div>
          <button type="button" className={BTN_PRIMARY} disabled={submitting || !ok} onClick={() => onAction({ type: 'RAID_DIVIDE', playerId: me, group })}>
            Split
          </button>
        </div>
      </div>
    )
  }
  if (raid.step === 'take') {
    return (
      <div className="flex flex-col gap-2 text-sm">
        <p>Take one of {nameOf(players, raid.victim)}’s groups:</p>
        <div className="flex gap-2">
          {raid.groups.map((goods, i) => (
            <button key={i} type="button" className={BTN} disabled={submitting} onClick={() => onAction({ type: 'RAID_TAKE', playerId: me, group: i as 0 | 1 })}>
              <GoodsList goods={goods} empty="nothing" />
            </button>
          ))}
        </div>
      </div>
    )
  }
  const routes = g.cities[raid.city].routes
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p>Choose where {nameOf(players, raid.raider)}’s boat is sent after the raid on {cityLabel(raid.city)}:</p>
      <div className="flex gap-2">
        {routes.map((slot, i) => {
          const shown = visibleRoute(state, slot, me)
          return (
            <button key={i} type="button" className={BTN} disabled={submitting} onClick={() => onAction({ type: 'RAID_ROUTE', playerId: me, route: i as 0 | 1 })}>
              <span className="inline-flex items-center gap-1">
                <Marker value={shown} faceDown={slot.faceDown} /> {shown === null ? 'face down' : `→ ${CITIES[shown].name}`}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

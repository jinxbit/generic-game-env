import type { TerritoryControlMode, TurnReviewControls } from './useTurnReview.ts'

const TERRITORY_CONTROL_MODES: { mode: TerritoryControlMode; label: string; title: string }[] = [
  { mode: 'off', label: 'Territory: off', title: 'Territory control is hidden. Click to outline every region a player currently controls, like the victory screen.' },
  {
    mode: 'on',
    label: 'Territory: on',
    title: 'Outlining every region currently under a player’s control, like the victory screen. Click to outline only what changed since the previous step instead.',
  },
  {
    mode: 'changes',
    label: 'Territory: changes',
    title: 'Outlining only the regions whose control changed since the previous step — a region that turned neutral is striped black-and-white. Click to hide territory control.',
  },
]

/**
 * Icon for the live territory-control toggle (issue #665): three small
 * hexes connected as a triangle, standing in for the "Territory: on/off"
 * text label the button used to carry. State reads from `currentColor`
 * alone — the button's own text/border color already flips between amber
 * (on) and neutral (off), so the icon needs no color logic of its own.
 */
function TerritoryTriangleIcon() {
  const r = 4.4
  const sqrt3 = Math.sqrt(3)
  const centers = [
    { x: 0, y: -r },
    { x: -r * (sqrt3 / 2), y: r / 2 },
    { x: r * (sqrt3 / 2), y: r / 2 },
  ]
  const hexPoints = (cx: number, cy: number) =>
    Array.from({ length: 6 }, (_, i) => {
      const angle = (Math.PI / 180) * (60 * i - 90)
      return `${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`
    }).join(' ')
  return (
    <svg width="16" height="16" viewBox="-9 -9 18 18" aria-hidden="true">
      {centers.map((c, i) => (
        <polygon key={i} points={hexPoints(c.x, c.y)} fill="currentColor" fillOpacity={0.85} stroke="currentColor" strokeWidth={0.6} />
      ))}
    </svg>
  )
}

/**
 * The game view's own controls above the board — what the standalone app
 * had in its game page header and review banner that the platform's shell
 * doesn't provide: "Show history" (the turn-by-turn review, ./useTurnReview.ts)
 * with its Prev/Next/slider and territory-mode switch, and the live
 * territory-control toggle (issue #656).
 */
export function GameToolbar(props: {
  turnReview: TurnReviewControls
  /** Offer "Show history" (not during board setup, where there's little to review and the setup view has no review mode). */
  showReview: boolean
  /** Offer the live territory toggle (only mid-round: the victory screen always outlines territory). */
  showTerritoryToggle: boolean
  liveTerritoryControlOn: boolean
  onToggleLiveTerritoryControl: () => void
}) {
  const { turnReview, liveTerritoryControlOn, onToggleLiveTerritoryControl, showReview, showTerritoryToggle } = props
  const review = turnReview.review

  if (turnReview.open) {
    const current = TERRITORY_CONTROL_MODES.find((m) => m.mode === turnReview.territoryControlMode) ?? TERRITORY_CONTROL_MODES[0]
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-amber-700/40 bg-amber-500/10 p-3 text-sm text-amber-200">
        <span className="font-medium">Reviewing history</span>
        <button
          type="button"
          onClick={() => {
            const index = TERRITORY_CONTROL_MODES.indexOf(current)
            turnReview.setTerritoryControlMode(TERRITORY_CONTROL_MODES[(index + 1) % TERRITORY_CONTROL_MODES.length].mode)
          }}
          title={current.title}
          className={`rounded-md border px-2 py-0.5 hover:border-amber-400 ${current.mode === 'off' ? 'border-amber-700/60' : 'border-amber-500 bg-amber-500/10 text-amber-300'}`}
        >
          {current.label}
        </button>
        {review ? (
          <>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={!review.canPrev}
                onClick={turnReview.prev}
                title="Step back one turn."
                className="rounded-md border border-amber-700/60 px-2 py-0.5 hover:border-amber-400 disabled:opacity-40"
              >
                ← Prev
              </button>
              <input
                type="range"
                min={0}
                max={review.stopCount}
                value={review.position}
                onChange={(e) => turnReview.goTo(Number(e.target.value))}
                aria-label="Turn"
                className="w-40"
              />
              <button
                type="button"
                disabled={!review.canNext}
                onClick={turnReview.next}
                title="Step forward one turn."
                className="rounded-md border border-amber-700/60 px-2 py-0.5 hover:border-amber-400 disabled:opacity-40"
              >
                Next →
              </button>
            </div>
            <span>{review.label}</span>
          </>
        ) : (
          <span>This game&apos;s history can&apos;t be replayed here.</span>
        )}
        <button type="button" onClick={turnReview.exit} className="ml-auto rounded-md border border-amber-700/60 px-3 py-1 font-medium hover:border-amber-400">
          Back to live
        </button>
      </div>
    )
  }

  const offerReview = showReview && turnReview.available
  if (!offerReview && !showTerritoryToggle) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      {offerReview && (
        <button
          type="button"
          onClick={turnReview.start}
          title="Step through the game's history turn by turn, starting right after your own last turn so you can review what every opponent did since. This never touches the game itself."
          className="rounded-md border border-neutral-700 px-3 py-1 text-sm hover:border-neutral-500"
        >
          Show history
        </button>
      )}
      {showTerritoryToggle && (
        <button
          type="button"
          onClick={onToggleLiveTerritoryControl}
          title={liveTerritoryControlOn ? 'Territory control is shown. Click to hide it.' : 'Outline every region a player currently controls on the map, the same way the victory screen does.'}
          aria-pressed={liveTerritoryControlOn}
          aria-label={liveTerritoryControlOn ? 'Hide territory control' : 'Show territory control'}
          className={`rounded-md border p-1.5 hover:border-neutral-500 ${liveTerritoryControlOn ? 'border-amber-500 bg-amber-500/10 text-amber-300' : 'border-neutral-700 text-neutral-400'}`}
        >
          <TerritoryTriangleIcon />
        </button>
      )}
    </div>
  )
}

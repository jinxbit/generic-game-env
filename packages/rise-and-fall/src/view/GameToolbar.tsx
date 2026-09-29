import type { TerritoryControlMode } from './useStepExplanation.ts'

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
 * The game view's own controls above the board: the territory-control
 * overlay. Live, a toggle (issue #656); while the platform's history review
 * is open, a three-way switch between off, every controlled region, and only
 * the regions whose control changed in the reviewed step. Stepping through
 * history itself is the platform's (its review bar), not the game's.
 */
export function GameToolbar(props: {
  /** Whether history review is showing a step (GameViewProps.review). */
  reviewing: boolean
  territoryControlMode: TerritoryControlMode
  onTerritoryControlModeChange: (mode: TerritoryControlMode) => void
  /** Offer the live territory toggle (only mid-round: the victory screen always outlines territory). */
  showTerritoryToggle: boolean
  liveTerritoryControlOn: boolean
  onToggleLiveTerritoryControl: () => void
}) {
  const { reviewing, territoryControlMode, onTerritoryControlModeChange, liveTerritoryControlOn, onToggleLiveTerritoryControl, showTerritoryToggle } = props

  if (reviewing) {
    const current = TERRITORY_CONTROL_MODES.find((m) => m.mode === territoryControlMode) ?? TERRITORY_CONTROL_MODES[0]
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            const index = TERRITORY_CONTROL_MODES.indexOf(current)
            onTerritoryControlModeChange(TERRITORY_CONTROL_MODES[(index + 1) % TERRITORY_CONTROL_MODES.length].mode)
          }}
          title={current.title}
          className={`rounded-md border px-2 py-0.5 text-sm hover:border-amber-400 ${current.mode === 'off' ? 'border-neutral-700' : 'border-amber-500 bg-amber-500/10 text-amber-300'}`}
        >
          {current.label}
        </button>
      </div>
    )
  }

  if (!showTerritoryToggle) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
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
    </div>
  )
}

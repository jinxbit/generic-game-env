import { useMemo } from 'react'
import { listMapTemplates, resolveMapTemplateBoard } from '../content/resolveContent.ts'
import type { GameOptions, MapMode } from '../types.ts'
import { HexBoard } from './HexBoard.tsx'

const MODES: Array<{ value: MapMode; title: string; description: string }> = [
  { value: 'together', title: 'Build together', description: 'Build the map together interactively once the game starts.' },
  {
    value: 'solo',
    title: 'Build alone',
    description:
      'One player builds the map by themselves, interactively, once the game starts — everyone else just waits for them to finish. Starting units are still placed by each player individually, same as always.',
  },
  { value: 'template', title: 'Pre-made map', description: 'Play on a hand-made map — tile placement is skipped, and the game starts with starting-unit placement.' },
]

type MapOptions = Pick<GameOptions, 'mapMode' | 'mapTemplateId' | 'soloBuilder' | 'soloBuilderUnitOrder'>

/**
 * How a game's map is made (GameOptions.mapMode, ../types.ts) — one of three
 * mutually exclusive modes:
 *
 * - "together": no board is picked; every seated player takes turns placing
 *   tiles, then starting units, once the game starts.
 * - "solo": one player builds the map's tiles alone, interactively, when the
 *   game starts. Starting *unit* placement is unaffected — every player still
 *   places their own (see `soloBuilder`/`soloBuilderUnitOrder` for this
 *   mode's own sub-options, resolved at setup, ../rules.ts's resolveSeating).
 * - "template": a pre-made map from content/mapTemplates.json, previewed
 *   here, skipping tile placement entirely.
 *
 * The standalone app also offered maps saved by players to a database pool
 * ("Prebuilt"/"Blind"); the platform has no such table, so those are gone.
 */
export function MapModeSelector(props: { value: MapOptions; onChange: (value: MapOptions) => void; disabled?: boolean }) {
  const { value, onChange, disabled = false } = props
  const templates = listMapTemplates()
  const previewBoard = useMemo(() => (value.mapMode === 'template' && value.mapTemplateId ? resolveMapTemplateBoard(value.mapTemplateId) : null), [value.mapMode, value.mapTemplateId])

  function handleModeChange(next: MapMode) {
    if (next === 'template') {
      onChange({ ...value, mapMode: next, mapTemplateId: value.mapTemplateId ?? templates[0]?.id ?? null })
    } else {
      onChange({ ...value, mapMode: next, mapTemplateId: null })
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-neutral-800 p-3 text-left">
      <h3 className="text-sm font-medium text-neutral-400">Map</h3>
      <div className="flex flex-col gap-2">
        {MODES.filter((option) => option.value !== 'template' || templates.length > 0).map((option) => (
          <label
            key={option.value}
            className={`flex cursor-pointer items-start gap-2 rounded-md border p-3 transition-colors ${
              value.mapMode === option.value ? 'border-indigo-500 bg-indigo-500/10' : 'border-neutral-700 hover:border-neutral-500'
            }`}
          >
            <input
              type="radio"
              name="map-mode"
              checked={value.mapMode === option.value}
              disabled={disabled}
              onChange={() => handleModeChange(option.value)}
              className="mt-1 h-4 w-4 border-neutral-700 bg-neutral-900"
            />
            <div>
              <div className="font-medium">{option.title}</div>
              <div className="text-sm text-neutral-400">{option.description}</div>
            </div>
          </label>
        ))}
      </div>

      {value.mapMode === 'solo' && (
        <div className="flex flex-col gap-4 pl-6">
          <div>
            <p className="mb-1.5 text-sm text-neutral-400">Who builds</p>
            <div className="flex flex-col gap-1.5">
              {(
                [
                  { value: 'host', label: 'Room creator' },
                  { value: 'random', label: 'A random seated player' },
                ] as const
              ).map((option) => (
                <label key={option.value} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="solo-builder-selection"
                    checked={value.soloBuilder === option.value}
                    disabled={disabled}
                    onChange={() => onChange({ ...value, soloBuilder: option.value })}
                    className="h-4 w-4 border-neutral-700 bg-neutral-900"
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-sm text-neutral-400">Builder&apos;s starting-unit placement turn</p>
            <div className="flex flex-col gap-1.5">
              {(
                [
                  { value: 'last', label: 'Goes last' },
                  { value: 'random', label: 'Random, same as everyone else' },
                ] as const
              ).map((option) => (
                <label key={option.value} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="solo-builder-unit-order"
                    checked={value.soloBuilderUnitOrder === option.value}
                    disabled={disabled}
                    onChange={() => onChange({ ...value, soloBuilderUnitOrder: option.value })}
                    className="h-4 w-4 border-neutral-700 bg-neutral-900"
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {value.mapMode === 'template' && (
        <div className="flex flex-col gap-3 pl-6">
          <label className="flex flex-col gap-1 text-sm text-neutral-400">
            Map
            <select
              value={value.mapTemplateId ?? ''}
              disabled={disabled}
              onChange={(e) => onChange({ ...value, mapTemplateId: e.target.value || null })}
              className="max-w-xs rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-100"
            >
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </label>
          {value.mapTemplateId && <p className="text-xs text-neutral-500">{templates.find((t) => t.id === value.mapTemplateId)?.description}</p>}
          {previewBoard && (
            <div className="max-w-[220px]">
              <HexBoard board={previewBoard} size={10} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

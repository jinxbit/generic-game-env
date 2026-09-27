import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ErrorBanner } from '../components/ErrorBanner'
import { PlayModeSelector } from '../components/PlayModeSelector'
import { game as gameDefinition } from '../engine/game'
import { GameOptionsEditor } from '../game/GameOptionsEditor'
import type { GameOptions } from '../game/types'
import { useAuth } from '../hooks/useAuth'
import { useDisplayName } from '../hooks/useDisplayName'
import { createGame, MAX_PLAYERS } from '../lib/gameApi'
import { hiddenInformationAvailable as computeHiddenInformationAvailable } from '../lib/hiddenInformationEligibility'
import { randomRoomName } from '../lib/randomRoomName'
import { toAppError, type AppError } from '../lib/errors'
import type { PlayMode } from '../engine/types'

// Rule enforcement and hidden information are both on for every game
// created through this page — there is no creator-facing opt-out. See
// CLAUDE.md's "two write paths" section: the client-trusted path and
// hiddenInformationEnabled: false still exist for other callers (tests,
// imports), so createGame()'s own defaults are unchanged.
const RULE_ENFORCEMENT_ENABLED = true

/** Seats the game allows, capped by how many distinct player colours there are. */
const MAX_SEATS = Math.min(gameDefinition.maxPlayers, MAX_PLAYERS)

export function CreateGamePage() {
  const { session, loading } = useAuth()
  const { displayName, loading: displayNameLoading } = useDisplayName(session?.user ?? null)
  const navigate = useNavigate()

  const [name, setName] = useState(() => randomRoomName())
  const [playMode, setPlayMode] = useState<PlayMode>('async')
  const [skipHotseatPassGate, setSkipHotseatPassGate] = useState(true)
  const [gameOptions, setGameOptions] = useState<GameOptions>(gameDefinition.defaultOptions)
  const [minPlayersInput, setMinPlayersInput] = useState(String(gameDefinition.minPlayers))
  const [maxPlayersInput, setMaxPlayersInput] = useState(String(MAX_SEATS))
  const [visibility, setVisibility] = useState<'public' | 'private'>('public')
  const [error, setError] = useState<AppError | null>(null)
  const [busy, setBusy] = useState(false)

  const minPlayers = Number(minPlayersInput)
  const maxPlayers = Number(maxPlayersInput)
  const minPlayersValid = /^\d+$/.test(minPlayersInput.trim()) && minPlayers >= gameDefinition.minPlayers
  const maxPlayersValid = /^\d+$/.test(maxPlayersInput.trim()) && maxPlayers >= 1 && maxPlayers <= MAX_SEATS
  const playerCountValid = minPlayersValid && maxPlayersValid && maxPlayers >= minPlayers
  const playerCountError = !minPlayersValid
    ? `Min players must be a whole number of at least ${gameDefinition.minPlayers}.`
    : !maxPlayersValid
      ? `Max players must be a whole number between 1 and ${MAX_SEATS}.`
      : maxPlayers < minPlayers
        ? `Max players can't be lower than min players.`
        : null

  // Rule enforcement is always on (see RULE_ENFORCEMENT_ENABLED above), so
  // this is unavailable only for hotseat (src/lib/hiddenInformationEligibility.ts).
  const hiddenInformationAvailable = computeHiddenInformationAvailable(playMode, RULE_ENFORCEMENT_ENABLED)

  if (loading) {
    return <div className="p-8 text-neutral-400">Loading…</div>
  }

  if (!session) {
    return (
      <div className="p-8 text-neutral-400">
        <Link to="/" className="underline hover:text-neutral-200">
          Sign in
        </Link>{' '}
        to create a game.
      </div>
    )
  }

  const user = session.user
  const avatarUrl = (user.user_metadata?.avatar_url as string | undefined) ?? null

  async function handleCreate() {
    setError(null)
    setBusy(true)
    try {
      const { game } = await createGame({
        name,
        playMode,
        userId: user.id,
        displayName,
        avatarUrl,
        gameOptions,
        skipHotseatPassGate,
        ruleEnforcementEnabled: RULE_ENFORCEMENT_ENABLED,
        hiddenInformationEnabled: hiddenInformationAvailable,
        minPlayers,
        maxPlayers,
        visibility,
      })
      navigate(`/lobby/${game.room_code}`)
    } catch (err) {
      setError(toAppError(err, 'Failed to create game'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6 p-8">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Create a game</h1>
        <Link to="/" className="text-sm underline hover:text-neutral-200">
          Home
        </Link>
      </header>

      {error && <ErrorBanner message={error.message} details={error.details} onDismiss={() => setError(null)} />}

      <section className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm text-neutral-400">
          Room name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Friday night showdown"
            maxLength={60}
            className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-neutral-100"
          />
        </label>
        <p className="text-xs text-neutral-500">Choose carefully — the room name can&apos;t be changed later.</p>
        <PlayModeSelector value={playMode} onChange={setPlayMode} />
        {playMode === 'hotseat' && (
          <label className="flex items-center gap-2 text-sm text-neutral-400">
            <input
              type="checkbox"
              checked={skipHotseatPassGate}
              onChange={(e) => setSkipHotseatPassGate(e.target.checked)}
              className="h-4 w-4 rounded border-neutral-700 bg-neutral-900"
            />
            Don&apos;t show a &quot;pass the device&quot; message every turn
          </label>
        )}
        <h3 className="text-sm font-medium text-neutral-400">Game options</h3>
        <GameOptionsEditor value={gameOptions} onChange={setGameOptions} />
        <h3 className="text-sm font-medium text-neutral-400">Players</h3>
        <div className="flex gap-4">
          <label className="flex flex-col gap-1 text-sm text-neutral-400">
            Min players
            <input
              type="number"
              inputMode="numeric"
              value={minPlayersInput}
              onChange={(e) => setMinPlayersInput(e.target.value)}
              className={`w-14 rounded-md border bg-neutral-900 px-3 py-2 text-center text-neutral-100 ${
                minPlayersValid ? 'border-neutral-700' : 'border-red-500'
              }`}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-neutral-400">
            Max players
            <input
              type="number"
              inputMode="numeric"
              value={maxPlayersInput}
              onChange={(e) => setMaxPlayersInput(e.target.value)}
              className={`w-14 rounded-md border bg-neutral-900 px-3 py-2 text-center text-neutral-100 ${
                maxPlayersValid && maxPlayers >= minPlayers ? 'border-neutral-700' : 'border-red-500'
              }`}
            />
          </label>
        </div>
        {playerCountError && <p className="text-sm text-red-400">{playerCountError}</p>}
        <label className="flex items-center gap-2 text-sm text-neutral-400">
          <input
            type="checkbox"
            checked={visibility === 'public'}
            onChange={(e) => setVisibility(e.target.checked ? 'public' : 'private')}
            className="h-4 w-4 rounded border-neutral-700 bg-neutral-900"
          />
          List this room on the Public rooms screen
        </label>
        <button
          disabled={busy || displayNameLoading || name.trim().length === 0 || !playerCountValid}
          onClick={() => void handleCreate()}
          className="rounded-md bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {displayNameLoading ? 'Loading…' : 'Create game'}
        </button>
      </section>
    </div>
  )
}

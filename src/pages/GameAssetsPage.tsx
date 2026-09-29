// The asset library for one game and asset kind (/assets/:gameType/:kind) —
// e.g. Rise & Fall's saved maps: every public one plus your own (every one,
// for a site admin), each with the game's preview; create a new one with the
// game's editor, rename or delete your own, and — admins only — publish one
// to the public pool that "a random <kind>" is drawn from at Start
// (supabase/migrations/0003_game_assets.sql).
//
// Game-agnostic: what an asset is, how it renders and how it's built all come
// from the game (GameDefinition.assetKinds, GameUi.assetKinds).

import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { findGameDefinition } from '@game-platform/sdk'
import { ErrorBanner } from '../components/ErrorBanner'
import { gameUiFor } from '../games/ui'
import { useAuth } from '../hooks/useAuth'
import { useIsAdmin } from '../hooks/useIsAdmin'
import type { GameAssetRow } from '../lib/dbTypes'
import { toAppError, type AppError } from '../lib/errors'
import { createGameAsset, deleteGameAsset, listGameAssets, updateGameAsset } from '../lib/gameApi'

export function GameAssetsPage() {
  const { gameType = '', kind = '' } = useParams()
  const { session, loading } = useAuth()
  const isAdmin = useIsAdmin(session?.user ?? null)
  const definition = findGameDefinition(gameType)
  const assetKind = definition?.assetKinds?.[kind] ?? null
  const kindUi = gameUiFor(gameType)?.assetKinds?.[kind] ?? null
  const [assets, setAssets] = useState<GameAssetRow[] | null>(null)
  const [error, setError] = useState<AppError | null>(null)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<unknown>(null)
  const [draftName, setDraftName] = useState('')
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    try {
      setAssets(await listGameAssets({ gameType, kind }))
    } catch (err) {
      setError(toAppError(err, 'Failed to load'))
    }
  }, [gameType, kind])

  useEffect(() => {
    if (session && assetKind) void load()
  }, [session, assetKind, load])

  if (loading) return <div className="p-8 text-neutral-400">Loading…</div>
  if (!session) {
    return (
      <div className="p-8 text-neutral-400">
        <Link to="/" className="underline hover:text-neutral-200">
          Sign in
        </Link>{' '}
        to see saved assets.
      </div>
    )
  }
  if (!definition || !assetKind) {
    return <div className="p-8 text-neutral-400">This site has no such game or asset kind.</div>
  }

  const userId = session.user.id
  const label = assetKind.label.toLowerCase()
  const Preview = kindUi?.Preview
  const Editor = kindUi?.Editor

  async function run(what: string, action: () => Promise<unknown>) {
    setError(null)
    setBusy(true)
    try {
      await action()
      await load()
    } catch (err) {
      setError(toAppError(err, what))
    } finally {
      setBusy(false)
    }
  }

  function saveDraft() {
    void run(`Failed to save the ${label}`, async () => {
      await createGameAsset({ gameType, kind, name: draftName, data: draft, userId })
      setCreating(false)
      setDraft(null)
      setDraftName('')
    })
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">
          {definition.title}: saved {label}s
        </h1>
        <Link to="/" className="text-sm underline hover:text-neutral-200">
          Home
        </Link>
      </header>
      {assetKind.description && <p className="text-sm text-neutral-400">{assetKind.description}</p>}
      <p className="text-sm text-neutral-500">
        Pick one when you create a room, or let the game pick a public one at random when it starts.
        {isAdmin ? ' As a site admin, you choose which ones are public.' : ' Yours are private; a site admin can make one public.'}
      </p>

      {error && <ErrorBanner message={error.message} details={error.details} onDismiss={() => setError(null)} />}

      {Editor && !creating && (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="self-start rounded-md bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-500"
        >
          New {label}
        </button>
      )}

      {Editor && creating && (
        <section className="flex flex-col gap-3 rounded-md border border-neutral-800 p-4">
          <h2 className="font-medium text-neutral-200">New {label}</h2>
          <Editor value={(draft ?? null) as never} onChange={(value: unknown) => setDraft(value)} disabled={busy} />
          {draft !== null && (
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-sm text-neutral-400">
                Name
                <input
                  value={draftName}
                  maxLength={80}
                  onChange={(e) => setDraftName(e.target.value)}
                  className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-neutral-100"
                />
              </label>
              <button
                type="button"
                disabled={busy || draftName.trim().length === 0}
                onClick={saveDraft}
                className="rounded-md bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                Save {label}
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={() => {
              setCreating(false)
              setDraft(null)
            }}
            className="self-start text-sm underline hover:text-neutral-200"
          >
            Cancel
          </button>
        </section>
      )}

      {assets === null ? (
        <p className="text-neutral-400">Loading…</p>
      ) : assets.length === 0 ? (
        <p className="text-neutral-400">No saved {label}s yet.</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {assets.map((asset) => {
            const mine = asset.created_by === userId
            const data = assetKind.normalize(asset.data)
            return (
              <li key={asset.id} className="flex flex-col gap-2 rounded-md border border-neutral-800 p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium text-neutral-200">{asset.name}</span>
                  <span className="text-xs text-neutral-500">
                    {asset.visibility === 'public' ? 'Public' : mine ? 'Yours · private' : 'Private'}
                  </span>
                </div>
                {Preview && data !== null ? <Preview data={data} /> : data === null && <p className="text-xs text-red-400">Not a valid {label} for this game any more.</p>}
                <p className="text-xs text-neutral-500">
                  {asset.min_players === asset.max_players ? `${asset.min_players} players` : `${asset.min_players}–${asset.max_players} players`}
                </p>
                <div className="flex flex-wrap gap-3 text-sm">
                  {(mine || isAdmin) && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        const name = window.prompt(`Rename this ${label}`, asset.name)
                        if (name !== null) void run('Failed to rename', () => updateGameAsset(asset, { name }))
                      }}
                      className="text-indigo-400 hover:text-indigo-300 disabled:opacity-50"
                    >
                      Rename
                    </button>
                  )}
                  {isAdmin && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void run('Failed to update', () => updateGameAsset(asset, { visibility: asset.visibility === 'public' ? 'private' : 'public' }))}
                      className="text-indigo-400 hover:text-indigo-300 disabled:opacity-50"
                    >
                      {asset.visibility === 'public' ? 'Make private' : 'Make public'}
                    </button>
                  )}
                  {(mine || isAdmin) && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm(`Delete "${asset.name}"? Rooms already set up with it keep their copy.`)) void run('Failed to delete', () => deleteGameAsset(asset.id))
                      }}
                      className="text-red-400 hover:text-red-300 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

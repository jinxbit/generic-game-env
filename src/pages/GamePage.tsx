import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChatPanel } from '../components/ChatPanel'
import { ErrorBanner } from '../components/ErrorBanner'
import { GameLogPanel } from '../components/GameLogPanel'
import { applyAction, buildGameLog, findGameDefinition, redactGameLog, replayActions, currentActorId, applyRedoAction, applyUndoAction, buildGameLogFromViewerEntries, isUndoLockedByReveal, resolveHistory, moveReviewStops, nextStop, previousStop, sinceLastTurnStop, turnReviewStops, type ViewerLogEntry, type Action, type ActionResult, type GameState as EngineGameState } from '@game-platform/sdk'
import { gameUiFor } from '../games/ui'
import { useAuth } from '../hooks/useAuth'
import { useIsAdmin } from '../hooks/useIsAdmin'
import { useRefetchOnVisible } from '../hooks/useRefetchOnVisible'
import { useTrafficStats } from '../hooks/useTrafficStats'
import { formatUnreadBadge, isChatEnabled } from '../lib/chatApi'
import type { GameRow, PlayerRow } from '../lib/dbTypes'
import { buildDeltaReplayContextFromState } from '../lib/deltaReplayContext'
import { simpleError, toAppError, type AppError } from '../lib/errors'
import { buildGenesisState } from '../lib/gameGenesis'
import { cryptoRandomSource } from '../lib/randomSource'
import { isViewLogState, viewLogReviewState, type ViewLogHistory } from '../lib/viewLogClient'
import {
  applyActionEnforced,
  cancelGame,
  createGameAsset,
  deleteGame,
  deriveBaseFromView,
  duplicateGameAsHotseat,
  getGameByRoomCode,
  getGameState,
  getGameStateRedacted,
  getViewLogHistory,
  listMyGames,
  listPlayers,
  redoActionEnforced,
  setGameVisibility,
  subscribeToGame,
  subscribeToGameState,
  subscribeToPlayers,
  undoActionEnforced,
  writeGameState,
  type DeltaReplayContext,
  type GameEnforcementResult,
  type GameStateSnapshot,
} from '../lib/gameApi'
import { loadCachedGameState, saveCachedGameState } from '../lib/gameStateCache'
import { encodeGameStateExport } from '../lib/gameStateExport'
import { gamePath, isCanceled as isMyGameCanceled, isFinished as isMyGameFinished, isMyTurn as isMyGameTurn, latestUpdatedAt as latestMyGameUpdatedAt, type MyGameEntry } from '../lib/myGamesView'
import { setPendingRedirect } from '../lib/pendingRedirect'

/**
 * Two players' writes racing the game_state row's optimistic-concurrency
 * `version` check is the COMMON case in a simultaneous phase, not a rare
 * edge case — both players moving within milliseconds of each other. The
 * loser isn't in any real conflict (their move is still valid against the
 * fresher state), so the client-trusted path retries transparently against
 * the latest state. Capped so a genuinely stuck case still surfaces an error.
 */
const MAX_WRITE_RETRIES = 3

/**
 * Whether this game's state reads go through the redacted get-game-state
 * Edge Function (getGameStateRedacted) instead of the raw game_state row —
 * only when both ruleEnforcementEnabled and hiddenInformationEnabled are on.
 */
function usesRedactedReads(game: GameRow): boolean {
  return game.settings.ruleEnforcementEnabled && game.settings.hiddenInformationEnabled
}

/**
 * Picks getGameState vs getGameStateRedacted per usesRedactedReads above.
 * `previous`, when given, is the state to splice an incremental response onto
 * — ignored for a non-redacted game.
 */
function fetchGameState(game: GameRow, previous?: EngineGameState | null, replay?: DeltaReplayContext | null): Promise<GameStateSnapshot | null> {
  return usesRedactedReads(game) ? getGameStateRedacted(game.id, previous, replay ?? undefined) : getGameState(game.id)
}

/**
 * The in-game screen: the platform shell (header, menu, undo/redo, history
 * review, hotseat hand-off, admin mode, chat, log, room lifecycle) around the
 * game's own view (its package's `view` entry, via src/games/ui.ts). Everything game-specific is in the
 * game slot; this file only knows the generic GameState envelope.
 */
export function GamePage() {
  const { roomCode } = useParams<{ roomCode: string }>()
  const { session, loading: authLoading } = useAuth()
  const isAdmin = useIsAdmin(session?.user ?? null)
  const trafficStats = useTrafficStats()
  const navigate = useNavigate()

  useEffect(() => {
    if (authLoading || session || !roomCode) return
    setPendingRedirect(`/game/${roomCode}`)
    navigate('/', { replace: true })
  }, [authLoading, session, roomCode, navigate])

  const [game, setGame] = useState<GameRow | null>(null)
  const [roomNotFound, setRoomNotFound] = useState(false)
  const [loadError, setLoadError] = useState<AppError | null>(null)
  const [players, setPlayers] = useState<PlayerRow[]>([])
  const [gameState, setGameState] = useState<EngineGameState | null>(null)
  const [version, setVersion] = useState<number | null>(null)
  /**
   * The newest `version` actually applied to `gameState`, independent of
   * React state (which only updates after a render) — guards
   * applyGameStateSnapshot below against two in-flight fetches resolving out
   * of order. Also handed to subscribeToGameState as `getAppliedVersion`, so
   * the realtime echo of this client's own write skips its refetch.
   */
  const latestVersionRef = useRef<number | null>(null)
  /**
   * The *base* behind the rendered view: the state replayed up to this
   * viewer's safe actionHistory prefix, before any in-flight overlay
   * (@game-platform/sdk's inFlightOverlay.ts). This — never the view — seeds the next delta
   * request and gets cached, because the view has the overlay's effects baked
   * in and would double-apply them once those actions became visible.
   */
  const latestBaseRef = useRef<EngineGameState | null>(null)
  /**
   * Everything getGameStateRedacted needs to rebuild a state from actions
   * instead of being handed one — assigned during render below once
   * `genesis` exists. A ref because the effects that read it are declared
   * above it.
   */
  const deltaContextRef = useRef<DeltaReplayContext | null>(null)

  /**
   * Applies a freshly fetched state/version pair, discarding it if it's no
   * newer than what's already showing — realtime refetches, tab-focus
   * refetches and this client's own writes can resolve out of order. Every
   * call site that sets `gameState`/`version` should go through this.
   */
  function applyGameStateSnapshot(snapshot: GameStateSnapshot) {
    if (latestVersionRef.current !== null && snapshot.version <= latestVersionRef.current) return
    latestVersionRef.current = snapshot.version
    latestBaseRef.current = snapshot.base ?? null
    setGameState(snapshot.state)
    setVersion(snapshot.version)
  }

  /**
   * Persists every accepted snapshot's base to IndexedDB (gameStateCache.ts),
   * so a later cold open can ask for a delta instead of a full state.
   * Derives the base from the view when the response didn't carry one (the
   * normal case on a cold open, before `players` has loaded). Fire-and-forget.
   */
  useEffect(() => {
    if (!game || !session || !gameState || version === null) return
    let base = latestBaseRef.current
    if (!base) {
      const replay = deltaContextRef.current
      if (!replay) return
      base = deriveBaseFromView(gameState, replay) ?? null
      latestBaseRef.current = base
    }
    if (!base) return
    void saveCachedGameState(game.id, session.user.id, version, base)
    // Keyed on the ids, not the objects: `game` gets a new identity on every
    // unrelated `games` row change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.id, session?.user?.id, gameState, version, players.length])

  const [actionError, setActionError] = useState<AppError | null>(null)
  /** True while a move is in flight — shown as a "Sending…" badge and passed to the game view. */
  const [submitting, setSubmitting] = useState(false)
  const [showStateJson, setShowStateJson] = useState(false)
  /** Site-admin-only summary of `game.settings`. */
  const [showRoomConfig, setShowRoomConfig] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const [chatOpen, setChatOpen] = useState(false)
  const [chatUnreadCount, setChatUnreadCount] = useState(0)
  /** Mirrors the `chat_enabled` kill switch so the header's toggle button hides too. */
  const [chatEnabled, setChatEnabled] = useState(false)
  useEffect(() => {
    let cancelled = false
    isChatEnabled()
      .then((value) => {
        if (!cancelled) setChatEnabled(value)
      })
      .catch(() => {
        if (!cancelled) setChatEnabled(false)
      })
    return () => {
      cancelled = true
    }
  }, [])
  const reviewBannerRef = useRef<HTMLDivElement>(null)
  const [copiedStateJson, setCopiedStateJson] = useState(false)
  const [copiedStateExport, setCopiedStateExport] = useState(false)
  const [stateExportError, setStateExportError] = useState<AppError | null>(null)
  const [undoing, setUndoing] = useState(false)
  const [redoing, setRedoing] = useState(false)
  /**
   * Room admin mode: lets the room owner or a site admin act on behalf of
   * whichever player the game is waiting on (e.g. to unstick an AFK player),
   * and is what the server-side override for discarding another player's
   * undone action is gated on. A persisted, logged, shared
   * `GameState.adminModeActive` toggled by SET_ADMIN_MODE — not a page-local
   * toggle — so every client agrees and the log records when it was on.
   */
  const adminModeActive = gameState?.adminModeActive ?? false
  /** Undo/redo availability — a pure read of the shared, logged history (@game-platform/sdk's historyFold.ts). */
  const historyPointer = useMemo(() => (gameState ? resolveHistory(gameState.actionHistory) : { effective: [], canUndo: false, canRedo: false }), [gameState])
  /**
   * History review: step through past points in the game without touching
   * the live `game_state` row. `null` means "showing the live game";
   * otherwise an index into `gameState.actionHistory` (0 = genesis, N = the
   * state right after the Nth logged entry), replayed purely client-side.
   *
   * The one review mode for every game (@game-platform/sdk's reviewStops.ts):
   * it steps a turn at a time — the game's own turns
   * (GameDefinition.reviewStops), or rounds — or a move at a time, and hands
   * the game's view each step (GameViewProps.review) so the game can explain
   * what happened in it.
   */
  const [reviewIndex, setReviewIndex] = useState<number | null>(null)
  const [reviewGranularity, setReviewGranularity] = useState<'turn' | 'move'>('turn')
  const logPanelRef = useRef<HTMLDivElement>(null)
  /**
   * Hotseat pass-and-play: which seated player the shared device is currently
   * "handed to" — distinct from auth identity, since every hotseat seat
   * shares the host's user_id (gameApi.ts's addLocalPlayer). Null until
   * confirmed via the pass-the-device gate below.
   */
  const [hotseatActivePlayerId, setHotseatActivePlayerId] = useState<string | null>(null)
  const [lifecycleBusy, setLifecycleBusy] = useState(false)
  const [lifecycleError, setLifecycleError] = useState<AppError | null>(null)
  const [duplicating, setDuplicating] = useState(false)
  const [duplicateError, setDuplicateError] = useState<AppError | null>(null)
  /** Other games the signed-in user is seated in — drives the "Next game" button. Refreshed on load and tab focus. */
  const [otherMyGames, setOtherMyGames] = useState<MyGameEntry[]>([])

  useEffect(() => {
    if (!menuOpen) return
    function handlePointerDown(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false)
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [menuOpen])

  useEffect(() => {
    if (!roomCode) return
    let cancelled = false
    setGame(null)
    setRoomNotFound(false)
    setLoadError(null)
    setHotseatActivePlayerId(null)
    setReviewIndex(null)
    void (async () => {
      try {
        const foundGame = await getGameByRoomCode(roomCode)
        if (cancelled) return
        if (!foundGame) {
          setRoomNotFound(true)
          return
        }
        setGame(foundGame)
        const foundPlayers = await listPlayers(foundGame.id)
        if (!cancelled) setPlayers(foundPlayers)
      } catch (err) {
        if (!cancelled) setLoadError(toAppError(err, 'Failed to load room'))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [roomCode])

  useEffect(() => {
    if (!session) return
    let cancelled = false
    listMyGames(session.user.id, game?.id)
      .then((entries) => {
        if (!cancelled) setOtherMyGames(entries)
      })
      .catch(() => {
        // Best-effort: the "Next game" button just stays disabled if this fails.
      })
    return () => {
      cancelled = true
    }
  }, [session, game?.id])

  useRefetchOnVisible(() => {
    if (!session) return
    listMyGames(session.user.id, game?.id)
      .then(setOtherMyGames)
      .catch(() => {})
  })

  // Realtime subscriptions miss anything that changed while the tab was
  // backgrounded and its socket dropped — refetch this room on focus.
  useRefetchOnVisible(() => {
    if (!roomCode || !game) return
    void getGameByRoomCode(roomCode).then((fresh) => {
      if (fresh) setGame(fresh)
    })
    void fetchGameState(game, latestBaseRef.current, deltaContextRef.current).then((snapshot) => {
      if (snapshot) applyGameStateSnapshot(snapshot)
    })
    void listPlayers(game.id).then(setPlayers)
  })

  useEffect(() => {
    if (!game) return
    const gameId = game.id
    const redacted = usesRedactedReads(game)
    let cancelled = false
    // A version number is only comparable within the same game's row.
    latestVersionRef.current = null
    latestBaseRef.current = null

    void (async () => {
      // A state this user materialised in a previous session, read back from
      // IndexedDB so this very first fetch can ask for a delta. The replay
      // context is rebuilt from the cached state itself, since `players` (and
      // with it `genesis`) hasn't loaded yet. A stale cache just costs one
      // hash mismatch and a full fetch.
      const userId = session?.user?.id
      const cached = userId ? await loadCachedGameState(gameId, userId) : null
      const replay = deltaContextRef.current ?? (cached ? buildDeltaReplayContextFromState(game, cached) : null)
      const snapshot = await fetchGameState(game, cached, replay)
      if (!cancelled && snapshot) applyGameStateSnapshot(snapshot)
    })()

    const unsubscribeGameState = subscribeToGameState(gameId, applyGameStateSnapshot, redacted, () => latestVersionRef.current, () => latestBaseRef.current, () => deltaContextRef.current)
    const unsubscribePlayers = subscribeToPlayers(gameId, () => {
      void listPlayers(gameId).then(setPlayers)
    })
    // Merge onto the last known row: Realtime omits an unchanged TOASTed
    // column (a large `settings`) from an UPDATE's payload.
    const unsubscribeGame = subscribeToGame(gameId, (updated) => setGame((prev) => (prev ? { ...prev, ...updated } : updated)))

    return () => {
      cancelled = true
      unsubscribeGameState()
      unsubscribePlayers()
      unsubscribeGame()
    }
    // Keyed on the room id only: subscribeToGame calls setGame on every row
    // change, and re-running this would tear down every channel for nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.id])

  const isCreator = game?.created_by === session?.user.id
  // A finished game still reads `game.status === 'active'` (see dbTypes.ts's
  // GameRow comment), so the engine status rules out canceling a finished game.
  const canCancel = isCreator && game?.status === 'active' && gameState?.status !== 'completed'
  // Admins bypass both the ownership and status restrictions — the RLS
  // policy is the real guard.
  const canDelete = (isCreator && game?.status === 'canceled') || isAdmin
  const canEditVisibility = isCreator && game?.status !== 'canceled'
  const isHotseat = game?.play_mode === 'hotseat'
  /**
   * Who may switch on admin mode: the room owner or a site admin. Hotseat is
   * excluded — it already lets one device act as whoever's turn it is.
   */
  const canAdminOverride = (isCreator || isAdmin) && !isHotseat

  // When set, `me` in hotseat just follows whoever must act next, and the
  // pass-the-device gate never shows.
  const skipHotseatGate = game?.settings.skipHotseatPassGate ?? false
  /** Whichever seated player must act next (@game-platform/sdk's turnOrder.ts). */
  const pendingActorId = gameState ? currentActorId(gameState) : null
  const needsHotseatGate = isHotseat && !skipHotseatGate && pendingActorId !== null && pendingActorId !== hotseatActivePlayerId

  /**
   * `me` is "which seated player does this browser act on behalf of" — every
   * submitted action's `playerId` derives from it. Hotseat makes it follow
   * whoever must act next; admin mode does the same for the room owner or a
   * site admin in live/async, falling back to their own seat once nobody is
   * pending.
   */
  const me = isHotseat
    ? players.find((p) => p.id === (skipHotseatGate ? pendingActorId : hotseatActivePlayerId))
    : adminModeActive && canAdminOverride && pendingActorId
      ? (players.find((p) => p.id === pendingActorId) ?? players.find((p) => p.user_id === session?.user.id))
      : players.find((p) => p.user_id === session?.user.id)
  /** The signed-in user's own seat, regardless of admin mode — who SET_ADMIN_MODE is narrated as. */
  const ownSeat = players.find((p) => p.user_id === session?.user.id)
  const canConcede = !!me && gameState?.status === 'active' && !gameState.players.find((p) => p.id === me.id)?.eliminated

  /**
   * Deterministically rebuilt from the game's row + seated players
   * (buildGenesisState), plus the random numbers setup drew, which every
   * copy of the state carries (`setupRandom`) — genesis itself isn't stored.
   * Memoized on the fields genesis reads, not `players`' or the state's
   * identity, which change on every refetch.
   */
  const playersSignature = useMemo(() => JSON.stringify(players.map((p) => ({ id: p.id, name: p.display_name, color: p.color }))), [players])
  const setupRandomSignature = JSON.stringify(gameState?.setupRandom ?? [])
  const genesis = useMemo(() => {
    if (!game || players.length === 0) return null
    try {
      return buildGenesisState(game, players, JSON.parse(setupRandomSignature) as number[])
    } catch {
      return null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, players.length, playersSignature, setupRandomSignature])

  /**
   * Whether this game's lockRevealedInformationEnabled refuses a bare Undo
   * right now, for someone without the admin-mode override
   * (isUndoLockedByReveal), so the button doesn't offer an undo that will be
   * refused. Not judged on a redacted view: that log stops at the first
   * entry still secret from this viewer, so its last entry needn't be the
   * one Undo would revert — there the undo-action Edge Function, which has
   * the whole log, makes the call and says why. For a client-trusted game
   * this is the only check (handleUndo repeats it on the freshest state).
   */
  const undoLockedByReveal = useMemo(() => {
    if (!game || !genesis || !gameState || isHotseat) return false
    if (usesRedactedReads(game) && !isAdmin) return false
    try {
      return isUndoLockedByReveal(genesis, gameState)
    } catch {
      return false
    }
  }, [game, genesis, gameState, isHotseat, isAdmin])
  const undoBlockedByReveal = undoLockedByReveal && !(adminModeActive && canAdminOverride)

  // Assigned during render so the very next fetch already sees it.
  deltaContextRef.current = genesis ? { genesis } : null

  const isReviewingHistory = reviewIndex !== null
  const reviewMaxIndex = gameState?.actionHistory.length ?? 0

  /**
   * Whether `gameState` came from the view log (a redacted viewer of a
   * hidden-information game, viewLogClient.ts): its log is complete but
   * can't be replayed — secret entries are placeholders — so the log and
   * history review read what the server recorded instead.
   */
  const viewLog = isViewLogState(gameState)
  /**
   * History review for a view-log game: this viewer's view of genesis and
   * every entry's patch, fetched when review opens (reads never need it) and
   * again whenever the log has grown past what was fetched.
   */
  const [viewLogHistory, setViewLogHistory] = useState<ViewLogHistory | null>(null)
  useEffect(() => {
    if (!viewLog || reviewIndex === null || !game || !gameState) return
    if (viewLogHistory && viewLogHistory.entries.length >= gameState.actionHistory.length) return
    let cancelled = false
    void getViewLogHistory(game.id).then((history) => {
      if (!cancelled && history) setViewLogHistory(history)
    })
    return () => {
      cancelled = true
    }
  }, [viewLog, reviewIndex, game, gameState, viewLogHistory])

  /** The state after the first `index` log entries — replayed, or for a view-log game patched forward from this viewer's genesis view. */
  const reviewStateAt = useCallback(
    (index: number): EngineGameState | null => {
      if (!gameState) return null
      if (viewLog) return viewLogHistory && viewLogHistory.entries.length >= index ? viewLogReviewState(viewLogHistory, gameState, index) : null
      if (!genesis) return null
      try {
        return replayActions(genesis, gameState.actionHistory.slice(0, index))
      } catch {
        return null
      }
    },
    [genesis, gameState, viewLog, viewLogHistory],
  )

  /** Where review can stop: every move, or the game's turns (@game-platform/sdk's reviewStops.ts). */
  const reviewStops = useMemo(() => {
    const entries = gameState?.actionHistory ?? []
    if (reviewGranularity === 'move') return moveReviewStops(entries)
    return turnReviewStops(game ? findGameDefinition(game.game_type, game.settings.rulesVersion) : null, entries)
  }, [gameState, game, reviewGranularity])
  /** Where the reviewed step begins — the stop before `reviewIndex`. */
  const reviewStepStart = reviewIndex === null ? null : previousStop(reviewStops, reviewIndex)

  /** The state to render — live, or the reviewed point. */
  const reviewState = useMemo(() => (reviewIndex === null ? null : reviewStateAt(reviewIndex)), [reviewIndex, reviewStateAt])
  /** The state at the start of the reviewed step, for the game to explain the step against. */
  const reviewBefore = useMemo(() => (reviewStepStart === null ? null : reviewStateAt(reviewStepStart)), [reviewStepStart, reviewStateAt])
  const displayState = isReviewingHistory ? reviewState : gameState

  /**
   * The narration log (@game-platform/sdk's gameLog.ts), masked for this
   * viewer (redactGameLog) — always the whole live log, even while reviewing:
   * the log panel marks the reviewed step and what hasn't happened yet at that
   * point, and its lines jump the review to their move.
   */
  const visibleGameLog = useMemo(() => {
    // A view-log game's entries carry their narration, already worded for
    // this viewer by the server.
    if (viewLog && gameState) return buildGameLogFromViewerEntries(gameState.actionHistory as unknown as ViewerLogEntry[])
    if (!genesis || !gameState) return []
    try {
      return redactGameLog(buildGameLog(genesis, gameState.actionHistory), gameState, me?.id ?? null)
    } catch {
      return []
    }
  }, [genesis, gameState, me?.id, viewLog])

  /** The most recently updated other game that's waiting on one of this user's seats. */
  const nextGameNeedingInput = useMemo(() => {
    const candidates = otherMyGames.filter((entry) => entry.game.id !== game?.id && !isMyGameFinished(entry) && !isMyGameCanceled(entry) && isMyGameTurn(entry))
    candidates.sort(
      (a, b) => new Date(latestMyGameUpdatedAt(b.game, b.gameStateUpdatedAt)).getTime() - new Date(latestMyGameUpdatedAt(a.game, a.gameStateUpdatedAt)).getTime(),
    )
    return candidates[0] ?? null
  }, [otherMyGames, game?.id])

  /** Header roster in current turn order, falling back to seat order. */
  const headerPlayers = displayState ? displayState.turnOrder.map((id) => players.find((p) => p.id === id)).filter((p): p is PlayerRow => p !== undefined) : players
  const eliminatedPlayers = displayState ? players.filter((p) => !displayState.turnOrder.includes(p.id)) : []

  /** Preconditions shared by every write path below. */
  function writeGuardError(): string | null {
    if (!game || !gameState || version === null) return 'Game not loaded yet'
    if (isReviewingHistory) return 'Exit history review before making changes.'
    if (game.status === 'canceled') return 'This room has been canceled.'
    return null
  }

  /**
   * Runs one of the rule-enforced Edge Function calls and applies its result.
   * The Edge Function did its own compare-and-swap, so there's no retry loop
   * here — a 409 surfaces as an ordinary error.
   */
  async function runEnforced(call: () => Promise<GameEnforcementResult>): Promise<ActionResult> {
    const guardError = writeGuardError()
    if (guardError) return { ok: false, error: guardError }
    const result = await call()
    if (!result.ok) return result
    // `base` too — dropping it would send the next request back to a full fetch.
    applyGameStateSnapshot({ state: result.state, base: result.base, version: result.version })
    return { ok: true, state: result.state }
  }

  /**
   * Client-trusted path: writes whatever `computeNext` derives from the
   * current state, retrying against freshly refetched state (up to
   * MAX_WRITE_RETRIES) if the write loses the optimistic-concurrency race.
   * Yields one macrotask first so the "Sending…" badge paints before any
   * expensive rules evaluation blocks the thread.
   */
  async function writeWithRetry(computeNext: (state: EngineGameState) => ActionResult): Promise<ActionResult> {
    const guardError = writeGuardError()
    if (guardError) return { ok: false, error: guardError }
    if (!game || !gameState || version === null) return { ok: false, error: 'Game not loaded yet' } // narrows for TS
    let state = gameState
    let ver = version
    for (let attempt = 0; attempt < MAX_WRITE_RETRIES; attempt++) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      const result = computeNext(state)
      if (!result.ok) return result

      const wrote = await writeGameState(game.id, result.state, ver)
      if (wrote) {
        applyGameStateSnapshot({ state: result.state, version: ver + 1 })
        return result
      }

      const fresh = await getGameState(game.id)
      if (!fresh) return { ok: false, error: 'Game state disappeared unexpectedly.' }
      state = fresh.state
      ver = fresh.version
      applyGameStateSnapshot(fresh)
    }
    return { ok: false, error: "Couldn't sync with the other players' moves — please try again." }
  }

  /**
   * Submits one action. A rule-enforced game posts the raw Action to
   * apply-action, which re-derives the result server-side; every other game
   * runs applyAction() locally and writes the result directly.
   */
  async function submitAction(action: Action) {
    setSubmitting(true)
    try {
      const result = game?.settings.ruleEnforcementEnabled
        ? await runEnforced(() => applyActionEnforced(game.id, action, latestBaseRef.current, deltaContextRef.current ?? undefined))
        : await writeWithRetry((state) => applyAction(state, action, { random: cryptoRandomSource }))
      setActionError(result.ok ? null : simpleError(result.error))
    } finally {
      setSubmitting(false)
    }
  }

  /** Toggles room admin mode. `playerId` is narration-only: the signed-in owner/admin's own seat, not admin mode's `me`. */
  async function handleToggleAdminMode() {
    await submitAction({ type: 'SET_ADMIN_MODE', playerId: ownSeat?.id ?? null, enabled: !adminModeActive })
  }

  /** A seated, not-yet-eliminated player gives up — at any point once the game is active. */
  async function handleConcede() {
    if (!me) return
    if (!window.confirm('Concede this game? You will be out of the game — this cannot be undone by yourself.')) return
    await submitAction({ type: 'CONCEDE', playerId: me.id })
  }

  /**
   * Undo: any player, at any time — even after the game has ended — rolls
   * the game back one logged entry. Deliberately not gated on `me` (which is
   * null in some hotseat/post-game states); `me` only narrates who undid.
   * Undo is a logged UNDO_ACTION replayed from genesis (@game-platform/sdk's undoRedo.ts),
   * so every client sees the same result and it survives a reload. The one
   * exception is lockRevealedInformationEnabled (undoLockedByReveal above):
   * the server refuses an enforced game's undo itself, and a client-trusted
   * game's is refused here, against the freshest state writeWithRetry has.
   */
  async function handleUndo() {
    if (!game) return
    setUndoing(true)
    try {
      if (game.settings.ruleEnforcementEnabled) {
        const result = await runEnforced(() => undoActionEnforced(game.id, latestBaseRef.current, deltaContextRef.current ?? undefined))
        setActionError(result.ok ? null : simpleError(result.error))
        return
      }
      const override = adminModeActive && canAdminOverride
      const result = await writeWithRetry((state) => {
        const genesisForState = buildGenesisState(game, players, state.setupRandom)
        if (!isHotseat && !override && isUndoLockedByReveal(genesisForState, state)) {
          return { ok: false, error: 'That move revealed information to the players, so undoing it takes the room owner or an admin, with room admin mode on.' }
        }
        return applyUndoAction(genesisForState, state, me?.id ?? null)
      })
      setActionError(result.ok ? null : simpleError(result.error))
    } catch (err) {
      // replayActions throws "Replay failed at action ..." if an earlier
      // action no longer replays under the current rules (e.g. a rules change
      // shipped mid-game). That message is for a developer, not a player.
      if (err instanceof Error && err.message.startsWith('Replay failed')) {
        console.error('Undo: history no longer replays cleanly', err)
        setActionError(simpleError("Can't undo: this game's history no longer replays under the current rules."))
      } else {
        setActionError(toAppError(err, 'Failed to undo'))
      }
    } finally {
      setUndoing(false)
    }
  }

  /** Redo: appends a REDO_ACTION, re-checked fresh against the current state (see handleUndo). */
  async function handleRedo() {
    if (!game) return
    setRedoing(true)
    try {
      if (game.settings.ruleEnforcementEnabled) {
        const result = await runEnforced(() => redoActionEnforced(game.id, latestBaseRef.current, deltaContextRef.current ?? undefined))
        setActionError(result.ok ? null : simpleError(result.error))
        return
      }
      const result = await writeWithRetry((state) => applyRedoAction(buildGenesisState(game, players, state.setupRandom), state, me?.id ?? null))
      setActionError(result.ok ? null : simpleError(result.error))
    } catch (err) {
      setActionError(toAppError(err, 'Failed to redo'))
    } finally {
      setRedoing(false)
    }
  }

  async function handleCopyStateJson() {
    if (!gameState) return
    await navigator.clipboard.writeText(JSON.stringify(gameState, null, 2))
    setCopiedStateJson(true)
    setTimeout(() => setCopiedStateJson(false), 1500)
  }

  /** Copies a compact, self-describing game export (gameStateExport.ts) — handy for bug reports and test fixtures. */
  async function handleCopyStateExport() {
    if (!gameState) return
    setStateExportError(null)
    try {
      await navigator.clipboard.writeText(await encodeGameStateExport(gameState))
      setCopiedStateExport(true)
      setTimeout(() => setCopiedStateExport(false), 1500)
    } catch (err) {
      setStateExportError(toAppError(err, 'Failed to copy game state export'))
    }
  }

  /**
   * Saves what this game can offer as a reusable asset of `kind` — its map,
   * say (GameDefinition.assetKinds' `extract`) — to the signed-in user's
   * library, private until an admin publishes it.
   */
  async function handleSaveAsset(kind: string, label: string) {
    if (!game || !gameState || !session) return
    const data = findGameDefinition(game.game_type, game.settings.rulesVersion)?.assetKinds?.[kind]?.extract?.(gameState)
    if (data === null || data === undefined) return
    const name = window.prompt(`Name this ${label.toLowerCase()}`, `${game.name} ${label.toLowerCase()}`)
    if (name === null) return
    setStateExportError(null)
    try {
      await createGameAsset({ gameType: game.game_type, kind, name: name.slice(0, 80), data, userId: session.user.id })
      window.alert(`Saved. Find it under "Manage saved ${label.toLowerCase()}s" when you create a room.`)
    } catch (err) {
      setStateExportError(toAppError(err, `Failed to save the ${label.toLowerCase()}`))
    }
  }

  /** Snapshots this game's current state into a brand-new hotseat room this account owns. The source room is untouched. */
  async function handleDuplicateAsHotseat() {
    if (!game || !gameState || !session) return
    setDuplicating(true)
    setDuplicateError(null)
    try {
      const newGame = await duplicateGameAsHotseat({ sourceGame: game, sourcePlayers: players, sourceState: gameState, hostUserId: session.user.id })
      navigate(`/game/${newGame.room_code}`)
    } catch (err) {
      setDuplicateError(toAppError(err, 'Failed to duplicate game'))
    } finally {
      setDuplicating(false)
    }
  }

  async function handleCancelRoom() {
    if (!game) return
    if (!window.confirm('Cancel this room? Play will be disabled for everyone — this cannot be undone.')) return
    setLifecycleBusy(true)
    setLifecycleError(null)
    try {
      await cancelGame(game.id)
    } catch (err) {
      setLifecycleError(toAppError(err, 'Failed to cancel room'))
    } finally {
      setLifecycleBusy(false)
    }
  }

  async function handleToggleVisibility() {
    if (!game) return
    setLifecycleBusy(true)
    setLifecycleError(null)
    try {
      await setGameVisibility(game.id, game.visibility === 'public' ? 'private' : 'public')
    } catch (err) {
      setLifecycleError(toAppError(err, 'Failed to update visibility'))
    } finally {
      setLifecycleBusy(false)
    }
  }

  async function handleDeleteRoom() {
    if (!game) return
    setLifecycleBusy(true)
    setLifecycleError(null)
    try {
      await deleteGame(game.id)
      navigate('/')
    } catch (err) {
      setLifecycleError(toAppError(err, 'Failed to delete room'))
      setLifecycleBusy(false)
    }
  }

  if (authLoading || !session) return <div className="p-8 text-neutral-400">Loading…</div>
  if (loadError) {
    return (
      <div className="p-8">
        <ErrorBanner message={loadError.message} details={loadError.details} />
      </div>
    )
  }
  if (roomNotFound) return <div className="p-8 text-neutral-400">Room {roomCode} not found.</div>
  if (!game) return <div className="p-8 text-neutral-400">Looking for room {roomCode}…</div>

  const menuItemClass = 'px-3 py-2 text-left hover:bg-neutral-800 disabled:opacity-50'
  // The room's game, at the rules version it was created with. Null when this
  // deployment doesn't host it — the room still loads, its view doesn't.
  const gameDefinition = findGameDefinition(game.game_type, game.settings.rulesVersion)
  const gameUi = gameUiFor(game.game_type)
  const turnLabel = gameDefinition?.turnLabel ?? 'Turn'
  const reviewPosition = reviewIndex === null ? 0 : Math.max(0, reviewStops.findIndex((stop) => stop >= reviewIndex))
  const sinceLastTurn = sinceLastTurnStop(reviewStops, gameState?.actionHistory ?? [], me?.id ?? null)
  const reviewStepEntries = reviewIndex !== null && reviewStepStart !== null ? (gameState?.actionHistory.slice(reviewStepStart, reviewIndex) ?? []) : []
  /** "Round 3 · Actions · Bob" — the step's round and phase, and who acted in it. */
  const reviewLabel = (() => {
    if (reviewIndex === null) return ''
    if (reviewIndex === 0) return 'Start of the game'
    const entryCount = gameState?.actionHistory.length ?? 0
    const nothingSince = me !== null && sinceLastTurn === entryCount && reviewIndex === entryCount
    const last = gameState?.actionHistory[reviewIndex - 1]
    const actors = [...new Set(reviewStepEntries.map((entry) => ('playerId' in entry.action ? entry.action.playerId : null)).filter((id): id is string => !!id))]
    const names = actors.map((id) => players.find((p) => p.id === id)?.display_name ?? 'Someone')
    const phase = reviewBefore?.phase ? gameDefinition?.describePhase(reviewBefore.phase) : null
    const label = [last ? `${turnLabel} ${last.turn}` : null, phase || null, names.length > 0 ? names.join(', ') : null].filter(Boolean).join(' · ')
    return nothingSince ? `${label} — nothing has happened since your last turn` : label
  })()

  function openReview() {
    setReviewGranularity('turn')
    const stops = turnReviewStops(gameDefinition, gameState?.actionHistory ?? [])
    setReviewIndex(sinceLastTurnStop(stops, gameState?.actionHistory ?? [], me?.id ?? null))
  }

  function setGranularity(granularity: 'turn' | 'move') {
    setReviewGranularity(granularity)
    if (granularity === 'turn' && reviewIndex !== null) {
      // Snap onto the turn that contains the reviewed move.
      const stops = turnReviewStops(gameDefinition, gameState?.actionHistory ?? [])
      setReviewIndex(stops.find((stop) => stop >= reviewIndex) ?? reviewIndex)
    }
  }

  return (
    <div
      className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-8"
      onClick={(event) => {
        // Any click outside the review banner (or the log, whose lines jump to their move) exits history review.
        if (!isReviewingHistory) return
        if (reviewBannerRef.current?.contains(event.target as Node)) return
        if (logPanelRef.current?.contains(event.target as Node)) return
        setReviewIndex(null)
      }}
    >
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div ref={menuRef} className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              title="Menu"
              className="rounded-md border border-neutral-700 p-2 hover:border-neutral-500"
            >
              <svg viewBox="0 0 20 20" className="h-5 w-5 fill-current" aria-hidden="true">
                <rect x="2" y="4" width="16" height="2" rx="1" />
                <rect x="2" y="9" width="16" height="2" rx="1" />
                <rect x="2" y="14" width="16" height="2" rx="1" />
              </svg>
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="absolute left-0 top-full z-10 mt-2 flex w-56 flex-col overflow-hidden rounded-md border border-neutral-700 bg-neutral-900 py-1 text-sm shadow-lg"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false)
                    navigate('/')
                  }}
                  title="Return to the main menu — the game keeps going, and you can come back from the room code."
                  className={menuItemClass}
                >
                  Main menu
                </button>
                {canConcede && (
                  <button
                    type="button"
                    role="menuitem"
                    disabled={isReviewingHistory}
                    onClick={() => {
                      setMenuOpen(false)
                      void handleConcede()
                    }}
                    title="Concede this game — you'll be out of the game and can no longer act."
                    className={`${menuItemClass} text-red-400`}
                  >
                    Concede
                  </button>
                )}
                <div role="separator" className="my-1 border-t border-neutral-800" />
                <button
                  type="button"
                  role="menuitem"
                  disabled={!gameState}
                  onClick={() => {
                    setMenuOpen(false)
                    void handleCopyStateExport()
                  }}
                  title="Copies a game state export (a small JSON file) to the clipboard — paste it into a bug report, or save it as a test fixture."
                  className={menuItemClass}
                >
                  Copy game export
                </button>
                {gameState &&
                  session &&
                  Object.entries(gameDefinition?.assetKinds ?? {}).map(([kind, assetKind]) =>
                    assetKind.extract && assetKind.extract(gameState) !== null ? (
                      <button
                        key={kind}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenuOpen(false)
                          void handleSaveAsset(kind, assetKind.label)
                        }}
                        title={`Save this game's ${assetKind.label.toLowerCase()} to your library, to start other games from.`}
                        className={menuItemClass}
                      >
                        Save this {assetKind.label.toLowerCase()}
                      </button>
                    ) : null,
                  )}
                <button
                  type="button"
                  role="menuitem"
                  disabled={!gameState}
                  onClick={() => {
                    setMenuOpen(false)
                    setShowStateJson((v) => !v)
                  }}
                  title="Inspect the raw game state JSON."
                  className={menuItemClass}
                >
                  {showStateJson ? 'Hide' : 'Show'} game state JSON
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={!gameState || duplicating}
                  onClick={() => {
                    setMenuOpen(false)
                    void handleDuplicateAsHotseat()
                  }}
                  title="Copy this game's current state into a brand-new hot seat room you own. This game keeps going untouched."
                  className={menuItemClass}
                >
                  {duplicating ? 'Duplicating…' : 'Duplicate as hot seat'}
                </button>
                {canEditVisibility && (
                  <button
                    type="button"
                    role="menuitem"
                    disabled={lifecycleBusy}
                    onClick={() => {
                      setMenuOpen(false)
                      void handleToggleVisibility()
                    }}
                    title="Toggle whether this room is listed on the Public rooms screen."
                    className={menuItemClass}
                  >
                    Make {game.visibility === 'public' ? 'private' : 'public'}
                  </button>
                )}
                {canAdminOverride && (
                  <button
                    type="button"
                    role="menuitem"
                    aria-pressed={adminModeActive}
                    onClick={() => {
                      setMenuOpen(false)
                      void handleToggleAdminMode()
                    }}
                    title="Admin mode: act on behalf of whichever player the game is waiting on, and allow discarding another player's undone action. Room owner and site admins only — logged while on."
                    className={`${menuItemClass} ${adminModeActive ? 'text-amber-400' : ''}`}
                  >
                    {adminModeActive ? 'Admin mode: ON' : 'Admin mode'}
                  </button>
                )}
                {isAdmin && (
                  <button
                    type="button"
                    role="menuitem"
                    aria-pressed={showRoomConfig}
                    onClick={() => {
                      setMenuOpen(false)
                      setShowRoomConfig((v) => !v)
                    }}
                    title="Show this room's configuration. Site admins only."
                    className={`${menuItemClass} ${showRoomConfig ? 'text-amber-400' : ''}`}
                  >
                    {showRoomConfig ? 'Hide' : 'Show'} room configuration
                  </button>
                )}
                {isAdmin && (
                  <div title="Cumulative network traffic to and from Supabase this session (excluding realtime)." className="px-3 py-2 text-left text-neutral-500">
                    Session traffic: {trafficStats}
                  </div>
                )}
                {(canCancel || canDelete) && <div role="separator" className="my-1 border-t border-neutral-800" />}
                {canCancel && (
                  <button
                    type="button"
                    role="menuitem"
                    disabled={lifecycleBusy}
                    onClick={() => {
                      setMenuOpen(false)
                      void handleCancelRoom()
                    }}
                    title="Cancel this room — disables further play; it stays visible for reference until deleted."
                    className={`${menuItemClass} text-red-400`}
                  >
                    Cancel room
                  </button>
                )}
                {canDelete && (
                  <button
                    type="button"
                    role="menuitem"
                    disabled={lifecycleBusy}
                    onClick={() => {
                      setMenuOpen(false)
                      void handleDeleteRoom()
                    }}
                    title="Permanently delete this room."
                    className={`${menuItemClass} text-red-400`}
                  >
                    Delete room
                  </button>
                )}
              </div>
            )}
          </div>
          <h1 className="text-2xl font-semibold">{game.name}</h1>
          <button
            type="button"
            disabled={!nextGameNeedingInput}
            onClick={() => {
              if (nextGameNeedingInput) navigate(gamePath(nextGameNeedingInput))
            }}
            title={nextGameNeedingInput ? `${nextGameNeedingInput.game.name} is waiting on you — click to switch to it.` : 'No other game is waiting on you right now.'}
            className={`rounded-md border px-3 py-1 text-sm hover:border-neutral-500 disabled:opacity-50 ${
              nextGameNeedingInput ? 'border-amber-500 text-amber-400' : 'border-neutral-700'
            }`}
          >
            Next game
          </button>
        </div>

        <ul className="flex flex-wrap items-center gap-3 text-sm text-neutral-400">
          {chatEnabled && (
            <li>
              <button
                type="button"
                onClick={() => setChatOpen((v) => !v)}
                aria-expanded={chatOpen}
                title={chatOpen ? 'Hide chat' : 'Show chat'}
                className="relative rounded-md border border-neutral-700 p-2 hover:border-neutral-500"
              >
                <svg viewBox="0 0 20 20" className="h-5 w-5 fill-current" aria-hidden="true">
                  <path d="M3 4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h1.5v3.25a.75.75 0 0 0 1.28.53L9.31 14H17a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H3Z" />
                </svg>
                {chatUnreadCount > 0 && (
                  <span
                    className="absolute -right-1 -top-1 rounded-full bg-sky-600 px-1.5 py-0.5 text-xs font-semibold leading-none text-white"
                    aria-label={`${chatUnreadCount} unread message${chatUnreadCount === 1 ? '' : 's'}`}
                  >
                    {formatUnreadBadge(chatUnreadCount)}
                  </span>
                )}
              </button>
            </li>
          )}
          {[...headerPlayers, ...eliminatedPlayers].map((p) => {
            const enginePlayer = displayState?.players.find((ep) => ep.id === p.id)
            // "Not pending" is always public (redaction never touches
            // pendingPlayerIds), so it's a safe "already moved" marker.
            const hasActed = displayState?.status === 'active' && enginePlayer && !enginePlayer.eliminated ? !displayState.pendingPlayerIds.includes(p.id) : false
            return (
              <li key={p.id} className={`flex items-center gap-1 ${enginePlayer?.eliminated ? 'opacity-40' : hasActed ? 'opacity-60' : ''}`}>
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
                {p.display_name}
                {hasActed && (
                  <span title="Already moved" className="text-emerald-400">
                    ✓
                  </span>
                )}
              </li>
            )
          })}
        </ul>

        {displayState && (
          <span className="text-sm text-neutral-400">
            {displayState.status === 'completed' ? 'Game over' : `${turnLabel} ${displayState.turn} · ${gameDefinition?.describePhase(displayState.phase) ?? 'In progress'}`}
          </span>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {submitting && <span className="text-xs text-neutral-500">Sending…</span>}
          <button
            type="button"
            disabled={undoing || isReviewingHistory || !gameState || !historyPointer.canUndo || undoBlockedByReveal}
            onClick={() => void handleUndo()}
            title={
              undoBlockedByReveal
                ? 'That move revealed information to the players, so only the room owner or an admin, with admin mode on, can undo it.'
                : 'Undo the last action — any player can do this, at any time, even after the game has ended.'
            }
            className="rounded-md border border-neutral-700 px-3 py-1 text-sm hover:border-neutral-500 disabled:opacity-50"
          >
            {undoing ? 'Undoing…' : 'Undo'}
          </button>
          <button
            type="button"
            disabled={redoing || isReviewingHistory || !historyPointer.canRedo}
            onClick={() => void handleRedo()}
            title="Redo the last undone action."
            className="rounded-md border border-neutral-700 px-3 py-1 text-sm hover:border-neutral-500 disabled:opacity-50"
          >
            {redoing ? 'Redoing…' : 'Redo'}
          </button>
          <button
            type="button"
            disabled={!gameState || reviewMaxIndex === 0}
            onClick={() => (isReviewingHistory ? setReviewIndex(null) : openReview())}
            title="Step through the game's history, a turn or a move at a time, starting right after your own last turn. Unlike Undo, this never touches the live game."
            className={`rounded-md border px-3 py-1 text-sm hover:border-neutral-500 disabled:opacity-50 ${
              isReviewingHistory ? 'border-amber-500 text-amber-400' : 'border-neutral-700'
            }`}
          >
            {isReviewingHistory ? 'Exit review' : 'Review history'}
          </button>
        </div>
      </header>

      <ChatPanel gameId={game.id} players={players} canPost={!!ownSeat} open={chatOpen} onUnreadCountChange={setChatUnreadCount} />

      {isReviewingHistory && (
        <div ref={reviewBannerRef} className="flex flex-wrap items-center gap-3 rounded-md border border-amber-700/40 bg-amber-500/10 p-3 text-sm text-amber-200">
          <span className="font-medium">Reviewing history</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={reviewIndex === sinceLastTurn}
              onClick={() => setReviewIndex(sinceLastTurn)}
              title="Jump to right after your own last move — what everyone else did since."
              className="rounded-md border border-amber-700/60 px-2 py-0.5 hover:border-amber-400 disabled:opacity-40"
            >
              Since your last turn
            </button>
            <button
              type="button"
              disabled={reviewIndex === null || previousStop(reviewStops, reviewIndex) === null}
              onClick={() => setReviewIndex((i) => (i === null ? i : (previousStop(reviewStops, i) ?? i)))}
              className="rounded-md border border-amber-700/60 px-2 py-0.5 hover:border-amber-400 disabled:opacity-40"
            >
              ← Prev
            </button>
            <input
              type="range"
              min={0}
              max={reviewStops.length - 1}
              value={reviewPosition}
              onChange={(e) => setReviewIndex(reviewStops[Number(e.target.value)] ?? 0)}
              aria-label={reviewGranularity === 'turn' ? 'Turn' : 'Move'}
              className="w-40"
            />
            <button
              type="button"
              disabled={reviewIndex === null || nextStop(reviewStops, reviewIndex) === null}
              onClick={() => setReviewIndex((i) => (i === null ? i : (nextStop(reviewStops, i) ?? i)))}
              className="rounded-md border border-amber-700/60 px-2 py-0.5 hover:border-amber-400 disabled:opacity-40"
            >
              Next →
            </button>
          </div>
          <span>
            {reviewLabel}
            {reviewIndex !== null && reviewIndex > 0 && (
              <span className="text-amber-300/70">
                {' '}
                ({reviewPosition} of {reviewStops.length - 1})
              </span>
            )}
          </span>
          <div role="group" aria-label="Step size" className="flex overflow-hidden rounded-md border border-amber-700/60 text-xs">
            {(['turn', 'move'] as const).map((granularity) => (
              <button
                key={granularity}
                type="button"
                aria-pressed={reviewGranularity === granularity}
                onClick={() => setGranularity(granularity)}
                title={granularity === 'turn' ? 'Step a whole turn at a time.' : 'Step one logged move at a time.'}
                className={`px-2 py-0.5 ${reviewGranularity === granularity ? 'bg-amber-500/20 text-amber-100' : 'hover:bg-amber-500/10'}`}
              >
                {granularity === 'turn' ? 'Turns' : 'Moves'}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setReviewIndex(null)} className="ml-auto rounded-md border border-amber-700/60 px-3 py-1 font-medium hover:border-amber-400">
            Back to live
          </button>
        </div>
      )}

      {stateExportError && <ErrorBanner message={stateExportError.message} details={stateExportError.details} onDismiss={() => setStateExportError(null)} />}
      {copiedStateExport && !showStateJson && <div className="rounded-md bg-emerald-500/10 p-3 text-sm text-emerald-400">Game export copied to clipboard!</div>}
      {duplicateError && <ErrorBanner message={duplicateError.message} details={duplicateError.details} onDismiss={() => setDuplicateError(null)} />}
      {lifecycleError && <ErrorBanner message={lifecycleError.message} details={lifecycleError.details} onDismiss={() => setLifecycleError(null)} />}

      {game.status === 'canceled' && (
        <div className="rounded-md bg-neutral-800/60 p-3 text-sm text-neutral-300">
          This room was canceled{isCreator ? '' : ' by the host'}. Play is disabled — it stays here for reference until {isCreator ? 'you delete it.' : 'the host deletes it.'}
        </div>
      )}

      {showRoomConfig && isAdmin && (
        <div className="flex flex-col gap-2 rounded-md border border-neutral-800 bg-neutral-900 p-4 text-sm">
          <div className="font-medium text-neutral-200">Room configuration</div>
          <div className={game.settings.ruleEnforcementEnabled ? 'font-medium text-amber-400' : 'font-medium text-neutral-400'}>
            Backend rule enforcement: {game.settings.ruleEnforcementEnabled ? 'ON' : 'OFF'}
          </div>
          <div className={usesRedactedReads(game) ? 'font-medium text-amber-400' : 'font-medium text-neutral-400'}>Hidden information: {usesRedactedReads(game) ? 'ON' : 'OFF'}</div>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-neutral-300">
            <dt className="text-neutral-500">Play mode</dt>
            <dd>{game.play_mode}</dd>
            <dt className="text-neutral-500">Visibility</dt>
            <dd>{game.visibility}</dd>
            <dt className="text-neutral-500">Players</dt>
            <dd>
              {game.min_players}–{game.max_players}
            </dd>
            <dt className="text-neutral-500">Game</dt>
            <dd>
              {gameDefinition?.title ?? game.game_type} (rules v{game.settings.rulesVersion ?? '?'})
            </dd>
            <dt className="text-neutral-500">Game options</dt>
            <dd>{gameDefinition ? gameDefinition.describeOptions(gameDefinition.normalizeOptions(game.settings.gameOptions)) : '—'}</dd>
            <dt className="text-neutral-500">Skip hotseat pass gate</dt>
            <dd>{game.settings.skipHotseatPassGate ? 'Yes' : 'No'}</dd>
            <dt className="text-neutral-500">Config version</dt>
            <dd>{game.config_version}</dd>
          </dl>
        </div>
      )}

      {showStateJson && gameState && (
        <div className="flex flex-col gap-2">
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => void handleCopyStateExport()} className="rounded-md border border-neutral-700 px-3 py-1 text-xs hover:border-neutral-500">
              {copiedStateExport ? 'Copied!' : 'Copy game export'}
            </button>
            <button type="button" onClick={() => void handleCopyStateJson()} className="rounded-md border border-neutral-700 px-3 py-1 text-xs hover:border-neutral-500">
              {copiedStateJson ? 'Copied!' : 'Copy JSON'}
            </button>
          </div>
          <pre className="max-h-96 overflow-auto rounded-md border border-neutral-800 bg-neutral-900 p-4 text-xs text-neutral-300">{JSON.stringify(gameState, null, 2)}</pre>
        </div>
      )}

      {actionError && <ErrorBanner message={actionError.message} details={actionError.details} onDismiss={() => setActionError(null)} />}

      {adminModeActive && canAdminOverride && !isReviewingHistory && pendingActorId && me?.id === pendingActorId && (
        <div className="rounded-md border border-amber-700 bg-amber-950/40 px-3 py-2 text-sm text-amber-300">
          Admin mode: acting as <span className="font-medium">{me.display_name}</span>.
        </div>
      )}

      {!gameState && <p className="text-neutral-400">Setting up the game…</p>}

      {displayState?.status === 'completed' && (
        <div className="rounded-md border border-yellow-800/60 bg-yellow-950/40 p-4 text-center">
          <p className="text-lg font-semibold text-yellow-400">
            {displayState.winnerPlayerIds.length === 0
              ? 'Game over'
              : `${displayState.winnerPlayerIds.map((id) => players.find((p) => p.id === id)?.display_name ?? 'Unknown').join(' & ')} ${displayState.winnerPlayerIds.length > 1 ? 'win' : 'wins'}!`}
          </p>
        </div>
      )}

      {needsHotseatGate && pendingActorId && !isReviewingHistory ? (
        <div className="flex flex-col items-center gap-4 rounded-md border border-neutral-800 p-12 text-center">
          <p className="text-sm text-neutral-400">Pass the device to</p>
          <p className="text-3xl font-semibold">{players.find((p) => p.id === pendingActorId)?.display_name ?? 'the next player'}</p>
          <button type="button" onClick={() => setHotseatActivePlayerId(pendingActorId)} className="rounded-md bg-indigo-600 px-6 py-2 font-medium text-white hover:bg-indigo-500">
            I&apos;m ready — continue
          </button>
        </div>
      ) : (
        displayState &&
        (gameUi ? (
          <gameUi.View
            state={displayState}
            players={players}
            myPlayerId={isReviewingHistory || game.status === 'canceled' ? null : (me?.id ?? null)}
            submitting={submitting}
            onAction={(action) => void submitAction(action)}
            review={
              isReviewingHistory && reviewBefore && reviewStepEntries.length > 0
                ? { before: reviewBefore, entries: reviewStepEntries, granularity: reviewGranularity }
                : undefined
            }
          />
        ) : (
          <p className="rounded-md border border-neutral-800 p-4 text-sm text-neutral-400">
            This room plays <span className="font-medium">{game.game_type}</span>, which this site doesn&apos;t host.
          </p>
        ))
      )}

      <div ref={logPanelRef}>
        <GameLogPanel
          events={visibleGameLog}
          players={players}
          review={isReviewingHistory && reviewIndex !== null ? { from: reviewStepStart ?? reviewIndex, to: reviewIndex } : undefined}
          onSelectEntry={
            gameState && gameState.actionHistory.length > 0
              ? (entryIndex) => {
                  setReviewGranularity('move')
                  setReviewIndex(entryIndex + 1)
                }
              : undefined
          }
        />
      </div>
    </div>
  )
}

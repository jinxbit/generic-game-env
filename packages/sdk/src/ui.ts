import type { ComponentType } from 'react'
import type { GameActionBase, LoggedAction } from './actions.ts'
import type { GameState } from './types.ts'

/**
 * A seated player as the platform hands them to a game's view — the display
 * bits of the app's `players` row.
 */
export interface SeatInfo {
  id: string
  display_name: string
  color: string
}

/** What the platform's in-game screen hands a game's view. */
export interface GameViewProps<TData = unknown, TOptions = unknown, TAction extends GameActionBase = GameActionBase> {
  /** The state to render: live, or a past point while the viewer is reviewing history. */
  state: GameState<TData, TOptions>
  /** Seated players, for display names and colours. */
  players: SeatInfo[]
  /**
   * Which seat this browser acts for, or null to render read-only (a
   * spectator, someone reviewing history, or waiting on the hotseat hand-off).
   * In hotseat and admin mode this follows whoever must act next, not the
   * signed-in account.
   */
  myPlayerId: string | null
  /** True while a submitted action is in flight — disable inputs. */
  submitting: boolean
  /** Submit one game action. The platform routes it to the right write path and shows any rejection. */
  onAction: (action: TAction) => void
  /**
   * Set while the viewer is reviewing history: `state` is then the state at
   * the end of the reviewed step, and this is what the step did — so the
   * view can explain it (highlight what moved, show what changed) rather
   * than just show where it ended. The platform owns the stepping itself
   * (./reviewStops.ts); a view that ignores this still works.
   */
  review?: ReviewStep<TData, TOptions>
}

/** One step of history review — see GameViewProps.review. */
export interface ReviewStep<TData = unknown, TOptions = unknown> {
  /** The state at the start of the step. */
  before: GameState<TData, TOptions>
  /**
   * The log entries the step covers (the tail of `state.actionHistory`), in
   * the viewer's form: a secret one is a HIDDEN_ACTION placeholder.
   */
  entries: LoggedAction[]
  /** 'turn': the step is one of the game's turns (GameDefinition.reviewStops). 'move': one log entry. */
  granularity: 'turn' | 'move'
}

/** The game's creation-time options form (create-game screen, lobby config editor). */
export interface GameOptionsEditorProps<TOptions = unknown> {
  value: TOptions
  onChange: (value: TOptions) => void
  disabled?: boolean
  /**
   * Which of the game's asset kinds (GameDefinition.assetKinds) the room is
   * set to start from — a specific asset ('chosen') or one picked at Start
   * ('random'). The platform renders the asset pickers itself; this is so the
   * editor can grey out whatever options an asset replaces.
   */
  assets?: Record<string, 'chosen' | 'random'>
}

/** Renders one asset's payload — a thumbnail in pickers and the asset library. */
export interface AssetPreviewProps<TData = unknown> {
  data: TData
}

/** Creates or edits one asset's payload (a map builder, say). */
export interface AssetEditorProps<TData = unknown> {
  /** The payload being edited, or null for a new one. */
  value: TData | null
  /** Called with the payload as it changes; the platform saves the latest valid one on request. */
  onChange: (value: TData) => void
  disabled?: boolean
}

/** The React half of an asset kind (GameDefinition.assetKinds). */
export interface AssetKindUi<TData = unknown> {
  Preview: ComponentType<AssetPreviewProps<TData>>
  /** Omit when assets of this kind only come from games (AssetKind.extract). */
  Editor?: ComponentType<AssetEditorProps<TData>>
}

/**
 * A game package's React half, exported from its `view` entry point — kept
 * separate from the rules so the Edge Functions never load React.
 */
export interface GameUi<TData = unknown, TOptions = unknown, TAction extends GameActionBase = GameActionBase> {
  /** Must match the rules' GameDefinition.id. */
  id: string
  /** One line for the create-game screen's game picker. */
  tagline: string
  View: ComponentType<GameViewProps<TData, TOptions, TAction>>
  OptionsEditor: ComponentType<GameOptionsEditorProps<TOptions>>
  /** Views for the game's asset kinds, keyed like GameDefinition.assetKinds. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assetKinds?: Record<string, AssetKindUi<any>>
}

/** A UI for any game — what the app's UI registry holds. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyGameUi = GameUi<any, any, any>

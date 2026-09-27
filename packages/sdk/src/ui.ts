import type { ComponentType } from 'react'
import type { GameActionBase } from './actions.ts'
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
}

/** The game's creation-time options form (create-game screen, lobby config editor). */
export interface GameOptionsEditorProps<TOptions = unknown> {
  value: TOptions
  onChange: (value: TOptions) => void
  disabled?: boolean
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
}

/** A UI for any game — what the app's UI registry holds. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyGameUi = GameUi<any, any, any>

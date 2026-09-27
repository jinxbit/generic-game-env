// Data types for the example game, "Unique Pick".
//
// Everything in src/game/ is the pluggable game slot: replace it wholesale
// to build a different game on this platform. The framework (src/engine/)
// only ever touches these types through the GameDefinition contract in
// ../engine/gameDefinition.ts — see src/game/README.md.
//
// Unique Pick in one paragraph: every round, each player secretly picks a
// number from 1 to MAX_PICK at the same time. Once everyone has picked, the
// picks are revealed; every player whose number nobody else picked scores
// that many points. The first player to reach the target score wins, or the
// highest score after the last round (ties share the win).
//
// Keep this module pure data: no React, no Supabase, no I/O. It's imported by
// the Edge Functions (supabase/functions/), so every relative import in the
// graph must carry an explicit `.ts` extension.

/**
 * Creation-time options for one game — stored in `games.settings.gameOptions`
 * and copied onto `GameState.options` at genesis (normalized — see
 * normalizeGameOptions in ./rules.ts) so a running game stays self-contained.
 */
export interface GameOptions {
  /** First player to reach this many points wins. */
  targetScore: number
  /** The game also ends after this many rounds; highest score wins. */
  maxRounds: number
}

/** One resolved round, kept so the UI can show what was revealed. */
export interface RoundResult {
  round: number
  /** Every non-conceded player's pick this round. */
  picks: Record<string, number>
  /** Points each player scored this round (0 for a collision). */
  pointsByPlayerId: Record<string, number>
}

/** The game-specific slice of GameState (`GameState.game`). */
export interface GameData {
  /**
   * This round's picks, by player id; null until that player has picked.
   * Secret from other players until the round resolves — see
   * `redactGame` in ./rules.ts.
   */
  picks: Record<string, number | null>
  scores: Record<string, number>
  /** Resolved rounds, oldest first. */
  rounds: RoundResult[]
}

/**
 * A player picks (or, while the round is still open, changes) their number.
 * Game actions must carry `playerId` — the framework uses it to authorize
 * the submitter (supabase/functions/_shared/gameEnforcement.ts).
 */
export interface PickNumberAction {
  type: 'PICK_NUMBER'
  playerId: string
  value: number
}

/** Every action this game defines. The framework adds its own (undo, redo, concede, admin mode) — see ../engine/actions.ts. */
export type GameAction = PickNumberAction

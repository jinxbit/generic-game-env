// @game-platform/sdk — the game-agnostic rules framework and the contract a
// game package implements. Pure TypeScript: no React, no Supabase, no I/O.
// The React view contract is a separate entry point (`@game-platform/sdk/ui`)
// and test helpers another (`@game-platform/sdk/testing`), so neither ever
// reaches the Edge Functions. Imported unmodified by the app
// and by the Supabase Edge Functions (via supabase/functions/deno.json),
// so every relative import here carries an explicit `.ts` extension.

export * from './types.ts'
export * from './actions.ts'
export * from './gameDefinition.ts'
export * from './registry.ts'
export * from './applyAction.ts'
export * from './createGame.ts'
export * from './historyFold.ts'
export { applyUndoAction, applyRedoAction, isUndoLockedByReveal } from './undoRedo.ts'
export * from './replay.ts'
export * from './redaction.ts'
export * from './inFlightOverlay.ts'
export * from './gameLog.ts'
export * from './turnOrder.ts'
export * from './random.ts'

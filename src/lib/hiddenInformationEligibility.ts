// The redacted read path needs server authority to redact from, so it only
// makes sense alongside rule enforcement — and never for hotseat, where
// every local seat shares one auth.uid() and per-seat masking would just
// hide a player's own move from the device they're using to make it (see
// get-game-state/index.ts). Split out of CreateGamePage.tsx so it can be
// unit tested without rendering the page.

import type { PlayMode } from '@game-platform/sdk'
export function hiddenInformationAvailable(playMode: PlayMode, ruleEnforcementEnabled: boolean): boolean {
  return ruleEnforcementEnabled && playMode !== 'hotseat'
}

/**
 * GameSettings.lockRevealedInformationEnabled only means something where
 * there's more than one person at the table to hide a reveal from — not
 * hotseat, where one device plays every seat and the override is waived
 * anyway (the undo-action Edge Function's hotseat exemption). It covers
 * random draws as well as hidden information, so unlike
 * hiddenInformationAvailable it doesn't need rule enforcement: a
 * client-trusted game gets the same check, from GamePage.tsx alone.
 */
export function lockRevealedInformationAvailable(playMode: PlayMode): boolean {
  return playMode !== 'hotseat'
}

// Rolls a game's random seed — the one place the platform reads real
// randomness for a game's rules. createGame() (gameApi.ts) calls it when the
// room is created and stores the result in `games.settings.randomSeed`;
// buildGenesisState (./gameGenesis.ts) copies it onto `GameState.randomSeed`,
// and the rules draw from it through @game-platform/sdk's `gameRandom`. Rolling
// at creation rather than at Start means both write paths (the client-side
// startGameFromLobby and the start-game Edge Function) build genesis from a
// seed that is already on the row, with nothing extra to write or retry.

/** 128 random bits as 32 lowercase hex characters. */
export function generateRandomSeed(): string {
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

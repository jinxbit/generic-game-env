import type { GameDefinition } from './gameDefinition.ts'
import { gameDefinition } from '../game/rules.ts'

/**
 * The one place the framework binds to the pluggable game slot (src/game/).
 * Every engine module reaches the game's rules through this, so swapping in
 * a different game means changing src/game/, not the engine.
 */
export const game: GameDefinition = gameDefinition

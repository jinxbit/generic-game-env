// Discord "your turn" notifications. Each player pastes in their own
// webhook URL (src/components/DiscordWebhookSettings.tsx) — no bot install
// required. The actual "it's your turn" ping is sent server-side by the
// supabase/functions/notify-discord-turn Edge Function (triggered by a
// Database Webhook on game_state UPDATE, see that function's doc comment),
// using the service-role key to read the target player's webhook URL —
// browsers no longer need (or have RLS access) to read a co-player's
// webhook URL. `sendDiscordNotification` below still lives here for
// DiscordWebhookSettings.tsx's "Send test" button, which posts to the
// signed-in player's *own* webhook to confirm it's wired up correctly —
// that's not a leak since nothing about a co-player's webhook is exposed.

// Also imported by supabase/functions/notify-discord-turn, so the message
// format has one definition — this module is in the Edge Function graph:
// keep the `.ts` extension on every relative import.
import { GAME_TITLE, TURN_LABEL } from '../game/display.ts'

const WEBHOOK_URL_PATTERN = /^https:\/\/(?:discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[\w-]+$/

export function isDiscordWebhookUrl(url: string): boolean {
  return WEBHOOK_URL_PATTERN.test(url.trim())
}

/**
 * A signed-in Supabase Auth user's Discord snowflake ID (for `<@id>` mentions),
 * taken from their Discord OAuth identity — `UserIdentity.id` is the provider's
 * own user ID, not Supabase's internal identity row ID. `null` if the user never
 * signed in with Discord (e.g. the guest auth bypass).
 *
 * Also used server-side by supabase/functions/notify-discord-turn.
 */
export function discordUserIdFromIdentities(identities: { provider: string; id: string }[] | null | undefined): string | null {
  return identities?.find((identity) => identity.provider === 'discord')?.id ?? null
}

// The real pings are built by supabase/functions/notify-discord-turn with
// this same function; the "Send test" button uses it too. Game-agnostic: the
// title and turn label come from src/game/display.ts, the phase label (if
// any) from the game's own describePhase.
export function turnNotificationMessage(params: {
  displayName: string
  /** Discord snowflake ID to `@mention` (so the recipient is actually pinged), or null to fall back to the bold display name. */
  discordUserId: string | null
  roomName: string
  roomCode: string
  /** The game's label for the current phase (e.g. "Picking"), or null to leave it out. */
  phase: string | null
  /** Turn/round number (GameState.turn), or null to leave it out. */
  round: number | null
  /** Deep link to the game, or null if the SITE_URL Edge Function secret isn't set — falls back to the room code. */
  gameUrl: string | null
}): string {
  const details = [params.round === null ? null : `${TURN_LABEL} ${params.round}`, params.phase].filter((part): part is string => !!part)
  const detailText = details.length > 0 ? ` (${details.join(' · ')})` : ''
  // With a game link, the room name itself becomes the link instead of pasting
  // the raw URL below — without one, fall back to the room code on its own line.
  const roomName = params.gameUrl ? `[${params.roomName}](${params.gameUrl})` : params.roomName
  const fallback = params.gameUrl ? '' : `\nRoom \`${params.roomCode}\``
  const mention = params.discordUserId ? `<@${params.discordUserId}>` : `**${params.displayName}**`
  return `**${GAME_TITLE}** — ${mention}, it's your turn in **${roomName}**${detailText}.${fallback}`
}

/**
 * Best-effort: a bad/deleted webhook or a network hiccup here should never
 * surface as an error to the player just trying to test their own webhook.
 */
export async function sendDiscordNotification(webhookUrl: string, content: string): Promise<void> {
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    })
  } catch {
    // See doc comment above — swallow, don't propagate.
  }
}

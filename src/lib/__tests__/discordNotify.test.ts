import { describe, expect, it } from 'vitest'
import { GAME_TITLE, TURN_LABEL } from '../../game/display'
import { discordUserIdFromIdentities, isDiscordWebhookUrl, turnNotificationMessage } from '../discordNotify'

describe('isDiscordWebhookUrl', () => {
  it('accepts a real Discord webhook URL', () => {
    expect(isDiscordWebhookUrl('https://discord.com/api/webhooks/123456789/abcDEF-123_xyz')).toBe(true)
  })

  it('rejects non-Discord URLs', () => {
    expect(isDiscordWebhookUrl('https://example.com/webhook')).toBe(false)
  })
})

describe('discordUserIdFromIdentities', () => {
  it('returns the Discord identity id', () => {
    expect(
      discordUserIdFromIdentities([
        { provider: 'discord', id: '111222333' },
        { provider: 'email', id: 'some-uuid' },
      ]),
    ).toBe('111222333')
  })

  it('returns null when there is no Discord identity', () => {
    expect(discordUserIdFromIdentities([{ provider: 'email', id: 'some-uuid' }])).toBe(null)
  })

  it('returns null for null/undefined identities', () => {
    expect(discordUserIdFromIdentities(null)).toBe(null)
    expect(discordUserIdFromIdentities(undefined)).toBe(null)
  })
})

describe('turnNotificationMessage', () => {
  const base = {
    displayName: 'Alice',
    discordUserId: null,
    roomName: 'The Game Room',
    roomCode: 'AB12',
    phase: 'Picking',
    round: 3,
    gameUrl: null,
  }

  it('starts with the game title and includes the turn number and phase when given', () => {
    const message = turnNotificationMessage({ ...base, gameUrl: 'https://example.com/game/AB12' })
    expect(message).toBe(
      `**${GAME_TITLE}** — **Alice**, it's your turn in **[The Game Room](https://example.com/game/AB12)** (${TURN_LABEL} 3 · Picking).`,
    )
  })

  it('falls back to the room code when no game link is available', () => {
    const message = turnNotificationMessage(base)
    expect(message).toBe(`**${GAME_TITLE}** — **Alice**, it's your turn in **The Game Room** (${TURN_LABEL} 3 · Picking).\nRoom \`AB12\``)
  })

  it('omits whichever of the turn number and phase is missing', () => {
    expect(turnNotificationMessage({ ...base, phase: null })).toBe(`**${GAME_TITLE}** — **Alice**, it's your turn in **The Game Room** (${TURN_LABEL} 3).\nRoom \`AB12\``)
    expect(turnNotificationMessage({ ...base, round: null })).toBe(`**${GAME_TITLE}** — **Alice**, it's your turn in **The Game Room** (Picking).\nRoom \`AB12\``)
    expect(turnNotificationMessage({ ...base, round: null, phase: null })).toBe(`**${GAME_TITLE}** — **Alice**, it's your turn in **The Game Room**.\nRoom \`AB12\``)
  })

  it('@mentions the player by Discord ID instead of bolding their name when available', () => {
    const message = turnNotificationMessage({ ...base, discordUserId: '111222333' })
    expect(message).toBe(`**${GAME_TITLE}** — <@111222333>, it's your turn in **The Game Room** (${TURN_LABEL} 3 · Picking).\nRoom \`AB12\``)
  })
})

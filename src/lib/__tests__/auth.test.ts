import { afterEach, describe, expect, it, vi } from 'vitest'

// signInAsGuest() only needs to prove it refuses before touching Supabase,
// so the real client (which needs VITE_SUPABASE_URL/ANON_KEY) is unnecessary.
vi.mock('../supabase', () => ({ supabase: {} }))

const { isGuestAuthAllowed, signInAsGuest } = await import('../auth')

describe('isGuestAuthAllowed', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('is true by default, including in a production build', () => {
    vi.stubEnv('VITE_ALLOW_GUEST_AUTH', undefined)
    vi.stubEnv('VITE_ENVIRONMENT', undefined)
    expect(isGuestAuthAllowed()).toBe(true)
  })

  it('is true when explicitly opted in', () => {
    vi.stubEnv('VITE_ALLOW_GUEST_AUTH', 'true')
    vi.stubEnv('VITE_ENVIRONMENT', 'Preview')
    expect(isGuestAuthAllowed()).toBe(true)
  })

  it('is false when a deploy opts out with VITE_ALLOW_GUEST_AUTH=false', () => {
    vi.stubEnv('VITE_ALLOW_GUEST_AUTH', 'false')
    expect(isGuestAuthAllowed()).toBe(false)
    vi.stubEnv('VITE_ALLOW_GUEST_AUTH', ' FALSE ')
    expect(isGuestAuthAllowed()).toBe(false)
  })
})

describe('signInAsGuest', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('refuses to sign in when guest auth is turned off, without touching Supabase', async () => {
    vi.stubEnv('VITE_ALLOW_GUEST_AUTH', 'false')
    await expect(signInAsGuest()).rejects.toThrow('Guest sign-in is not available')
  })
})

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { gaxios } from 'google-auth-library'
import { GoogleOAuthMissingScopesError, GoogleOAuthService } from '../src/oauth/google/googleOAuthService'

type StubGoogleClient = {
  getToken: (options: unknown) => Promise<{ tokens: Record<string, unknown> }>
  verifyIdToken: (options: unknown) => Promise<{ getPayload: () => Record<string, unknown> | undefined }>
  revokeToken: (token: string) => Promise<unknown>
}

const setClient = (service: GoogleOAuthService, client: StubGoogleClient) => {
  ;(service as any).client = client
}

test('GoogleOAuthService.exchangeAuthCode returns granted scopes and raw scope string', async () => {
  const service = new GoogleOAuthService({ clientId: 'web-client', clientSecret: 'secret' })

  setClient(service, {
    getToken: async () => ({
      tokens: {
        id_token: 'id-token',
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        scope: 'openid email email profile',
      },
    }),
    verifyIdToken: async () => ({
      getPayload: () => ({
        sub: 'google-sub',
        email: 'person@example.com',
        email_verified: true,
        given_name: 'Ada',
        family_name: 'Lovelace',
      }),
    }),
    revokeToken: async () => undefined,
  })

  const result = await service.exchangeAuthCode('auth-code')
  assert.equal(result.success, true)
  if (!result.success) return

  assert.equal(result.data.scope, 'openid email email profile')
  assert.deepEqual(result.data.grantedScopes, ['openid', 'email', 'profile'])
  assert.equal(result.data.idToken, 'id-token')
  assert.equal(result.data.accessToken, 'access-token')
  assert.equal(result.data.refreshToken, 'refresh-token')
  assert.equal(result.data.user.email, 'person@example.com')
})

test('GoogleOAuthService.exchangeAuthCode returns missing scope error when required scopes are absent', async () => {
  const service = new GoogleOAuthService({ clientId: 'web-client', clientSecret: 'secret' })

  setClient(service, {
    getToken: async () => ({
      tokens: {
        id_token: 'id-token',
        scope: 'openid email',
      },
    }),
    verifyIdToken: async () => ({
      getPayload: () => ({
        sub: 'google-sub',
        email: 'person@example.com',
      }),
    }),
    revokeToken: async () => undefined,
  })

  const result = await service.exchangeAuthCode('auth-code', {
    requiredScopes: ['email', 'https://www.googleapis.com/auth/drive.file'],
  })

  assert.equal(result.success, false)
  if (result.success) return

  assert.ok(result.error instanceof GoogleOAuthMissingScopesError)
  const missing = result.error as GoogleOAuthMissingScopesError
  assert.deepEqual(missing.missingScopes, ['https://www.googleapis.com/auth/drive.file'])
  assert.deepEqual(missing.grantedScopes, ['openid', 'email'])
})

test('GoogleOAuthService.revokeToken returns success for valid token', async () => {
  const service = new GoogleOAuthService({ clientId: 'web-client', clientSecret: 'secret' })

  let revokedToken: string | undefined
  setClient(service, {
    getToken: async () => ({ tokens: {} }),
    verifyIdToken: async () => ({ getPayload: () => undefined }),
    revokeToken: async (token: string) => {
      revokedToken = token
      return undefined
    },
  })

  const result = await service.revokeToken('refresh-token')
  assert.deepEqual(result, { success: true })
  assert.equal(revokedToken, 'refresh-token')
})

test('GoogleOAuthService.revokeToken normalizes gaxios errors', async () => {
  const service = new GoogleOAuthService({ clientId: 'web-client', clientSecret: 'secret' })

  setClient(service, {
    getToken: async () => ({ tokens: {} }),
    verifyIdToken: async () => ({ getPayload: () => undefined }),
    revokeToken: async () => {
      throw new gaxios.GaxiosError(
        'Request failed',
        { url: 'https://oauth2.googleapis.com/revoke', method: 'POST' },
        {
          status: 400,
          statusText: 'Bad Request',
          data: { error: 'invalid_token', error_description: 'Token was not found' },
          headers: {},
          config: {},
          request: {},
        } as any
      )
    },
  })

  const result = await service.revokeToken('bad-token')
  assert.equal(result.success, false)
  if (result.success) return

  assert.match(result.error.message, /token revoke failed/)
  assert.match(result.error.message, /HTTP 400 Bad Request/)
  assert.match(result.error.message, /invalid_token/)
})

test('GoogleOAuthService.normalizeExchangeError includes Google OAuth error fields when present', () => {
  const service = new GoogleOAuthService({ clientId: 'web-client', clientSecret: 'secret' })

  const err = new gaxios.GaxiosError(
    'Request failed',
    { url: 'https://oauth2.googleapis.com/token', method: 'POST' },
    {
      status: 400,
      statusText: 'Bad Request',
      data: { error: 'invalid_grant', error_description: 'Bad Request' },
      headers: {},
      config: {},
      request: {},
    } as any
  )

  const normalized = (service as any).normalizeExchangeError(err) as Error
  assert.match(normalized.message, /token exchange failed/)
  assert.match(normalized.message, /HTTP 400 Bad Request/)
  assert.match(normalized.message, /invalid_grant/)
  assert.match(normalized.message, /Bad Request/)
  assert.equal((normalized as any).cause, err)
})

test('GoogleOAuthService.normalizeExchangeError parses JSON string response bodies', () => {
  const service = new GoogleOAuthService({ clientId: 'web-client', clientSecret: 'secret' })

  const err = new gaxios.GaxiosError(
    'Request failed',
    { url: 'https://oauth2.googleapis.com/token', method: 'POST' },
    {
      status: 400,
      statusText: 'Bad Request',
      data: JSON.stringify({ error: 'redirect_uri_mismatch', error_description: 'Mismatch' }),
      headers: {},
      config: {},
      request: {},
    } as any
  )

  const normalized = (service as any).normalizeExchangeError(err) as Error
  assert.match(normalized.message, /HTTP 400/)
  assert.match(normalized.message, /redirect_uri_mismatch/)
  assert.match(normalized.message, /Mismatch/)
})

test('GoogleOAuthService.normalizeExchangeError falls back to error.code for network failures', () => {
  const service = new GoogleOAuthService({ clientId: 'web-client', clientSecret: 'secret' })

  const err = new Error('socket hang up') as NodeJS.ErrnoException
  err.code = 'ECONNRESET'

  const normalized = (service as any).normalizeExchangeError(err) as Error
  assert.match(normalized.message, /ECONNRESET/)
  assert.match(normalized.message, /socket hang up/)
})

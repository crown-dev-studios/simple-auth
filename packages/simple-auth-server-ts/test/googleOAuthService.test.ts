import assert from 'node:assert/strict'
import { test } from 'node:test'

import { gaxios } from 'google-auth-library'
import { GoogleOAuthService } from '../src/oauth/google/googleOAuthService'

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

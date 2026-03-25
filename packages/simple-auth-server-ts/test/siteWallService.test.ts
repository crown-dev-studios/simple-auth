import assert from 'node:assert/strict'
import { test } from 'node:test'

import { SiteWallService } from '../src/site-wall/siteWallService'

const makeService = (overrides?: Partial<ConstructorParameters<typeof SiteWallService>[0]>) =>
  new SiteWallService({
    env: 'test',
    password: 'test-password',
    secret: 'test-secret-key',
    ...overrides,
  })

// --- verifyPassword ---

test('verifyPassword returns token and cookie config on correct password', () => {
  const service = makeService()
  const result = service.verifyPassword('test-password')

  assert.equal(result.success, true)
  if (!result.success) return

  assert.ok(result.data.token.startsWith('v1.'))
  assert.equal(result.data.token.split('.').length, 3)
  assert.ok(result.data.expiresAt > Math.floor(Date.now() / 1000))
  assert.deepEqual(result.data.cookie, {
    name: 'site_wall',
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    path: '/',
    maxAge: 2_592_000,
  })
})

test('verifyPassword trims whitespace from input', () => {
  const service = makeService()
  const result = service.verifyPassword('  test-password  ')
  assert.equal(result.success, true)
})

test('verifyPassword returns INVALID_PASSWORD on wrong password', () => {
  const service = makeService()
  const result = service.verifyPassword('wrong-password')

  assert.equal(result.success, false)
  if (result.success) return
  assert.equal(result.error.code, 'INVALID_PASSWORD')
})

test('verifyPassword returns INVALID_PASSWORD on empty string', () => {
  const service = makeService()
  const result = service.verifyPassword('')

  assert.equal(result.success, false)
  if (result.success) return
  assert.equal(result.error.code, 'INVALID_PASSWORD')
})

// --- verifyAccessToken ---

test('verifyAccessToken validates a token created by verifyPassword', () => {
  const service = makeService()
  const create = service.verifyPassword('test-password')
  assert.equal(create.success, true)
  if (!create.success) return

  const verify = service.verifyAccessToken(create.data.token)
  assert.equal(verify.success, true)
  if (!verify.success) return
  assert.equal(verify.data.expiresAt, create.data.expiresAt)
})

test('verifyAccessToken rejects tampered signature', () => {
  const service = makeService()
  const create = service.verifyPassword('test-password')
  assert.equal(create.success, true)
  if (!create.success) return

  const tampered = create.data.token.slice(0, -4) + 'dead'
  const result = service.verifyAccessToken(tampered)
  assert.equal(result.success, false)
  if (result.success) return
  assert.equal(result.error.code, 'INVALID_ACCESS_TOKEN')
})

test('verifyAccessToken rejects tampered expiresAt', () => {
  const service = makeService()
  const create = service.verifyPassword('test-password')
  assert.equal(create.success, true)
  if (!create.success) return

  const parts = create.data.token.split('.')
  const tampered = `${parts[0]}.${Number(parts[1]) + 1000}.${parts[2]}`
  const result = service.verifyAccessToken(tampered)
  assert.equal(result.success, false)
  if (result.success) return
  assert.equal(result.error.code, 'INVALID_ACCESS_TOKEN')
})

test('verifyAccessToken rejects expired token', () => {
  const service = makeService({ tokenTtlSeconds: -1 })
  const create = service.verifyPassword('test-password')
  assert.equal(create.success, true)
  if (!create.success) return

  const result = service.verifyAccessToken(create.data.token)
  assert.equal(result.success, false)
  if (result.success) return
  assert.equal(result.error.code, 'INVALID_ACCESS_TOKEN')
  assert.ok(result.error.message.includes('expired'))
})

test('verifyAccessToken rejects malformed tokens', () => {
  const service = makeService()

  for (const bad of ['', 'garbage', 'a.b', 'v1.notanumber.sig', 'v2.9999999999.abc']) {
    const result = service.verifyAccessToken(bad)
    assert.equal(result.success, false, `Expected failure for: "${bad}"`)
  }
})

// --- password rotation ---

test('rotating password invalidates existing tokens', () => {
  const service1 = makeService({ password: 'old-password' })
  const create = service1.verifyPassword('old-password')
  assert.equal(create.success, true)
  if (!create.success) return

  const service2 = makeService({ password: 'new-password' })
  const result = service2.verifyAccessToken(create.data.token)
  assert.equal(result.success, false)
})

// --- getCookieConfig ---

test('getCookieConfig sets secure=true in production', () => {
  const service = makeService({ env: 'production' })
  assert.equal(service.getCookieConfig().secure, true)
})

test('getCookieConfig sets secure=false in development', () => {
  const service = makeService({ env: 'development' })
  assert.equal(service.getCookieConfig().secure, false)
})

test('getCookieConfig uses custom cookie name', () => {
  const service = makeService({ cookieName: 'my_wall' })
  assert.equal(service.getCookieConfig().name, 'my_wall')
})

test('getCookieConfig uses custom TTL', () => {
  const service = makeService({ tokenTtlSeconds: 3600 })
  assert.equal(service.getCookieConfig().maxAge, 3600)
})

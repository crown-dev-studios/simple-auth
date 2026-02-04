import assert from 'node:assert/strict'
import { test } from 'node:test'

import { AuthSessionService } from '../src/session/authSessionService'
import { FakeRedis } from './fakeRedis'

test('AuthSessionService.updateSession does not throw on corrupted JSON', async () => {
  const redis = new FakeRedis()
  const service = new AuthSessionService(redis, { sessionTtlSeconds: 60 })

  const sessionId = 'a'.repeat(64)
  const key = `auth_session:${sessionId}`
  await redis.setex(key, 60, 'not-json')

  const result = await service.updateSession(sessionId, (session) => session)
  assert.equal(result.success, false)
  assert.equal(result.error, 'Session corrupted, please start over')
  assert.equal(await redis.get(key), null)
})

test('AuthSessionService rejects malformed session IDs before hitting Redis', async () => {
  const redis = new FakeRedis()
  const service = new AuthSessionService(redis)

  const result = await service.getSession('not-a-session-id')
  assert.equal(result.success, false)
  assert.equal(result.error, 'Session not found or expired')
})

test('AuthSessionService preserves TTL when updating session data', async () => {
  const redis = new FakeRedis()
  const service = new AuthSessionService(redis, { sessionTtlSeconds: 10 })

  const created = await service.createSession('user@example.com')
  assert.equal(created.success, true)

  const key = `auth_session:${created.data}`
  redis.advanceBy(9000)

  const ttlBefore = await redis.ttl(key)
  assert.ok(ttlBefore > 0 && ttlBefore <= 2)

  const updated = await service.updateSession(created.data, (session) => ({
    ...session,
    emailVerified: true,
  }))
  assert.equal(updated.success, true)

  const ttlAfter = await redis.ttl(key)
  assert.ok(ttlAfter <= ttlBefore)
})


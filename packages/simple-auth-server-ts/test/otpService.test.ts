import assert from 'node:assert/strict'
import { test } from 'node:test'

import { OtpService } from '../src/otp/otpService'
import { FakeRedis } from './fakeRedis'

test('OtpService preserves TTL when incrementing attempts', async () => {
  const redis = new FakeRedis()
  const service = new OtpService(redis, { env: 'test', ttlSeconds: 10, maxAttempts: 5, bypassCode: '111111' })

  const generate = await service.generateEmailOtp('User@Example.com')
  assert.equal(generate.success, true)

  const key = 'otp:email:user@example.com'
  redis.advanceBy(9000)

  const ttlBefore = await redis.ttl(key)
  assert.ok(ttlBefore > 0 && ttlBefore <= 2)

  const verify = await service.verifyEmailOtp('user@example.com', '000000')
  assert.equal(verify.success, false)
  assert.equal(verify.error.code, 'INVALID_CODE')

  const ttlAfter = await redis.ttl(key)
  assert.ok(ttlAfter <= ttlBefore)
})

test('OtpService deletes OTP after max attempts is exceeded', async () => {
  const redis = new FakeRedis()
  const service = new OtpService(redis, { env: 'test', ttlSeconds: 60, maxAttempts: 2, bypassCode: '111111' })

  const generate = await service.generateEmailOtp('user@example.com')
  assert.equal(generate.success, true)

  const key = 'otp:email:user@example.com'

  const attempt1 = await service.verifyEmailOtp('user@example.com', '000000')
  assert.equal(attempt1.success, false)
  assert.equal(attempt1.error.code, 'INVALID_CODE')
  assert.equal((await redis.get(key)) !== null, true)

  const attempt2 = await service.verifyEmailOtp('user@example.com', '000000')
  assert.equal(attempt2.success, false)
  assert.equal(attempt2.error.code, 'INVALID_CODE')
  assert.equal((await redis.get(key)) !== null, true)

  const attempt3 = await service.verifyEmailOtp('user@example.com', '000000')
  assert.equal(attempt3.success, false)
  assert.equal(attempt3.error.code, 'MAX_ATTEMPTS')
  assert.equal(await redis.get(key), null)
})

test('OtpService treats corrupted JSON as not found and deletes key', async () => {
  const redis = new FakeRedis()
  const service = new OtpService(redis, { env: 'test', ttlSeconds: 60 })

  const key = 'otp:email:user@example.com'
  await redis.setex(key, 60, 'not-json')

  const result = await service.verifyEmailOtp('user@example.com', '000000')
  assert.equal(result.success, false)
  assert.equal(result.error.code, 'NOT_FOUND')
  assert.equal(await redis.get(key), null)
})

// --- Domain locking ---

test('checkEmailDomain allows email when domain is in allowedDomains', () => {
  const redis = new FakeRedis()
  const service = new OtpService(redis, { env: 'test', allowedDomains: ['crown.dev', 'example.com'] })

  const result = service.checkEmailDomain('user@crown.dev')
  assert.equal(result.success, true)
  if (result.success) assert.equal(result.data.domain, 'crown.dev')
})

test('checkEmailDomain rejects email when domain is not in allowedDomains', () => {
  const redis = new FakeRedis()
  const service = new OtpService(redis, { env: 'test', allowedDomains: ['crown.dev'] })

  const result = service.checkEmailDomain('user@gmail.com')
  assert.equal(result.success, false)
  if (!result.success) {
    assert.equal(result.error.code, 'DOMAIN_NOT_ALLOWED')
    assert.equal(result.error.domain, 'gmail.com')
    assert.deepEqual(result.error.allowedDomains, ['crown.dev'])
  }
})

test('checkEmailDomain is case-insensitive', () => {
  const redis = new FakeRedis()
  const service = new OtpService(redis, { env: 'test', allowedDomains: ['Crown.Dev'] })

  const result = service.checkEmailDomain('User@CROWN.DEV')
  assert.equal(result.success, true)
})

test('checkEmailDomain allows all domains when allowedDomains is not configured', () => {
  const redis = new FakeRedis()
  const service = new OtpService(redis, { env: 'test' })

  const result = service.checkEmailDomain('user@anything.com')
  assert.equal(result.success, true)
})

test('generateEmailOtp rejects disallowed domain before generating code', async () => {
  const redis = new FakeRedis()
  const service = new OtpService(redis, { env: 'test', allowedDomains: ['crown.dev'] })

  const result = await service.generateEmailOtp('user@gmail.com')
  assert.equal(result.success, false)
  if (!result.success) assert.equal(result.error.code, 'DOMAIN_NOT_ALLOWED')

  // No OTP key should have been created
  const key = 'otp:email:user@gmail.com'
  assert.equal(await redis.get(key), null)
})

test('generateEmailOtp allows email with permitted domain', async () => {
  const redis = new FakeRedis()
  const service = new OtpService(redis, { env: 'test', allowedDomains: ['crown.dev'], bypassCode: '111111' })

  const result = await service.generateEmailOtp('user@crown.dev')
  assert.equal(result.success, true)
})

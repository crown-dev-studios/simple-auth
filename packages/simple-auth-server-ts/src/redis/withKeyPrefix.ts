import type { RedisLike } from './types'

export const withKeyPrefix = (redis: RedisLike, keyPrefix: string): RedisLike => {
  const prefix = keyPrefix.endsWith(':') ? keyPrefix : `${keyPrefix}:`

  return {
    get: (key) => redis.get(`${prefix}${key}`),
    setex: (key, seconds, value) => redis.setex(`${prefix}${key}`, seconds, value),
    del: (key) => redis.del(`${prefix}${key}`),
    incr: (key) => redis.incr(`${prefix}${key}`),
    expire: (key, seconds) => redis.expire(`${prefix}${key}`, seconds),
    ttl: (key) => redis.ttl(`${prefix}${key}`),
  }
}


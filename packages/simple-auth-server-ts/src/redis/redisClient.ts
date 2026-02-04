import Redis from 'ioredis'
import { SimpleAuthServerConfigSchema, type SimpleAuthServerConfig } from '@crown-dev-studios/simple-auth-shared-types'
import type { RedisLike } from './types'
import { withKeyPrefix } from './withKeyPrefix'

export interface CreateRedisClientOptions {
  url?: string
  keyPrefix?: string
}

/**
 * Default Redis URL for local development.
 */
export const getDefaultRedisUrl = (): string => 'redis://localhost:6379'

export const createRedisClient = (options: CreateRedisClientOptions = {}): RedisLike => {
  const url = options.url ?? process.env.REDIS_URL ?? getDefaultRedisUrl()

  const client = new Redis(url, {
    retryStrategy: (times) => {
      if (times > 10) return null
      return Math.min(times * 100, 3000)
    },
    lazyConnect: false,
  })

  const redis: RedisLike = {
    get: (key) => client.get(key),
    setex: (key, seconds, value) => client.setex(key, seconds, value),
    del: (key) => client.del(key),
    incr: (key) => client.incr(key),
    expire: (key, seconds) => client.expire(key, seconds),
    ttl: (key) => client.ttl(key),
  }

  return options.keyPrefix ? withKeyPrefix(redis, options.keyPrefix) : redis
}

export const createRedisClientFromConfig = (config: SimpleAuthServerConfig): RedisLike => {
  const parsed = SimpleAuthServerConfigSchema.parse(config)
  return createRedisClient({
    url: parsed.redis.url,
    keyPrefix: parsed.redis.keyPrefix,
  })
}

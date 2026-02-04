import type { RedisLike } from '../src/redis/types'

type Entry = {
  value: string
  expiresAtMs: number | null
}

export class FakeRedis implements RedisLike {
  private nowMs = 0
  private readonly entries = new Map<string, Entry>()

  advanceBy(ms: number): void {
    this.nowMs += Math.max(ms, 0)
  }

  private getEntry(key: string): Entry | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    if (entry.expiresAtMs !== null && entry.expiresAtMs <= this.nowMs) {
      this.entries.delete(key)
      return undefined
    }
    return entry
  }

  async get(key: string): Promise<string | null> {
    return this.getEntry(key)?.value ?? null
  }

  async setex(key: string, seconds: number, value: string): Promise<unknown> {
    this.entries.set(key, { value, expiresAtMs: this.nowMs + Math.max(seconds, 0) * 1000 })
    return 'OK'
  }

  async del(key: string): Promise<number> {
    const existed = this.getEntry(key) !== undefined
    this.entries.delete(key)
    return existed ? 1 : 0
  }

  async incr(key: string): Promise<number> {
    const entry = this.getEntry(key)
    const current = entry ? Number.parseInt(entry.value, 10) || 0 : 0
    const next = current + 1

    this.entries.set(key, {
      value: String(next),
      expiresAtMs: entry?.expiresAtMs ?? null,
    })

    return next
  }

  async expire(key: string, seconds: number): Promise<number> {
    const entry = this.getEntry(key)
    if (!entry) return 0
    this.entries.set(key, { value: entry.value, expiresAtMs: this.nowMs + Math.max(seconds, 0) * 1000 })
    return 1
  }

  async ttl(key: string): Promise<number> {
    const entry = this.getEntry(key)
    if (!entry) return -2
    if (entry.expiresAtMs === null) return -1

    const remainingMs = entry.expiresAtMs - this.nowMs
    if (remainingMs <= 0) {
      this.entries.delete(key)
      return -2
    }

    return Math.floor(remainingMs / 1000)
  }
}


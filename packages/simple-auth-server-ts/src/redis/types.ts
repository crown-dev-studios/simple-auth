export type RedisLike = {
  get: (key: string) => Promise<string | null>
  setex: (key: string, seconds: number, value: string) => Promise<unknown>
  del: (key: string) => Promise<number>
  incr: (key: string) => Promise<number>
  expire: (key: string, seconds: number) => Promise<number>
  ttl: (key: string) => Promise<number>
}


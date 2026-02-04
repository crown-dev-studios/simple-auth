from __future__ import annotations

from dataclasses import dataclass
from typing import Awaitable, Callable, Optional, Protocol

import redis.asyncio as redis


def get_default_redis_url() -> str:
    return "redis://localhost:6379"


class RedisLike(Protocol):
    async def get(self, key: str) -> Optional[str]: ...
    async def setex(self, key: str, time: int, value: str) -> object: ...
    async def delete(self, key: str) -> int: ...
    async def incr(self, key: str) -> int: ...
    async def expire(self, key: str, time: int) -> bool: ...
    async def ttl(self, key: str) -> int: ...


def create_redis_client(url: Optional[str] = None) -> redis.Redis:
    return redis.from_url(url or get_default_redis_url(), decode_responses=True)


@dataclass(frozen=True)
class _KeyPrefixRedis:
    redis: RedisLike
    prefix: str

    def _k(self, key: str) -> str:
        return f"{self.prefix}{key}"

    async def get(self, key: str) -> Optional[str]:
        return await self.redis.get(self._k(key))

    async def setex(self, key: str, time: int, value: str) -> object:
        return await self.redis.setex(self._k(key), time, value)

    async def delete(self, key: str) -> int:
        return await self.redis.delete(self._k(key))

    async def incr(self, key: str) -> int:
        return await self.redis.incr(self._k(key))

    async def expire(self, key: str, time: int) -> bool:
        return await self.redis.expire(self._k(key), time)

    async def ttl(self, key: str) -> int:
        return await self.redis.ttl(self._k(key))


def with_key_prefix(redis_client: RedisLike, key_prefix: str) -> RedisLike:
    prefix = key_prefix if key_prefix.endswith(":") else f"{key_prefix}:"
    return _KeyPrefixRedis(redis=redis_client, prefix=prefix)

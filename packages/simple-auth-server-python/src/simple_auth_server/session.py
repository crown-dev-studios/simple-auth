from __future__ import annotations

import json
import re
import time
from typing import Optional, TypedDict

from .redis_client import RedisLike


_SESSION_PREFIX = "auth_session:"
_DEFAULT_TTL_SECONDS = 24 * 60 * 60
_SESSION_ID_RE = re.compile(r"^[0-9a-f]{64}$")


class AuthSession(TypedDict):
    email: str
    emailVerified: bool
    phoneNumber: Optional[str]
    phoneVerified: bool
    createdAt: int
    expiresAt: int


def _generate_session_id() -> str:
    # 32 bytes hex
    import secrets

    return secrets.token_hex(32)

def _normalize_session_id(session_id: str) -> str:
    return session_id.strip().lower()

def _is_valid_session_id(session_id: str) -> bool:
    return bool(_SESSION_ID_RE.fullmatch(session_id))


class AuthSessionService:
    def __init__(
        self,
        redis: RedisLike,
        session_ttl_seconds: int = _DEFAULT_TTL_SECONDS,
        key_prefix: str = _SESSION_PREFIX,
    ) -> None:
        self._redis = redis
        self._ttl_seconds = session_ttl_seconds
        self._key_prefix = key_prefix

    async def create_session(self, email: str) -> str:
        session_id = _generate_session_id()
        now_ms = int(time.time() * 1000)
        session: AuthSession = {
            "email": email.strip().lower(),
            "emailVerified": False,
            "phoneNumber": None,
            "phoneVerified": False,
            "createdAt": now_ms,
            "expiresAt": now_ms + self._ttl_seconds * 1000,
        }
        await self._redis.setex(f"{self._key_prefix}{session_id}", self._ttl_seconds, json.dumps(session))
        return session_id

    async def get_session(self, session_id: str) -> Optional[AuthSession]:
        normalized = _normalize_session_id(session_id)
        if not _is_valid_session_id(normalized):
            return None

        key = f"{self._key_prefix}{normalized}"
        raw = await self._redis.get(key)
        if raw is None:
            return None
        try:
            parsed: AuthSession = json.loads(raw)
        except Exception:
            await self._redis.delete(key)
            return None

        if int(time.time() * 1000) > int(parsed.get("expiresAt", 0)):
            await self._redis.delete(key)
            return None

        return parsed

    async def delete_session(self, session_id: str) -> None:
        normalized = _normalize_session_id(session_id)
        if not _is_valid_session_id(normalized):
            return

        await self._redis.delete(f"{self._key_prefix}{normalized}")

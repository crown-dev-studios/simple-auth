from __future__ import annotations

import json
import hmac
import re
import secrets
import time
from typing import Literal, Optional, TypedDict

from .config import Env, OtpConfig
from .redis_client import RedisLike


OtpType = Literal["email", "phone"]


class OtpError(TypedDict):
    code: Literal["RATE_LIMITED", "INVALID_CODE", "EXPIRED", "MAX_ATTEMPTS", "NOT_FOUND"]
    message: str
    retry_after_seconds: Optional[int]
    attempts_remaining: Optional[int]


class _StoredOtp(TypedDict):
    code: str
    attempts: int
    createdAt: int


_EMAIL_PREFIX = "otp:email:"
_PHONE_PREFIX = "otp:phone:"
_RATE_PREFIX = "rate:otp:"


def _normalize_email(email: str) -> str:
    return email.strip().lower()


def _normalize_phone(phone: str) -> str:
    # Keep + and digits only
    return re.sub(r"[^\d+]", "", phone)


def _generate_random_code(length: int) -> str:
    # Leading zeros allowed
    length = max(1, int(length))
    max_value = 10**length
    return str(secrets.randbelow(max_value)).zfill(length)


def _bypass_enabled(env: Env, bypass_code: Optional[str]) -> bool:
    return env != "production" and bool(bypass_code)


async def _check_rate_limit(
    redis: RedisLike, key: str, window_seconds: int, max_requests: int
) -> tuple[bool, Optional[int]]:
    count = await redis.incr(key)
    if count == 1:
        await redis.expire(key, window_seconds)

    if count > max_requests:
        ttl = await redis.ttl(key)
        return False, max(ttl, 1)

    return True, None


class OtpService:
    def __init__(self, redis: RedisLike, env: Env, config: OtpConfig = OtpConfig()) -> None:
        self._redis = redis
        self._env = env
        self._config = config

    async def generate_email_otp(self, email: str) -> tuple[bool, str | OtpError]:
        return await self._generate("email", _normalize_email(email))

    async def verify_email_otp(self, email: str, code: str) -> tuple[bool, None | OtpError]:
        return await self._verify("email", _normalize_email(email), code)

    async def generate_phone_otp(self, phone: str) -> tuple[bool, str | OtpError]:
        return await self._generate("phone", _normalize_phone(phone))

    async def verify_phone_otp(self, phone: str, code: str) -> tuple[bool, None | OtpError]:
        return await self._verify("phone", _normalize_phone(phone), code)

    async def _generate(self, otp_type: OtpType, identifier: str) -> tuple[bool, str | OtpError]:
        allowed, retry_after = await _check_rate_limit(
            self._redis,
            f"{_RATE_PREFIX}{otp_type}:{identifier}",
            self._config.rate_limit.window_seconds,
            self._config.rate_limit.max_requests,
        )

        if not allowed:
            return False, {
                "code": "RATE_LIMITED",
                "message": "Too many OTP requests. Please wait before trying again.",
                "retry_after_seconds": retry_after,
                "attempts_remaining": None,
            }

        code = (
            self._config.bypass_code
            if _bypass_enabled(self._env, self._config.bypass_code)
            else _generate_random_code(self._config.code_length)
        )

        stored: _StoredOtp = {"code": code, "attempts": 0, "createdAt": int(time.time() * 1000)}
        key = f"{_EMAIL_PREFIX if otp_type == 'email' else _PHONE_PREFIX}{identifier}"
        await self._redis.setex(key, self._config.ttl_seconds, json.dumps(stored))
        return True, code

    async def _verify(self, otp_type: OtpType, identifier: str, code: str) -> tuple[bool, None | OtpError]:
        key = f"{_EMAIL_PREFIX if otp_type == 'email' else _PHONE_PREFIX}{identifier}"
        raw = await self._redis.get(key)
        if raw is None:
            return False, {
                "code": "NOT_FOUND",
                "message": "No OTP found. Please request a new code.",
                "retry_after_seconds": None,
                "attempts_remaining": None,
            }

        try:
            parsed: _StoredOtp = json.loads(raw)
        except Exception:
            await self._redis.delete(key)
            return False, {
                "code": "NOT_FOUND",
                "message": "No OTP found. Please request a new code.",
                "retry_after_seconds": None,
                "attempts_remaining": None,
            }

        attempts = int(parsed.get("attempts", 0))
        if attempts >= self._config.max_attempts:
            await self._redis.delete(key)
            return False, {
                "code": "MAX_ATTEMPTS",
                "message": "Maximum verification attempts exceeded. Please request a new code.",
                "retry_after_seconds": None,
                "attempts_remaining": None,
            }

        ttl = await self._redis.ttl(key)
        if ttl <= 0:
            await self._redis.delete(key)
            return False, {
                "code": "NOT_FOUND",
                "message": "No OTP found. Please request a new code.",
                "retry_after_seconds": None,
                "attempts_remaining": None,
            }

        # Increment attempts on every verification attempt.
        updated = {**parsed, "attempts": attempts + 1}
        await self._redis.setex(key, ttl, json.dumps(updated))

        stored_code = parsed.get("code", "")
        if not isinstance(stored_code, str) or not hmac.compare_digest(stored_code, code):
            remaining = self._config.max_attempts - updated["attempts"]
            return False, {
                "code": "INVALID_CODE",
                "message": "Invalid code. Please try again.",
                "retry_after_seconds": None,
                "attempts_remaining": remaining,
            }

        await self._redis.delete(key)
        return True, None

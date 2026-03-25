from __future__ import annotations

import asyncio

from simple_auth_server.config import OtpConfig
from simple_auth_server.otp import OtpService


def run(coro):
    return asyncio.run(coro)


class FakeRedis:
    def __init__(self):
        self._store: dict[str, tuple[str, float]] = {}

    async def get(self, key: str):
        entry = self._store.get(key)
        return entry[0] if entry else None

    async def setex(self, key: str, ttl: int, value: str):
        self._store[key] = (value, ttl)

    async def delete(self, key: str):
        self._store.pop(key, None)

    async def incr(self, key: str) -> int:
        entry = self._store.get(key)
        if entry is None:
            self._store[key] = ("1", 0)
            return 1
        count = int(entry[0]) + 1
        self._store[key] = (str(count), entry[1])
        return count

    async def expire(self, key: str, ttl: int):
        entry = self._store.get(key)
        if entry:
            self._store[key] = (entry[0], ttl)

    async def ttl(self, key: str) -> int:
        entry = self._store.get(key)
        return int(entry[1]) if entry else -2


def test_check_email_domain_allowed():
    redis = FakeRedis()
    service = OtpService(redis, "test", allowed_domains=["crown.dev", "example.com"])
    ok, err = service.check_email_domain("user@crown.dev")
    assert ok is True
    assert err is None


def test_check_email_domain_rejected():
    redis = FakeRedis()
    service = OtpService(redis, "test", allowed_domains=["crown.dev"])
    ok, err = service.check_email_domain("user@gmail.com")
    assert ok is False
    assert err is not None
    assert err["code"] == "DOMAIN_NOT_ALLOWED"


def test_check_email_domain_case_insensitive():
    redis = FakeRedis()
    service = OtpService(redis, "test", allowed_domains=["Crown.Dev"])
    ok, err = service.check_email_domain("User@CROWN.DEV")
    assert ok is True


def test_check_email_domain_no_restriction():
    redis = FakeRedis()
    service = OtpService(redis, "test")
    ok, err = service.check_email_domain("user@anything.com")
    assert ok is True


def test_generate_email_otp_rejects_disallowed_domain():
    redis = FakeRedis()
    service = OtpService(redis, "test", allowed_domains=["crown.dev"])
    ok, err = run(service.generate_email_otp("user@gmail.com"))
    assert ok is False
    assert err["code"] == "DOMAIN_NOT_ALLOWED"


def test_generate_email_otp_allows_permitted_domain():
    redis = FakeRedis()
    config = OtpConfig(bypass_code="111111")
    service = OtpService(redis, "test", config=config, allowed_domains=["crown.dev"])
    ok, code = run(service.generate_email_otp("user@crown.dev"))
    assert ok is True
    assert code == "111111"

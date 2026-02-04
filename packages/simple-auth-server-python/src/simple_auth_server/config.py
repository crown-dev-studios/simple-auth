from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Optional


Env = Literal["production", "development", "test"]


@dataclass(frozen=True)
class RedisConfig:
    url: Optional[str] = None
    key_prefix: Optional[str] = None


@dataclass(frozen=True)
class OtpRateLimitConfig:
    window_seconds: int = 60
    max_requests: int = 3


@dataclass(frozen=True)
class OtpConfig:
    code_length: int = 6
    ttl_seconds: int = 300
    max_attempts: int = 5
    rate_limit: OtpRateLimitConfig = OtpRateLimitConfig()
    bypass_code: Optional[str] = None


@dataclass(frozen=True)
class SimpleAuthProvidersConfig:
    email_otp_enabled: bool = True
    phone_otp_enabled: bool = True
    google_enabled: bool = False


@dataclass(frozen=True)
class SimpleAuthServerConfig:
    env: Env
    redis: RedisConfig = RedisConfig()
    otp: OtpConfig = OtpConfig()
    providers: SimpleAuthProvidersConfig = SimpleAuthProvidersConfig()

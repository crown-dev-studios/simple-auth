from __future__ import annotations

import hashlib
import hmac
import math
import time
from dataclasses import dataclass
from typing import Literal, Optional, TypedDict

from .config import Env, SiteWallConfig


class CookieConfig(TypedDict):
    name: str
    http_only: bool
    same_site: Literal["lax"]
    secure: bool
    path: str
    max_age: int


class SiteWallError(TypedDict):
    code: Literal["INVALID_PASSWORD", "INVALID_ACCESS_TOKEN"]
    message: str


@dataclass(frozen=True)
class VerifyPasswordResult:
    token: str
    expires_at: int
    cookie: CookieConfig


_TOKEN_VERSION = "v1"


class SiteWallService:
    def __init__(self, env: Env, config: SiteWallConfig) -> None:
        self._env = env
        self._config = config

    def verify_password(
        self, password: str
    ) -> tuple[bool, Optional[VerifyPasswordResult | SiteWallError]]:
        trimmed = password.strip()

        if not hmac.compare_digest(trimmed, self._config.password):
            return False, {"code": "INVALID_PASSWORD", "message": "Invalid password."}

        ttl = self._config.token_ttl_seconds
        expires_at = math.floor(time.time()) + ttl
        token = self._create_token(expires_at)

        return True, VerifyPasswordResult(
            token=token,
            expires_at=expires_at,
            cookie=self.get_cookie_config(),
        )

    def verify_access_token(
        self, token: str
    ) -> tuple[bool, Optional[dict[str, int] | SiteWallError]]:
        parts = token.split(".")
        if len(parts) != 3:
            return False, {"code": "INVALID_ACCESS_TOKEN", "message": "Malformed access token."}

        version, expires_at_str, signature = parts

        if version != _TOKEN_VERSION:
            return False, {"code": "INVALID_ACCESS_TOKEN", "message": "Invalid token version."}

        try:
            expires_at = int(expires_at_str)
        except ValueError:
            return False, {"code": "INVALID_ACCESS_TOKEN", "message": "Invalid token expiry."}

        if expires_at <= math.floor(time.time()):
            return False, {
                "code": "INVALID_ACCESS_TOKEN",
                "message": "Access token has expired.",
            }

        expected = self._sign(f"{_TOKEN_VERSION}.{expires_at_str}")
        if not hmac.compare_digest(signature, expected):
            return False, {"code": "INVALID_ACCESS_TOKEN", "message": "Invalid access token."}

        return True, {"expires_at": expires_at}

    def get_cookie_config(self) -> CookieConfig:
        return {
            "name": self._config.cookie_name,
            "http_only": True,
            "same_site": "lax",
            "secure": self._env == "production",
            "path": "/",
            "max_age": self._config.token_ttl_seconds,
        }

    def _create_token(self, expires_at: int) -> str:
        payload = f"{_TOKEN_VERSION}.{expires_at}"
        signature = self._sign(payload)
        return f"{payload}.{signature}"

    def _sign(self, data: str) -> str:
        key = f"{self._config.secret}:{self._config.password}"
        return hmac.new(key.encode(), data.encode(), hashlib.sha256).hexdigest()

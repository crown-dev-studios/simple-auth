from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

import httpx


@dataclass(frozen=True)
class GoogleOAuthConfig:
    client_id: str
    client_secret: str
    redirect_uri: Optional[str] = None


@dataclass(frozen=True)
class GoogleOAuthUserInfo:
    sub: str
    email: str
    email_verified: bool
    first_name: Optional[str]
    last_name: Optional[str]
    raw: dict[str, Any]


class GoogleOAuthService:
    def __init__(self, config: GoogleOAuthConfig, http_client: Optional[httpx.AsyncClient] = None) -> None:
        self._config = config
        self._http = http_client or httpx.AsyncClient(timeout=10.0)

    async def exchange_auth_code(self, auth_code: str) -> dict[str, Any]:
        token_payload = {
            "code": auth_code,
            "client_id": self._config.client_id,
            "client_secret": self._config.client_secret,
            "grant_type": "authorization_code",
        }
        if self._config.redirect_uri:
            token_payload["redirect_uri"] = self._config.redirect_uri

        token_resp = await self._http.post("https://oauth2.googleapis.com/token", data=token_payload)
        token_resp.raise_for_status()
        tokens = token_resp.json()

        access_token = tokens.get("access_token")
        if not access_token:
            raise ValueError("Missing access_token")

        userinfo_resp = await self._http.get(
            "https://www.googleapis.com/oauth2/v3/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        userinfo_resp.raise_for_status()
        user = userinfo_resp.json()

        return {
            "user": {
                "sub": user.get("sub"),
                "email": user.get("email"),
                "emailVerified": bool(user.get("email_verified", False)),
                "firstName": user.get("given_name"),
                "lastName": user.get("family_name"),
                "raw": user,
            },
            "refreshToken": tokens.get("refresh_token"),
            "accessToken": access_token,
            "idToken": tokens.get("id_token"),
            "expiresIn": tokens.get("expires_in"),
            "tokenType": tokens.get("token_type"),
            "scope": tokens.get("scope"),
        }


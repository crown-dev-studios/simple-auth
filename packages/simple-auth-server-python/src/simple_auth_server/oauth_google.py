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

    async def exchange_auth_code(self, auth_code: str, required_scopes: Optional[list[str]] = None) -> dict[str, Any]:
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

        scope = tokens.get("scope") if isinstance(tokens.get("scope"), str) else None
        granted_scopes = self._parse_scope_string(scope)

        normalized_required = self._normalize_scopes(required_scopes or [])
        if normalized_required:
            granted_scope_set = set(granted_scopes)
            missing = [entry for entry in normalized_required if entry not in granted_scope_set]
            if missing:
                raise ValueError(f"Missing required Google scopes: {', '.join(missing)}")

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
            "scope": scope,
            "grantedScopes": granted_scopes,
        }

    async def revoke_token(self, token: str) -> None:
        if not token or not token.strip():
            raise ValueError("Token is required")

        response = await self._http.post(
            "https://oauth2.googleapis.com/revoke",
            data={"token": token},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        response.raise_for_status()

    def _parse_scope_string(self, scope: Optional[str]) -> list[str]:
        if not scope:
            return []

        return self._normalize_scopes(scope.split())

    def _normalize_scopes(self, scopes: list[str]) -> list[str]:
        seen: set[str] = set()
        normalized: list[str] = []

        for scope in scopes:
            trimmed = scope.strip()
            if not trimmed or trimmed in seen:
                continue
            seen.add(trimmed)
            normalized.append(trimmed)

        return normalized

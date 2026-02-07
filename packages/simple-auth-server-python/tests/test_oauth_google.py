from __future__ import annotations

import asyncio
from urllib.parse import parse_qs

import httpx
import pytest

from simple_auth_server.oauth_google import GoogleOAuthConfig, GoogleOAuthService


def run(coro):
    return asyncio.run(coro)


def create_service(handler: httpx.MockTransport) -> tuple[GoogleOAuthService, httpx.AsyncClient]:
    client = httpx.AsyncClient(transport=handler)
    service = GoogleOAuthService(
        GoogleOAuthConfig(client_id="web-client", client_secret="secret", redirect_uri="myapp://oauth"),
        http_client=client,
    )
    return service, client


def test_exchange_auth_code_includes_granted_scopes_and_scope() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path == "/token":
            body = parse_qs(request.content.decode())
            assert body["code"] == ["auth-code"]
            assert body["client_id"] == ["web-client"]
            assert body["client_secret"] == ["secret"]
            assert body["redirect_uri"] == ["myapp://oauth"]
            return httpx.Response(
                200,
                json={
                    "access_token": "access",
                    "refresh_token": "refresh",
                    "id_token": "id",
                    "expires_in": 3600,
                    "token_type": "Bearer",
                    "scope": "openid email email profile",
                },
            )

        if request.url.path == "/oauth2/v3/userinfo":
            assert request.headers["Authorization"] == "Bearer access"
            return httpx.Response(
                200,
                json={
                    "sub": "google-sub",
                    "email": "person@example.com",
                    "email_verified": True,
                    "given_name": "Ada",
                    "family_name": "Lovelace",
                },
            )

        raise AssertionError(f"Unexpected path: {request.url.path}")

    service, client = create_service(httpx.MockTransport(handler))
    try:
        result = run(service.exchange_auth_code("auth-code", required_scopes=["email", "profile"]))
    finally:
        run(client.aclose())

    assert result["scope"] == "openid email email profile"
    assert result["grantedScopes"] == ["openid", "email", "profile"]
    assert result["accessToken"] == "access"
    assert result["refreshToken"] == "refresh"
    assert result["idToken"] == "id"
    assert result["user"]["email"] == "person@example.com"
    assert len(requests) == 2


def test_exchange_auth_code_raises_when_required_scope_missing() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/token":
            return httpx.Response(
                200,
                json={
                    "access_token": "access",
                    "id_token": "id",
                    "scope": "openid email",
                },
            )

        if request.url.path == "/oauth2/v3/userinfo":
            return httpx.Response(
                200,
                json={
                    "sub": "google-sub",
                    "email": "person@example.com",
                },
            )

        raise AssertionError(f"Unexpected path: {request.url.path}")

    service, client = create_service(httpx.MockTransport(handler))
    try:
        with pytest.raises(ValueError, match="Missing required Google scopes"):
            run(service.exchange_auth_code("auth-code", required_scopes=["email", "https://www.googleapis.com/auth/drive.file"]))
    finally:
        run(client.aclose())


def test_revoke_token_posts_to_google_revoke_endpoint() -> None:
    seen_body: dict[str, list[str]] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal seen_body
        assert request.url.path == "/revoke"
        seen_body = parse_qs(request.content.decode())
        assert request.headers["content-type"].startswith("application/x-www-form-urlencoded")
        return httpx.Response(200)

    service, client = create_service(httpx.MockTransport(handler))
    try:
        run(service.revoke_token("refresh-token"))
    finally:
        run(client.aclose())

    assert seen_body == {"token": ["refresh-token"]}


def test_revoke_token_rejects_empty_token() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        raise AssertionError("No HTTP request should be sent for empty token")

    service, client = create_service(httpx.MockTransport(handler))
    try:
        with pytest.raises(ValueError, match="Token is required"):
            run(service.revoke_token(" "))
    finally:
        run(client.aclose())


def test_revoke_token_raises_http_error_on_google_failure() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"error": "invalid_token"})

    service, client = create_service(httpx.MockTransport(handler))
    try:
        with pytest.raises(httpx.HTTPStatusError):
            run(service.revoke_token("bad-token"))
    finally:
        run(client.aclose())

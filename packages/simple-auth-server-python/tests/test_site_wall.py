from __future__ import annotations

import time

from simple_auth_server.config import SiteWallConfig
from simple_auth_server.site_wall import SiteWallService


def make_service(**overrides) -> SiteWallService:
    env = overrides.pop("env", "test")
    config = SiteWallConfig(
        password=overrides.pop("password", "test-password"),
        secret=overrides.pop("secret", "test-secret-key"),
        **overrides,
    )
    return SiteWallService(env=env, config=config)


# --- verify_password ---


def test_verify_password_correct():
    service = make_service()
    ok, result = service.verify_password("test-password")
    assert ok is True
    assert result is not None
    assert result.token.startswith("v1.")
    assert len(result.token.split(".")) == 3
    assert result.expires_at > int(time.time())
    assert result.cookie["name"] == "site_wall"
    assert result.cookie["http_only"] is True
    assert result.cookie["same_site"] == "lax"
    assert result.cookie["secure"] is False
    assert result.cookie["path"] == "/"
    assert result.cookie["max_age"] == 2_592_000


def test_verify_password_trims_whitespace():
    service = make_service()
    ok, _ = service.verify_password("  test-password  ")
    assert ok is True


def test_verify_password_wrong():
    service = make_service()
    ok, err = service.verify_password("wrong-password")
    assert ok is False
    assert err["code"] == "INVALID_PASSWORD"


def test_verify_password_empty():
    service = make_service()
    ok, err = service.verify_password("")
    assert ok is False
    assert err["code"] == "INVALID_PASSWORD"


# --- verify_access_token ---


def test_verify_access_token_roundtrip():
    service = make_service()
    ok, result = service.verify_password("test-password")
    assert ok is True

    ok2, data = service.verify_access_token(result.token)
    assert ok2 is True
    assert data["expires_at"] == result.expires_at


def test_verify_access_token_tampered_signature():
    service = make_service()
    ok, result = service.verify_password("test-password")
    assert ok is True

    tampered = result.token[:-4] + "dead"
    ok2, err = service.verify_access_token(tampered)
    assert ok2 is False
    assert err["code"] == "INVALID_ACCESS_TOKEN"


def test_verify_access_token_tampered_expiry():
    service = make_service()
    ok, result = service.verify_password("test-password")
    assert ok is True

    parts = result.token.split(".")
    tampered = f"{parts[0]}.{int(parts[1]) + 1000}.{parts[2]}"
    ok2, err = service.verify_access_token(tampered)
    assert ok2 is False
    assert err["code"] == "INVALID_ACCESS_TOKEN"


def test_verify_access_token_expired():
    service = make_service(token_ttl_seconds=-1)
    ok, result = service.verify_password("test-password")
    assert ok is True

    ok2, err = service.verify_access_token(result.token)
    assert ok2 is False
    assert err["code"] == "INVALID_ACCESS_TOKEN"
    assert "expired" in err["message"]


def test_verify_access_token_malformed():
    service = make_service()
    for bad in ["", "garbage", "a.b", "v1.notanumber.sig", "v2.9999999999.abc"]:
        ok, err = service.verify_access_token(bad)
        assert ok is False, f"Expected failure for: {bad!r}"


# --- password rotation ---


def test_password_rotation_invalidates_tokens():
    service1 = make_service(password="old-password")
    ok, result = service1.verify_password("old-password")
    assert ok is True

    service2 = make_service(password="new-password")
    ok2, _ = service2.verify_access_token(result.token)
    assert ok2 is False


# --- get_cookie_config ---


def test_cookie_secure_in_production():
    config = SiteWallConfig(password="p", secret="s")
    service = SiteWallService(env="production", config=config)
    assert service.get_cookie_config()["secure"] is True


def test_cookie_not_secure_in_development():
    config = SiteWallConfig(password="p", secret="s")
    service = SiteWallService(env="development", config=config)
    assert service.get_cookie_config()["secure"] is False


def test_cookie_custom_name():
    service = make_service(cookie_name="my_wall")
    assert service.get_cookie_config()["name"] == "my_wall"


def test_cookie_custom_ttl():
    service = make_service(token_ttl_seconds=3600)
    assert service.get_cookie_config()["max_age"] == 3600

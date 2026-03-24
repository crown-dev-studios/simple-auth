# simple-auth-server

Async Python server primitives for auth flows. This package provides Redis-backed
OTP and session services plus a Google OAuth auth-code exchange helper, while
leaving framework integration, persistence, messaging, and token minting to your
application.

## Best For

- FastAPI or other async Python backends
- OTP onboarding flows backed by Redis
- Google auth-code exchange handled on the server

## Install

```sh
pip install simple-auth-server
```

For local development from this repo:

```sh
pip install -e packages/simple-auth-server-python
```

## Quick Start

```python
from simple_auth_server.redis_client import create_redis_client
from simple_auth_server.otp import OtpService
from simple_auth_server.session import AuthSessionService
from simple_auth_server.oauth_google import GoogleOAuthService, GoogleOAuthConfig

redis = create_redis_client()

otp_service = OtpService(redis=redis, env="development")
session_service = AuthSessionService(redis=redis)
google_oauth = GoogleOAuthService(GoogleOAuthConfig(
    client_id="your-client-id",
    client_secret="your-client-secret",
))
```

## What It Includes

### Redis Helpers

- `create_redis_client(url=None)`
- `with_key_prefix(redis_client, key_prefix)`

The Redis protocol is intentionally small so you can swap in your own compatible
client if needed.

### OTP Service

`OtpService` supports email and phone verification codes with:

- rate limiting
- max attempt tracking
- fixed bypass codes for non-production use

Example:

```python
ok, result = await otp_service.generate_email_otp("user@example.com")
if ok:
    code = result
else:
    error = result
```

Verification errors use these codes:

- `RATE_LIMITED`
- `INVALID_CODE`
- `MAX_ATTEMPTS`
- `NOT_FOUND`

### Auth Session Service

`AuthSessionService` stores short-lived onboarding state in Redis.

```python
session_id = await session_service.create_session("user@example.com")
session = await session_service.get_session(session_id)
```

Current methods:

- `create_session(email)`
- `get_session(session_id)`
- `update_session(session_id, updater)`
- `delete_session(session_id)`

Sessions track email verification state, phone state, and can hold additional
JSON-safe onboarding metadata through `update_session`.

### Google OAuth Service

`GoogleOAuthService` exchanges a Google auth code on the backend.

```python
result = await google_oauth.exchange_auth_code(
    auth_code,
    required_scopes=["email", "profile"],
)
```

Successful responses include:

- `user`
- `refreshToken`
- `accessToken`
- `idToken`
- `scope`
- `grantedScopes`

## What This Package Does Not Do

- send email or SMS
- define your HTTP routes
- create your JWTs or session cookies
- manage your database models

It is designed to be wired into your own application server.

## Example App

See `examples/server-python/app.py` in this repo for a complete FastAPI example
covering:

- email OTP
- phone OTP
- Google OAuth
- session resume
- token refresh


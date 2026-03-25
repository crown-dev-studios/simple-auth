"""
Simple Auth — Example Server (FastAPI)

Demonstrates a full auth flow using simple-auth-server primitives:
  - Email OTP → verify → phone OTP → verify → mint tokens
  - Google OAuth → 3-way response (authenticated / needs_phone / needs_linking)
  - Session resume (return to in-progress onboarding)
  - Token refresh

NOT production-ready: uses in-memory stores instead of a database.
See docs/credentials.md for what your production app should persist.
"""

from __future__ import annotations

import os
import time
import uuid
from dataclasses import dataclass
from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

import jwt  # PyJWT

from simple_auth_server.redis_client import create_redis_client
from simple_auth_server.otp import OtpService
from simple_auth_server.config import OtpConfig
from simple_auth_server.session import AuthSessionService
from simple_auth_server.oauth_google import (
    GoogleOAuthConfig,
    GoogleOAuthDomainNotAllowedError,
    GoogleOAuthService,
)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

APP_ENV = os.environ.get("APP_ENV", "development")
REDIS_URL = os.environ.get("REDIS_URL")
BYPASS_CODE = os.environ.get("AUTH_BYPASS_CODE")
JWT_SECRET = os.environ.get("JWT_SECRET")
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET")
ALLOWED_EMAIL_DOMAINS = os.environ.get("ALLOWED_EMAIL_DOMAINS")


def parse_allowed_email_domains(value: Optional[str]) -> Optional[list[str]]:
    if not value:
        return None

    domains = [entry.strip() for entry in value.split(",") if entry.strip()]
    return domains or None

if not JWT_SECRET or len(JWT_SECRET) < 32:
    print(
        "JWT_SECRET is required and must be at least 32 characters. "
        "Generate one with: openssl rand -base64 32"
    )
    raise SystemExit(1)

ACCESS_TOKEN_TTL = 15 * 60  # 15 minutes
REFRESH_TOKEN_TTL = 30 * 24 * 60 * 60  # 30 days

app = FastAPI()

# ---------------------------------------------------------------------------
# Services
# ---------------------------------------------------------------------------

redis = create_redis_client(REDIS_URL)
allowed_email_domains = parse_allowed_email_domains(ALLOWED_EMAIL_DOMAINS)

otp_service = OtpService(
    redis=redis,
    env="production" if APP_ENV == "production" else "development",
    config=OtpConfig(bypass_code=BYPASS_CODE),
    allowed_domains=allowed_email_domains,
)

session_service = AuthSessionService(redis=redis)

google_oauth: Optional[GoogleOAuthService] = None
if GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET:
    google_oauth = GoogleOAuthService(
        GoogleOAuthConfig(
            client_id=GOOGLE_CLIENT_ID,
            client_secret=GOOGLE_CLIENT_SECRET,
            allowed_email_domains=allowed_email_domains,
        )
    )

is_production = APP_ENV == "production"

if not is_production and BYPASS_CODE:
    print(f"⚠️  OTP bypass code is active (env={APP_ENV}). All OTP requests will return the bypass code.")

# ---------------------------------------------------------------------------
# JWT helpers (minimal — use a real config in production)
# ---------------------------------------------------------------------------


def sign_access_token(user_id: str) -> str:
    return jwt.encode(
        {"sub": user_id, "iat": int(time.time()), "exp": int(time.time()) + ACCESS_TOKEN_TTL},
        JWT_SECRET,
        algorithm="HS256",
    )


def sign_refresh_token(user_id: str) -> str:
    return jwt.encode(
        {"sub": user_id, "type": "refresh", "iat": int(time.time()), "exp": int(time.time()) + REFRESH_TOKEN_TTL},
        JWT_SECRET,
        algorithm="HS256",
    )


def verify_refresh_token(token: str) -> Optional[str]:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        if payload.get("type") != "refresh":
            return None
        return payload.get("sub")
    except jwt.PyJWTError:
        return None


def mint_tokens(user_id: str) -> dict:
    return {
        "accessToken": sign_access_token(user_id),
        "refreshToken": sign_refresh_token(user_id),
        "expiresIn": ACCESS_TOKEN_TTL,
    }


# ---------------------------------------------------------------------------
# In-memory stores (replace with your database in production)
# ---------------------------------------------------------------------------


@dataclass
class User:
    id: str
    email: str
    phone_number: Optional[str] = None
    role: str = "user"


# email → User
users_by_email: dict[str, User] = {}
# "provider:sub" → email
identity_links: dict[str, str] = {}


def find_user_by_email(email: str) -> Optional[User]:
    return users_by_email.get(email.strip().lower())


def find_user_by_identity(provider: str, sub: str) -> Optional[User]:
    email = identity_links.get(f"{provider}:{sub}")
    return users_by_email.get(email) if email else None


def create_user(email: str, phone: Optional[str] = None) -> User:
    user = User(id=str(uuid.uuid4()), email=email.strip().lower(), phone_number=phone)
    users_by_email[user.email] = user
    return user


def link_identity(provider: str, sub: str, email: str) -> None:
    identity_links[f"{provider}:{sub}"] = email.strip().lower()


def mask_phone(phone: str) -> str:
    return "•" * max(len(phone) - 4, 0) + phone[-4:] if len(phone) > 4 else phone


def mask_email(email: str) -> str:
    local, _, domain = email.partition("@")
    if not domain:
        return email
    return local[0] + ("•" * (len(local) - 1) if len(local) > 1 else "") + "@" + domain


def user_dict(user: User) -> dict:
    return {"id": user.id, "email": user.email, "role": user.role, "phoneNumber": user.phone_number}


# ---------------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------------


class EmailOtpRequest(BaseModel):
    email: str


class EmailOtpVerifyRequest(BaseModel):
    sessionToken: str
    email: str
    code: str


class GoogleOAuthRequest(BaseModel):
    authCode: str


class OAuthLinkRequest(BaseModel):
    sessionToken: str
    code: str


class PhoneOtpRequest(BaseModel):
    sessionToken: str
    phoneNumber: str


class PhoneOtpVerifyRequest(BaseModel):
    sessionToken: str
    code: str


class RefreshRequest(BaseModel):
    refreshToken: str


class SessionResumeRequest(BaseModel):
    sessionToken: str


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.post("/auth/email/request-otp")
async def request_email_otp(body: EmailOtpRequest):
    ok, result = await otp_service.generate_email_otp(body.email)
    if not ok:
        status = 429 if result["code"] == "RATE_LIMITED" else 500
        raise HTTPException(status_code=status, detail=result)

    session_id = await session_service.create_session(body.email)

    if not is_production and os.environ.get("SIMPLE_AUTH_LOG_OTP") == "true":
        print(f"[example] email OTP (dev only): email={body.email} code={result}")

    return {"success": True, "sessionToken": session_id, "message": "OTP sent"}


@app.post("/auth/email/verify-otp")
async def verify_email_otp(body: EmailOtpVerifyRequest):
    # Validate session and ensure email matches (normalize for case-insensitive comparison)
    session = await session_service.get_session(body.sessionToken)
    if not session:
        raise HTTPException(status_code=400, detail={"error": "INVALID_SESSION", "message": "Session not found"})
    normalized_email = body.email.strip().lower()
    if session["email"] != normalized_email:
        raise HTTPException(status_code=400, detail={"error": "VALIDATION_ERROR", "message": "email does not match session"})

    ok, err = await otp_service.verify_email_otp(normalized_email, body.code)
    if not ok:
        raise HTTPException(status_code=400, detail=err)

    existing_user = find_user_by_email(normalized_email)
    flow_type = "returning" if existing_user and existing_user.phone_number else "new"
    masked_phone = mask_phone(existing_user.phone_number) if existing_user and existing_user.phone_number else None

    # Persist emailVerified first so session resume does not send user back to email-otp
    # if phone OTP generation fails (e.g. rate-limited). The consumed OTP cannot be retried.
    def _update(s: dict) -> dict:
        out = {**s, "emailVerified": True}
        if flow_type == "returning" and existing_user and existing_user.phone_number:
            out["phoneNumber"] = existing_user.phone_number
            out["existingUserId"] = existing_user.id
        return out

    await session_service.update_session(body.sessionToken, _update)

    # For returning users, auto-send phone OTP; fail if generation fails
    if flow_type == "returning" and existing_user and existing_user.phone_number:
        phone_ok, phone_result = await otp_service.generate_phone_otp(existing_user.phone_number)
        if not phone_ok:
            status = 429 if phone_result.get("code") == "RATE_LIMITED" else 500
            raise HTTPException(status_code=status, detail=phone_result)
        if not is_production and os.environ.get("SIMPLE_AUTH_LOG_OTP") == "true":
            print(f"[example] phone OTP (dev only): phone={existing_user.phone_number} code={phone_result}")

    return {
        "success": True,
        "sessionToken": body.sessionToken,
        "emailVerified": True,
        "flowType": flow_type,
        "maskedPhone": masked_phone,
    }


@app.post("/auth/oauth/google")
async def oauth_google(body: GoogleOAuthRequest):
    if not google_oauth:
        raise HTTPException(status_code=501, detail={"error": "NOT_IMPLEMENTED", "message": "Google OAuth not configured"})

    try:
        result = await google_oauth.exchange_auth_code(body.authCode)
    except GoogleOAuthDomainNotAllowedError as exc:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "DOMAIN_NOT_ALLOWED",
                "message": str(exc),
                "domain": exc.domain,
                "allowedDomains": exc.allowed_domains,
            },
        )
    except Exception:
        raise HTTPException(status_code=400, detail={"error": "OAUTH_TOKEN_INVALID", "message": "Failed to exchange auth code"})

    google_user = result["user"]

    # 1) Already linked? → authenticate
    linked_user = find_user_by_identity("google", google_user["sub"])
    if linked_user:
        return {
            "status": "authenticated",
            "user": user_dict(linked_user),
            "tokens": mint_tokens(linked_user.id),
            "grantedScopes": result.get("grantedScopes", []),
        }

    # 2) Email exists but not linked? → needs_linking
    existing_user = find_user_by_email(google_user["email"])
    if existing_user:
        session_id = await session_service.create_session(google_user["email"])
        pending = {
            "provider": "google",
            "sub": google_user["sub"],
            "email": google_user["email"],
            "emailVerified": google_user.get("emailVerified", False),
            "rawData": google_user,
            "refreshToken": result.get("refreshToken"),
        }

        def _update_linking(s: dict) -> dict:
            return {
                **s,
                "emailVerified": google_user.get("emailVerified", False),
                "pendingOAuth": pending,
                "existingUserId": existing_user.id,
            }

        await session_service.update_session(session_id, _update_linking)

        otp_ok, otp_result = await otp_service.generate_email_otp(google_user["email"])
        if not otp_ok:
            status = 429 if otp_result.get("code") == "RATE_LIMITED" else 500
            raise HTTPException(status_code=status, detail=otp_result)
        if not is_production and os.environ.get("SIMPLE_AUTH_LOG_OTP") == "true":
            print(f"[example] linking OTP (dev only): email={google_user['email']} code={otp_result}")

        return {
            "status": "needs_linking",
            "sessionToken": session_id,
            "maskedEmail": mask_email(google_user["email"]),
        }

    # 3) New user → needs_phone
    session_id = await session_service.create_session(google_user["email"])
    pending = {
        "provider": "google",
        "sub": google_user["sub"],
        "email": google_user["email"],
        "emailVerified": google_user.get("emailVerified", False),
        "rawData": google_user,
        "refreshToken": result.get("refreshToken"),
    }

    def _update_phone(s: dict) -> dict:
        return {**s, "emailVerified": google_user.get("emailVerified", False), "pendingOAuth": pending}

    await session_service.update_session(session_id, _update_phone)

    return {
        "status": "needs_phone",
        "sessionToken": session_id,
        "email": google_user["email"],
        "flowType": "new",
        "maskedPhone": None,
    }


@app.post("/auth/oauth/link")
async def oauth_link(body: OAuthLinkRequest):
    session = await session_service.get_session(body.sessionToken)
    if not session:
        raise HTTPException(status_code=400, detail={"error": "INVALID_SESSION", "message": "Session not found"})

    pending = session.get("pendingOAuth")
    if not pending:
        raise HTTPException(status_code=400, detail={"error": "INVALID_SESSION", "message": "No pending OAuth to link"})

    ok, err = await otp_service.verify_email_otp(session["email"], body.code)
    if not ok:
        raise HTTPException(status_code=400, detail=err)

    link_identity(pending["provider"], pending["sub"], session["email"])

    user = find_user_by_email(session["email"])
    if not user:
        raise HTTPException(status_code=400, detail={"error": "USER_NOT_FOUND", "message": "User not found"})

    await session_service.delete_session(body.sessionToken)

    return {
        "status": "authenticated",
        "user": user_dict(user),
        "tokens": mint_tokens(user.id),
    }


@app.post("/auth/phone/request-otp")
async def request_phone_otp(body: PhoneOtpRequest):
    session = await session_service.get_session(body.sessionToken)
    if not session:
        raise HTTPException(status_code=400, detail={"error": "INVALID_SESSION", "message": "Session not found"})

    if not session.get("emailVerified"):
        raise HTTPException(status_code=400, detail={"error": "EMAIL_NOT_VERIFIED", "message": "Verify email first"})

    ok, result = await otp_service.generate_phone_otp(body.phoneNumber)
    if not ok:
        status = 429 if result["code"] == "RATE_LIMITED" else 500
        raise HTTPException(status_code=status, detail=result)

    def _update(s: dict) -> dict:
        return {**s, "phoneNumber": body.phoneNumber}

    await session_service.update_session(body.sessionToken, _update)

    if not is_production and os.environ.get("SIMPLE_AUTH_LOG_OTP") == "true":
        print(f"[example] phone OTP (dev only): phone={body.phoneNumber} code={result}")

    return {"success": True, "message": "OTP sent", "maskedPhone": mask_phone(body.phoneNumber)}


@app.post("/auth/phone/verify-otp")
async def verify_phone_otp(body: PhoneOtpVerifyRequest):
    session = await session_service.get_session(body.sessionToken)
    if not session:
        raise HTTPException(status_code=400, detail={"error": "INVALID_SESSION", "message": "Session not found"})

    phone = session.get("phoneNumber")
    if not phone:
        raise HTTPException(status_code=400, detail={"error": "NO_PHONE", "message": "No phone number on session"})

    ok, err = await otp_service.verify_phone_otp(phone, body.code)
    if not ok:
        raise HTTPException(status_code=400, detail=err)

    # Find or create user
    existing_user_id = session.get("existingUserId")
    user: Optional[User] = None
    if existing_user_id:
        user = next((u for u in users_by_email.values() if u.id == existing_user_id), None)
    if not user:
        user = find_user_by_email(session["email"])
    if user:
        user.phone_number = phone
    else:
        user = create_user(session["email"], phone)

    # Link pending OAuth if present
    pending = session.get("pendingOAuth")
    if pending:
        link_identity(pending["provider"], pending["sub"], user.email)

    await session_service.delete_session(body.sessionToken)

    return {
        "user": user_dict(user),
        "tokens": mint_tokens(user.id),
    }


@app.post("/auth/refresh")
async def refresh(body: RefreshRequest):
    user_id = verify_refresh_token(body.refreshToken)
    if not user_id:
        raise HTTPException(status_code=401, detail={"error": "INVALID_TOKEN", "message": "Invalid or expired refresh token"})

    return mint_tokens(user_id)


@app.post("/auth/session/resume")
async def session_resume(body: SessionResumeRequest):
    session = await session_service.get_session(body.sessionToken)
    if not session:
        raise HTTPException(status_code=400, detail={"error": "INVALID_SESSION", "message": "Session not found"})

    email_verified = session.get("emailVerified", False)
    phone_number = session.get("phoneNumber")

    existing_user = find_user_by_email(session["email"])
    flow_type = "returning" if existing_user and existing_user.phone_number else "new"

    # context-bridge = OAuth linking in progress
    if session.get("pendingOAuth"):
        step = "context-bridge"
    elif not email_verified:
        step = "email-otp"
    elif flow_type == "new" and not phone_number:
        step = "phone-input"
    else:
        step = "phone-otp"

    return {
        "success": True,
        "email": session["email"],
        "emailVerified": email_verified,
        "maskedPhone": mask_phone(phone_number) if phone_number else None,
        "phoneVerified": session.get("phoneVerified", False),
        "flowType": flow_type,
        "step": step,
    }

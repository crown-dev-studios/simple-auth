from __future__ import annotations

import os
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, EmailStr

from simple_auth_server.redis_client import create_redis_client
from simple_auth_server.otp import OtpService


class RequestOtpBody(BaseModel):
    email: EmailStr


class VerifyOtpBody(BaseModel):
    email: EmailStr
    code: str


app = FastAPI()

redis = create_redis_client(os.environ.get("REDIS_URL"))
otp = OtpService(
    redis=redis,
    env="production" if os.environ.get("APP_ENV") == "production" else "development",
)

is_production = os.environ.get("APP_ENV") == "production"
should_log_otp = (not is_production) and os.environ.get("SIMPLE_AUTH_LOG_OTP") in ("1", "true", "TRUE")


@app.post("/auth/email/request-otp")
async def request_email_otp(body: RequestOtpBody):
    ok, result = await otp.generate_email_otp(str(body.email))
    if not ok:
        err = result
        if err["code"] == "RATE_LIMITED":
            raise HTTPException(status_code=429, detail=err)
        raise HTTPException(status_code=400, detail=err)

    # DO NOT USE IN PRODUCTION:
    # Logging OTPs makes it easy to copy/paste into a real server and leak codes into logs.
    if should_log_otp:
        print("[simple-auth example] email OTP (dev only):", {"email": str(body.email), "code": result})
    else:
        print("[simple-auth example] email OTP generated. Deliver via email/SMS in production.")
    return {"success": True}


@app.post("/auth/email/verify-otp")
async def verify_email_otp(body: VerifyOtpBody):
    ok, err = await otp.verify_email_otp(str(body.email), body.code)
    if not ok:
        raise HTTPException(status_code=400, detail=err)
    return {"success": True}

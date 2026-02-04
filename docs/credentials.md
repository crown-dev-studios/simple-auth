# Managing credentials (DB + tokens)

The SDKs in this repo deliberately stop at the boundary where your application’s business rules and persistence begin.

## What the SDK can self-contain

**Redis-backed (server-side primitives):**
- OTP codes + rate limits
- short-lived auth/onboarding session state (e.g. “pending OAuth identity”, “needs_linking”, “needs_phone”)

## What your app must store in its database

Your application database is the source of truth for:
- users
- provider identity links (e.g. Google/Apple subject IDs)
- refresh token state (revocation, rotation, device/session management) and auditability

Redis should be treated as **ephemeral** state, not the durable record for users or long-lived sessions.

## How it integrates (conceptual flow)

Your app server owns these steps:

1) **Exchange provider credential → normalized identity**
   - For Google, the SDK yields an `authCode` and your server exchanges it with Google.
   - You normalize the identity to: `provider`, `sub`, `email`, `emailVerified` (plus raw claims if you want them).

2) **Resolve identity to an app user**
   - Look up an existing provider link by `(provider, sub)`.
   - If found → you have a `user_id`.
   - If not found:
     - If `email` matches an existing user, either:
       - link immediately (if you trust provider email verification enough), or
       - require a linking challenge (email OTP) → store “pending identity” in Redis session and link after OTP verify.
     - Else create a new user + new provider link.

3) **Mint app tokens**
   - Return `accessToken` (usually short-lived JWT) + `refreshToken` (stateful) + `expiresIn`.

4) **Refresh**
   - Validate refresh token against DB state.
   - Rotate it (revoke old, issue new).
   - Mint a new access token and return updated tokens.

## Reference schema (recommended)

This is a minimal, app-agnostic starting point for Postgres/MySQL/etc.

### `users`
- `id` (uuid/ulid)
- `email` (unique, normalized)
- `email_verified` (boolean)
- `phone_number` (nullable) + `phone_verified` (boolean) if you support phone
- timestamps

### `auth_identities` (provider links)
- `id`
- `user_id` (FK → `users.id`)
- `provider` (`google`, `apple`, etc)
- `provider_subject` (provider `sub`)
- optional: `email_at_link_time`
- timestamps

Constraints:
- `UNIQUE(provider, provider_subject)`

### `refresh_tokens` (or “sessions”)
- `id`
- `user_id` (FK → `users.id`)
- `token_hash` (store a hash, not the raw token)
- `created_at`, `expires_at`
- `revoked_at` (nullable)
- rotation metadata: `replaced_by_token_id` (nullable) and/or `family_id`
- optional: `device_id`, `user_agent`, `ip`

Indexes (typical):
- `(user_id)`
- `(token_hash)`
- `(revoked_at)` (or a partial index for active tokens, depending on DB)

### Optional: `auth_audit_events`
If you need auditing/compliance, record security-relevant events:
- OTP requested/sent/verified
- identity linked/unlinked
- refresh token rotated/revoked
- suspicious activity / lockouts

## Token storage guidance (recommended defaults)

**Access tokens**
- don’t store server-side (short-lived JWT validated by signature + claims)

**Refresh tokens**
- generate as cryptographically-random bytes
- store **only a hash** in DB
- **rotate on every refresh**
- revoke the previous token on rotation (supports “log out everywhere”, incident response, and audit trails)

**Provider tokens (e.g. Google access/refresh tokens)**
- don’t store unless your app must call provider APIs on the user’s behalf
- for “sign in”, you can usually avoid persisting them entirely

## Can refresh tokens live only in Redis?

You *can*, but it’s a trade-off:
- Pros: simple, self-contained, fast
- Cons: weaker durability (flushes/restarts), harder audit/compliance, harder “log out everywhere”, harder incident response

For most production apps, the default should be:
- Redis for ephemeral OTP/session flows
- DB for users + refresh token state


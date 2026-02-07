import { z } from 'zod'

import { AuthErrorSchemas } from './auth-errors'

// ============================================
// Common Auth Schemas
// ============================================

/**
 * User role enum - determines access permissions
 */
export const UserRoleSchema = z.enum(['user', 'admin'])
export type UserRole = z.infer<typeof UserRoleSchema>

/**
 * Auth tokens returned after successful authentication
 */
export const AuthTokensSchema = z.object({
    accessToken: z.string(),
    refreshToken: z.string(),
    expiresIn: z.number(),
})
export type AuthTokens = z.infer<typeof AuthTokensSchema>

/**
 * Authenticated user info returned in responses
 */
export const AuthUserSchema = z.object({
    id: z.string(),
    email: z.email(),
    role: UserRoleSchema,
})
export type AuthUser = z.infer<typeof AuthUserSchema>

/**
 * Extended user info including phone (returned after phone verification)
 */
export const AuthUserWithPhoneSchema = AuthUserSchema.extend({
    phoneNumber: z.string().nullable(),
})
export type AuthUserWithPhone = z.infer<typeof AuthUserWithPhoneSchema>

// ============================================
// Login (Legacy email/password)
// ============================================

export const LoginRequestSchema = z.object({
    email: z.email(),
    password: z.string().min(1),
})
export type LoginRequest = z.infer<typeof LoginRequestSchema>

export const LoginResponseSchema = z.object({
    user: AuthUserSchema,
    tokens: AuthTokensSchema,
})
export type LoginResponse = z.infer<typeof LoginResponseSchema>

export const LoginErrorSchema = z.discriminatedUnion('error', [
    AuthErrorSchemas.VALIDATION_ERROR,
    AuthErrorSchemas.INVALID_CREDENTIALS,
    AuthErrorSchemas.ACCOUNT_INACTIVE,
])
export type LoginError = z.infer<typeof LoginErrorSchema>

// ============================================
// Refresh Token
// ============================================

export const RefreshRequestSchema = z.object({
    refreshToken: z.string(),
})
export type RefreshRequest = z.infer<typeof RefreshRequestSchema>

export const RefreshResponseSchema = AuthTokensSchema
export type RefreshResponse = z.infer<typeof RefreshResponseSchema>

export const RefreshErrorSchema = z.discriminatedUnion('error', [
    AuthErrorSchemas.VALIDATION_ERROR,
    AuthErrorSchemas.INVALID_TOKEN,
])
export type RefreshError = z.infer<typeof RefreshErrorSchema>

// ============================================
// Email OTP (FR-02)
// ============================================

export const OTP_CODE_LENGTH = 6 as const

export const EmailOtpRequestSchema = z.object({
    email: z.email(),
})
export type EmailOtpRequest = z.infer<typeof EmailOtpRequestSchema>

export const EmailOtpRequestResponseSchema = z.object({
    success: z.boolean(),
    sessionToken: z.string(),
    message: z.string(),
})
export type EmailOtpRequestResponse = z.infer<typeof EmailOtpRequestResponseSchema>

export const EmailOtpRequestErrorSchema = z.discriminatedUnion('error', [
    AuthErrorSchemas.VALIDATION_ERROR,
    AuthErrorSchemas.RATE_LIMITED,
    AuthErrorSchemas.OTP_GENERATION_FAILED,
    AuthErrorSchemas.EMAIL_SEND_FAILED,
    AuthErrorSchemas.SESSION_CREATE_FAILED,
])
export type EmailOtpRequestError = z.infer<typeof EmailOtpRequestErrorSchema>

export const EmailOtpVerifySchema = z.object({
    email: z.email(),
    code: z.string().length(OTP_CODE_LENGTH),
})
export type EmailOtpVerify = z.infer<typeof EmailOtpVerifySchema>

/**
 * Flow type for onboarding - determines client UI path
 * - 'new': First-time user, needs phone input
 * - 'returning': User has verified phone on file, auto-sends OTP
 */
export const FlowTypeSchema = z.enum(['new', 'returning'])
export type FlowType = z.infer<typeof FlowTypeSchema>

/**
 * Email OTP verify response
 * - flowType: 'returning' if user has verified phone, 'new' otherwise
 * - maskedPhone: display-only masked phone for returning users (e.g., '•••••••4567')
 */
export const EmailOtpVerifyResponseSchema = z.object({
    success: z.boolean(),
    sessionToken: z.string(),
    emailVerified: z.boolean(),
    flowType: FlowTypeSchema,
    maskedPhone: z.string().nullable(),
})
export type EmailOtpVerifyResponse = z.infer<typeof EmailOtpVerifyResponseSchema>

export const EmailOtpVerifyErrorSchema = z.discriminatedUnion('error', [
    AuthErrorSchemas.VALIDATION_ERROR,
    AuthErrorSchemas.OTP_EXPIRED,
    AuthErrorSchemas.INVALID_CODE,
    AuthErrorSchemas.MAX_ATTEMPTS,
    AuthErrorSchemas.VERIFICATION_FAILED,
    AuthErrorSchemas.SESSION_CREATE_FAILED,
])
export type EmailOtpVerifyError = z.infer<typeof EmailOtpVerifyErrorSchema>

// ============================================
// Phone OTP (FR-04, FR-05)
// ============================================

/**
 * E.164 phone number regex pattern
 * - Must start with +
 * - Followed by 1-3 digit country code
 * - Followed by subscriber number (total 7-15 digits)
 * Examples: +14155551234, +447911123456, +551155551234
 */
export const E164PhoneRegex = /^\+[1-9]\d{6,14}$/

export const PhoneOtpRequestSchema = z.object({
    sessionToken: z.string(),
    phoneNumber: z.string().regex(E164PhoneRegex, 'Phone number must be in E.164 format (e.g., +14155551234)'),
})
export type PhoneOtpRequest = z.infer<typeof PhoneOtpRequestSchema>

/**
 * Phone OTP request response
 * - maskedPhone: display-only masked phone (e.g., '•••••••4567')
 */
export const PhoneOtpRequestResponseSchema = z.object({
    success: z.boolean(),
    message: z.string(),
    maskedPhone: z.string(),
})
export type PhoneOtpRequestResponse = z.infer<typeof PhoneOtpRequestResponseSchema>

export const PhoneOtpRequestErrorSchema = z.discriminatedUnion('error', [
    AuthErrorSchemas.VALIDATION_ERROR,
    AuthErrorSchemas.INVALID_SESSION,
    AuthErrorSchemas.EMAIL_NOT_VERIFIED,
    AuthErrorSchemas.PHONE_ALREADY_VERIFIED,
    AuthErrorSchemas.RATE_LIMITED,
    AuthErrorSchemas.OTP_GENERATION_FAILED,
    AuthErrorSchemas.SMS_SEND_FAILED,
])
export type PhoneOtpRequestError = z.infer<typeof PhoneOtpRequestErrorSchema>

/**
 * Phone OTP resend request
 * Used by both returning users and new users who need to resend OTP
 * Note: phoneNumber is NOT included - server determines phone from DB or session
 */
export const PhoneOtpResendSchema = z.object({
    sessionToken: z.string(),
})
export type PhoneOtpResend = z.infer<typeof PhoneOtpResendSchema>

/**
 * Phone OTP resend response
 */
export const PhoneOtpResendResponseSchema = z.object({
    success: z.boolean(),
    message: z.string(),
    maskedPhone: z.string(),
})
export type PhoneOtpResendResponse = z.infer<typeof PhoneOtpResendResponseSchema>

export const PhoneOtpResendErrorSchema = z.discriminatedUnion('error', [
    AuthErrorSchemas.VALIDATION_ERROR,
    AuthErrorSchemas.INVALID_SESSION,
    AuthErrorSchemas.EMAIL_NOT_VERIFIED,
    AuthErrorSchemas.NO_PHONE,
    AuthErrorSchemas.RATE_LIMITED,
    AuthErrorSchemas.OTP_GENERATION_FAILED,
    AuthErrorSchemas.SMS_SEND_FAILED,
])
export type PhoneOtpResendError = z.infer<typeof PhoneOtpResendErrorSchema>

/**
 * Phone OTP verify request
 * Note: phoneNumber is NOT included - server determines phone from DB or session
 */
export const PhoneOtpVerifySchema = z.object({
    sessionToken: z.string(),
    code: z.string().length(OTP_CODE_LENGTH),
})
export type PhoneOtpVerify = z.infer<typeof PhoneOtpVerifySchema>

/**
 * Phone OTP verify response (completes auth)
 */
export const PhoneOtpVerifyResponseSchema = z.object({
    user: AuthUserWithPhoneSchema,
    tokens: AuthTokensSchema,
})
export type PhoneOtpVerifyResponse = z.infer<typeof PhoneOtpVerifyResponseSchema>

export const PhoneOtpVerifyErrorSchema = z.discriminatedUnion('error', [
    AuthErrorSchemas.VALIDATION_ERROR,
    AuthErrorSchemas.INVALID_SESSION,
    AuthErrorSchemas.EMAIL_NOT_VERIFIED,
    AuthErrorSchemas.NO_PHONE,
    AuthErrorSchemas.OTP_EXPIRED,
    AuthErrorSchemas.INVALID_CODE,
    AuthErrorSchemas.MAX_ATTEMPTS,
    AuthErrorSchemas.VERIFICATION_FAILED,
    AuthErrorSchemas.PHONE_IN_USE,
    AuthErrorSchemas.USER_CREATE_FAILED,
    AuthErrorSchemas.ACCOUNT_INACTIVE,
])
export type PhoneOtpVerifyError = z.infer<typeof PhoneOtpVerifyErrorSchema>

// ============================================
// Session Resume (NFR-02)
// ============================================

export const SessionResumeRequestSchema = z.object({
    sessionToken: z.string(),
})
export type SessionResumeRequest = z.infer<typeof SessionResumeRequestSchema>

/**
 * Onboarding step - determines which screen to show
 */
export const OnboardingStepSchema = z.enum([
    'email-otp',
    'context-bridge',
    'phone-input',
    'phone-otp',
])
export type OnboardingStep = z.infer<typeof OnboardingStepSchema>

/**
 * Session resume response
 * - maskedPhone: display-only, never used in requests
 * - flowType: determines which UI flow to show
 * - step: which screen to resume from
 */
export const SessionResumeResponseSchema = z.object({
    success: z.boolean(),
    email: z.string(),
    emailVerified: z.boolean(),
    maskedPhone: z.string().nullable(),
    phoneVerified: z.boolean(),
    flowType: FlowTypeSchema,
    step: OnboardingStepSchema,
})
export type SessionResumeResponse = z.infer<typeof SessionResumeResponseSchema>

export const SessionResumeErrorSchema = z.discriminatedUnion('error', [
    AuthErrorSchemas.VALIDATION_ERROR,
    AuthErrorSchemas.INVALID_SESSION,
    AuthErrorSchemas.SESSION_STALE,
])
export type SessionResumeError = z.infer<typeof SessionResumeErrorSchema>

// ============================================
// OAuth (Google/Apple Sign-In)
// ============================================

/**
 * OAuth provider enum - supported identity providers
 */
export const OAuthProviderSchema = z.enum(['google', 'apple'])
export type OAuthProvider = z.infer<typeof OAuthProviderSchema>

/**
 * Scope update mode for Google auth management.
 * - add: request only missing scopes
 * - replace: desired scopes become authoritative (can remove)
 */
export const GoogleScopeModeSchema = z.enum(['add', 'replace'])
export type GoogleScopeMode = z.infer<typeof GoogleScopeModeSchema>

/**
 * Canonical Google auth result returned by client SDKs.
 */
export const GoogleAuthResultSchema = z.object({
    authCode: z.string().min(1),
    grantedScopes: z.array(z.string()),
})
export type GoogleAuthResult = z.infer<typeof GoogleAuthResultSchema>

/**
 * Request payload for scope updates on client SDKs.
 */
export const GoogleScopeUpdateRequestSchema = z.object({
    scopes: z.array(z.string()).default([]),
    mode: GoogleScopeModeSchema,
})
export type GoogleScopeUpdateRequest = z.infer<typeof GoogleScopeUpdateRequestSchema>

/**
 * Granted scope response payload for client SDKs.
 */
export const GoogleGrantedScopesResponseSchema = z.object({
    grantedScopes: z.array(z.string()),
})
export type GoogleGrantedScopesResponse = z.infer<typeof GoogleGrantedScopesResponseSchema>

/**
 * Google OAuth request - sent from mobile after native sign-in
 * - authCode: server auth code to exchange on backend
 */
export const GoogleOAuthRequestSchema = z.object({
    authCode: z.string().min(1),
})
export type GoogleOAuthRequest = z.infer<typeof GoogleOAuthRequestSchema>

/**
 * Apple OAuth request - sent from mobile after native sign-in
 * - idToken: JWT identity token from Apple
 * - nonce: Required for replay protection (if used during sign-in)
 * - firstName/lastName: Apple only sends these on first auth
 */
export const AppleOAuthRequestSchema = z.object({
    idToken: z.string().min(1),
    nonce: z.string().optional(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
})
export type AppleOAuthRequest = z.infer<typeof AppleOAuthRequestSchema>

/**
 * OAuth response status - determines client UI path
 * - needs_phone: Continue to phone verification (new users enter phone; returning users verify existing phone)
 * - needs_linking: Email exists, show OTP verification to link accounts
 */
export const OAuthStatusSchema = z.enum(['authenticated', 'needs_phone', 'needs_linking'])
export type OAuthStatus = z.infer<typeof OAuthStatusSchema>

/**
 * OAuth response - authenticated immediately (no further steps required)
 * Note: some servers may require additional verification (e.g., phone OTP)
 * before minting tokens, while others may return tokens immediately after OAuth.
 */
export const OAuthAuthenticatedResponseSchema = z.object({
    status: z.literal('authenticated'),
    user: AuthUserWithPhoneSchema,
    tokens: AuthTokensSchema,
    grantedScopes: z.array(z.string()).optional(),
})
export type OAuthAuthenticatedResponse = z.infer<typeof OAuthAuthenticatedResponseSchema>

/**
 * OAuth response - needs phone verification
 * - flowType: 'returning' if user has verified phone, 'new' otherwise
 * - maskedPhone: display-only masked phone for returning users (e.g., '•••••••4567')
 */
export const OAuthNeedsPhoneResponseSchema = z.object({
    status: z.literal('needs_phone'),
    sessionToken: z.string(),
    email: z.string(),
    flowType: FlowTypeSchema,
    maskedPhone: z.string().nullable(),
})
export type OAuthNeedsPhoneResponse = z.infer<typeof OAuthNeedsPhoneResponseSchema>

/**
 * OAuth response - existing email found, needs OTP verification to link
 */
export const OAuthNeedsLinkingResponseSchema = z.object({
    status: z.literal('needs_linking'),
    sessionToken: z.string(),
    maskedEmail: z.string(),
})
export type OAuthNeedsLinkingResponse = z.infer<typeof OAuthNeedsLinkingResponseSchema>

/**
 * OAuth response - discriminated union on 'status' field
 */
export const OAuthResponseSchema = z.discriminatedUnion('status', [
    OAuthAuthenticatedResponseSchema,
    OAuthNeedsPhoneResponseSchema,
    OAuthNeedsLinkingResponseSchema,
])
export type OAuthResponse = z.infer<typeof OAuthResponseSchema>

/**
 * OAuth link request - verify OTP to link OAuth identity to existing account
 */
export const OAuthLinkRequestSchema = z.object({
    sessionToken: z.string(),
    code: z.string().length(OTP_CODE_LENGTH),
})
export type OAuthLinkRequest = z.infer<typeof OAuthLinkRequestSchema>

/**
 * OAuth error schema for /auth/oauth/{provider} endpoints
 */
export const OAuthErrorSchema = z.discriminatedUnion('error', [
    AuthErrorSchemas.VALIDATION_ERROR,
    AuthErrorSchemas.OAUTH_TOKEN_INVALID,
    AuthErrorSchemas.OAUTH_EMAIL_REQUIRED,
    AuthErrorSchemas.RATE_LIMITED,
    AuthErrorSchemas.ACCOUNT_INACTIVE,
    AuthErrorSchemas.NOT_IMPLEMENTED,
    AuthErrorSchemas.SESSION_CREATE_FAILED,
])
export type OAuthError = z.infer<typeof OAuthErrorSchema>

/**
 * OAuth link error schema for /auth/oauth/link endpoint
 */
export const OAuthLinkErrorSchema = z.discriminatedUnion('error', [
    AuthErrorSchemas.VALIDATION_ERROR,
    AuthErrorSchemas.INVALID_SESSION,
    AuthErrorSchemas.INVALID_CODE,
    AuthErrorSchemas.OTP_EXPIRED,
    AuthErrorSchemas.MAX_ATTEMPTS,
    AuthErrorSchemas.VERIFICATION_FAILED,
    AuthErrorSchemas.ACCOUNT_INACTIVE,
    AuthErrorSchemas.CONFLICT,
    AuthErrorSchemas.USER_NOT_FOUND,
])
export type OAuthLinkError = z.infer<typeof OAuthLinkErrorSchema>

/**
 * OAuth revoke response for /auth/oauth/{provider}/revoke
 */
export const OAuthRevokeResponseSchema = z.object({
    success: z.boolean(),
})
export type OAuthRevokeResponse = z.infer<typeof OAuthRevokeResponseSchema>

/**
 * OAuth revoke error schema for /auth/oauth/{provider}/revoke
 */
export const OAuthRevokeErrorSchema = z.discriminatedUnion('error', [
    AuthErrorSchemas.UNAUTHORIZED,
    AuthErrorSchemas.OAUTH_NOT_LINKED,
    AuthErrorSchemas.OAUTH_REVOKE_FAILED,
])
export type OAuthRevokeError = z.infer<typeof OAuthRevokeErrorSchema>

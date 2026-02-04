import { z } from 'zod'

import { CommonErrorSchemas, makeError } from './common-errors'

/**
 * Central registry of all auth-specific error schemas.
 * Reuses common errors from CommonErrorSchemas where applicable.
 * Each error is defined once here and referenced by endpoint error unions.
 */
export const AuthErrorSchemas = {
    // Common errors (re-exported for convenience in auth unions)
    VALIDATION_ERROR: CommonErrorSchemas.VALIDATION_ERROR,
    RATE_LIMITED: CommonErrorSchemas.RATE_LIMITED,
    CONFLICT: CommonErrorSchemas.CONFLICT,
    UNAUTHORIZED: CommonErrorSchemas.UNAUTHORIZED,

    // Session errors
    INVALID_SESSION: makeError('INVALID_SESSION', {
        message: z.string(),
    }),

    SESSION_CREATE_FAILED: makeError('SESSION_CREATE_FAILED', {
        message: z.string(),
    }),

    SESSION_STALE: makeError('SESSION_STALE', {
        message: z.string(),
    }),

    // Email verification errors
    EMAIL_NOT_VERIFIED: makeError('EMAIL_NOT_VERIFIED', {
        message: z.string(),
    }),

    EMAIL_SEND_FAILED: makeError('EMAIL_SEND_FAILED', {
        message: z.string(),
    }),

    // OTP errors
    OTP_EXPIRED: makeError('OTP_EXPIRED', {
        message: z.string(),
    }),

    INVALID_CODE: makeError('INVALID_CODE', {
        message: z.string(),
        attemptsRemaining: z.number().optional(),
    }),

    MAX_ATTEMPTS: makeError('MAX_ATTEMPTS', {
        message: z.string(),
    }),

    OTP_GENERATION_FAILED: makeError('OTP_GENERATION_FAILED', {
        message: z.string(),
    }),

    VERIFICATION_FAILED: makeError('VERIFICATION_FAILED', {
        message: z.string(),
    }),

    // Phone errors
    PHONE_ALREADY_VERIFIED: makeError('PHONE_ALREADY_VERIFIED', {
        message: z.string(),
    }),

    NO_PHONE: makeError('NO_PHONE', {
        message: z.string(),
    }),

    PHONE_IN_USE: makeError('PHONE_IN_USE', {
        message: z.string(),
    }),

    SMS_SEND_FAILED: makeError('SMS_SEND_FAILED', {
        message: z.string(),
    }),

    // Credential/token errors
    INVALID_CREDENTIALS: makeError('INVALID_CREDENTIALS', {
        message: z.string(),
    }),

    INVALID_TOKEN: makeError('INVALID_TOKEN', {
        message: z.string(),
    }),

    // Account errors
    ACCOUNT_INACTIVE: makeError('ACCOUNT_INACTIVE', {
        message: z.string(),
    }),

    USER_CREATE_FAILED: makeError('USER_CREATE_FAILED', {
        message: z.string(),
    }),

    USER_NOT_FOUND: makeError('USER_NOT_FOUND', {
        message: z.string(),
    }),

    NOT_IMPLEMENTED: makeError('NOT_IMPLEMENTED', {
        message: z.string(),
    }),

    // OAuth errors
    OAUTH_TOKEN_INVALID: makeError('OAUTH_TOKEN_INVALID', {
        message: z.string(),
        provider: z.enum(['google', 'apple']),
    }),

    OAUTH_EMAIL_REQUIRED: makeError('OAUTH_EMAIL_REQUIRED', {
        message: z.string(),
        provider: z.enum(['google', 'apple']),
    }),

    OAUTH_LINKING_REQUIRED: makeError('OAUTH_LINKING_REQUIRED', {
        message: z.string(),
        maskedEmail: z.string(),
    }),

    OAUTH_NOT_LINKED: makeError('OAUTH_NOT_LINKED', {
        message: z.string(),
        provider: z.enum(['google', 'apple']),
    }),

    OAUTH_REVOKE_FAILED: makeError('OAUTH_REVOKE_FAILED', {
        message: z.string(),
        provider: z.enum(['google', 'apple']),
    }),
} as const

/**
 * Union of all auth error value types.
 * Useful for generic error handlers that accept any auth error.
 */
export type AnyAuthError = z.infer<
    (typeof AuthErrorSchemas)[keyof typeof AuthErrorSchemas]
>

/**
 * Union of all auth error codes (string literals).
 * Useful for switch statements and exhaustive checking.
 */
export type AuthErrorCode = AnyAuthError['error']

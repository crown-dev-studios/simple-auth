import { z } from 'zod'

/**
 * Helper to define an error schema with a literal error code.
 * Used across all domain error registries for consistency.
 *
 * @example
 * const MyDomainErrors = {
 *   MY_ERROR: makeError('MY_ERROR', { someField: z.string() }),
 * }
 */
export const makeError = <Code extends string, Shape extends z.ZodRawShape>(
    code: Code,
    shape: Shape,
) =>
    z.object({
        error: z.literal(code),
        ...shape,
    })

/**
 * Central registry of common error schemas used across multiple domains.
 * Domain-specific errors should be defined in their own registry files
 * (e.g., auth-errors.ts, entry-errors.ts).
 */
export const CommonErrorSchemas = {
    /**
     * Request body/params failed Zod validation.
     * Returned with HTTP 400.
     */
    VALIDATION_ERROR: makeError('VALIDATION_ERROR', {
        message: z.string(),
        details: z.unknown(),
    }),

    /**
     * Resource not found.
     * Returned with HTTP 404.
     */
    NOT_FOUND: makeError('NOT_FOUND', {
        message: z.string(),
        resource: z.string().optional(),
    }),

    /**
     * User is not authenticated.
     * Returned with HTTP 401.
     */
    UNAUTHORIZED: makeError('UNAUTHORIZED', {
        message: z.string(),
    }),

    /**
     * User lacks permission for this action.
     * Returned with HTTP 403.
     */
    FORBIDDEN: makeError('FORBIDDEN', {
        message: z.string(),
    }),

    /**
     * Too many requests - rate limit exceeded.
     * Returned with HTTP 429.
     */
    RATE_LIMITED: makeError('RATE_LIMITED', {
        message: z.string(),
        retryAfterSeconds: z.number(),
    }),

    /**
     * Server encountered an unexpected error.
     * Returned with HTTP 500.
     */
    INTERNAL_ERROR: makeError('INTERNAL_ERROR', {
        message: z.string(),
        requestId: z.string().optional(),
    }),

    /**
     * Request conflicts with current state (e.g., duplicate).
     * Returned with HTTP 409.
     */
    CONFLICT: makeError('CONFLICT', {
        message: z.string(),
    }),
} as const

/**
 * Union of all common error value types.
 */
export type AnyCommonError = z.infer<
    (typeof CommonErrorSchemas)[keyof typeof CommonErrorSchemas]
>

/**
 * Union of all common error codes (string literals).
 */
export type CommonErrorCode = AnyCommonError['error']

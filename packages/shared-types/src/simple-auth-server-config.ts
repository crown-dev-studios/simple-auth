import { z } from 'zod'

/**
 * Shared configuration schema for server-side "Simple Auth" primitives.
 *
 * This is intentionally framework-agnostic. Your application server should
 * read env vars, validate into this schema, then wire the SDK primitives.
 */

export const SimpleAuthProvidersConfigSchema = z
    .object({
        emailOtp: z
            .object({
                enabled: z.boolean(),
            })
            .optional(),

        phoneOtp: z
            .object({
                enabled: z.boolean(),
            })
            .optional(),

        google: z
            .object({
                enabled: z.boolean(),
                clientId: z.string().min(1),
                clientSecret: z.string().min(1),
                redirectUri: z.string().min(1).optional(),
            })
            .optional(),

        apple: z
            .object({
                enabled: z.boolean(),
                clientId: z.string().min(1),
                teamId: z.string().min(1),
                keyId: z.string().min(1),
                privateKey: z.string().min(1),
            })
            .optional(),
    })
    .strict()

export type SimpleAuthProvidersConfig = z.infer<typeof SimpleAuthProvidersConfigSchema>

export const SimpleAuthServerConfigSchema = z
    .object({
        env: z.enum(['production', 'development', 'test']),

        redis: z
            .object({
                url: z.string().min(1).optional(),
                keyPrefix: z.string().min(1).optional(),
            })
            .strict(),

        otp: z
            .object({
                ttlSeconds: z.number().int().positive().optional(),
                maxAttempts: z.number().int().positive().optional(),
                rateLimit: z
                    .object({
                        windowSeconds: z.number().int().positive().optional(),
                        maxRequests: z.number().int().positive().optional(),
                    })
                    .strict()
                    .optional(),
                bypassCode: z.string().min(1).optional(),
            })
            .strict()
            .optional(),

        providers: SimpleAuthProvidersConfigSchema,
    })
    .strict()

export type SimpleAuthServerConfig = z.infer<typeof SimpleAuthServerConfigSchema>


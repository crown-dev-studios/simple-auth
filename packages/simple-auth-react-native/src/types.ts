import { z } from 'zod'

export const StoredTokensSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresAt: z.number().int(),
})

export type StoredTokens = z.infer<typeof StoredTokensSchema>


import { RefreshResponseSchema, type AuthTokens } from '@crown-dev-studios/simple-auth-shared-types'

import type { SimpleAuthApiClient } from './tokenManager'

export const createSimpleAuthApiClient = (args: {
  baseUrl: string
  refreshPath?: string
}): SimpleAuthApiClient => {
  const baseUrl = args.baseUrl.replace(/\/$/, '')
  const refreshPath = args.refreshPath ?? '/auth/refresh'

  return {
    refresh: async (refreshToken: string): Promise<AuthTokens> => {
      const response = await fetch(`${baseUrl}${refreshPath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      })

      const data: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error('Failed to refresh tokens')
      }

      return RefreshResponseSchema.parse(data)
    },
  }
}

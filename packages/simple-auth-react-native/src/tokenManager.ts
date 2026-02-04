import { RefreshResponseSchema, type AuthTokens } from '@crown-dev-studios/simple-auth-shared-types'
import { StoredTokensSchema, type StoredTokens } from './types'
import type { TokenStore } from './tokenStore'

export interface SimpleAuthApiClient {
  refresh: (refreshToken: string) => Promise<AuthTokens>
}

export interface TokenManagerOptions {
  /** Refresh access tokens this many seconds before expiry. Default: 30s */
  refreshLeewaySeconds?: number
  /** Time source (ms). Primarily for tests. */
  nowMs?: () => number
}

export class TokenManager {
  private inFlightRefresh: Promise<StoredTokens> | null = null
  private readonly refreshLeewaySeconds: number
  private readonly nowMs: () => number
  private static readonly MAX_REFRESH_TOKEN_LENGTH = 4096

  constructor(
    private readonly store: TokenStore,
    private readonly api: SimpleAuthApiClient,
    options: TokenManagerOptions = {}
  ) {
    this.refreshLeewaySeconds = options.refreshLeewaySeconds ?? 30
    this.nowMs = options.nowMs ?? (() => Date.now())
  }

  async getAccessToken(): Promise<string | null> {
    const tokens = await this.store.getTokens()
    if (!tokens) return null

    const now = this.nowMs()
    const shouldRefresh = tokens.expiresAt - this.refreshLeewaySeconds * 1000 <= now
    if (!shouldRefresh) return tokens.accessToken

    const refreshed = await this.refreshTokens()
    return refreshed.accessToken
  }

  async getTokens(): Promise<StoredTokens | null> {
    return this.store.getTokens()
  }

  async setTokens(tokens: StoredTokens): Promise<void> {
    await this.store.setTokens(StoredTokensSchema.parse(tokens))
  }

  async setTokensFromAuthTokens(tokens: AuthTokens): Promise<void> {
    const now = this.nowMs()
    await this.setTokens({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: now + tokens.expiresIn * 1000,
    })
  }

  async clearTokens(): Promise<void> {
    await this.store.clearTokens()
  }

  async refreshTokens(): Promise<StoredTokens> {
    if (this.inFlightRefresh) {
      return this.inFlightRefresh
    }

    const promise = (async () => {
      const current = await this.store.getTokens()
      if (!current?.refreshToken) {
        await this.clearTokens()
        throw new Error('No refresh token available')
      }

      if (
        current.refreshToken.length > TokenManager.MAX_REFRESH_TOKEN_LENGTH
        || /\s/.test(current.refreshToken)
      ) {
        await this.clearTokens()
        throw new Error('Invalid refresh token')
      }

      try {
        const refreshed = await this.api.refresh(current.refreshToken)
        const parsed = RefreshResponseSchema.parse(refreshed)
        const now = this.nowMs()

        const updated: StoredTokens = {
          accessToken: parsed.accessToken,
          refreshToken: parsed.refreshToken,
          expiresAt: now + parsed.expiresIn * 1000,
        }

        await this.store.setTokens(updated)
        return updated
      } catch (error) {
        await this.clearTokens()
        throw error instanceof Error ? error : new Error('Failed to refresh tokens')
      } finally {
        this.inFlightRefresh = null
      }
    })()

    this.inFlightRefresh = promise
    return promise
  }

  /**
   * Convenience wrapper around fetch that injects Authorization and retries once on 401.
   * NOTE: Avoid using this for the refresh endpoint itself.
   */
  async fetchWithAuth(
    input: RequestInfo,
    init: RequestInit = {}
  ): Promise<Response> {
    const accessToken = await this.getAccessToken()
    const headers = new Headers(init.headers)
    if (accessToken) {
      headers.set('Authorization', `Bearer ${accessToken}`)
    }

    const first = await fetch(input, { ...init, headers })
    if (first.status !== 401) return first

    const refreshed = await this.refreshTokens().catch(() => null)
    if (!refreshed) return first

    const retryHeaders = new Headers(init.headers)
    retryHeaders.set('Authorization', `Bearer ${refreshed.accessToken}`)
    return fetch(input, { ...init, headers: retryHeaders })
  }
}

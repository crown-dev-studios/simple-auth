import { OAuth2Client, gaxios } from 'google-auth-library'
import { z } from 'zod'

export interface GoogleOAuthConfig {
  clientId: string
  clientSecret: string
  redirectUri?: string
}

export interface ExchangeAuthCodeOptions {
  requiredScopes?: string[]
}

export type GoogleOAuthUserInfo = {
  sub: string
  email: string
  emailVerified: boolean
  firstName?: string
  lastName?: string
  rawPayload: Record<string, unknown>
}

export type GoogleOAuthExchangeData = {
  user: GoogleOAuthUserInfo
  refreshToken?: string
  accessToken?: string
  idToken: string
  scope?: string
  grantedScopes: string[]
}

export type GoogleOAuthExchangeResult =
  | { success: true; data: GoogleOAuthExchangeData }
  | { success: false; error: Error }

export type GoogleOAuthRevokeResult =
  | { success: true }
  | { success: false; error: Error }

const GoogleOAuthErrorResponseSchema = z
  .object({
    error: z.string(),
    error_description: z.string().optional(),
  })
  .passthrough()

class GoogleOAuthRequestError extends Error {
  readonly httpStatus?: number
  readonly oauthError?: string
  readonly oauthErrorDescription?: string

  constructor(
    message: string,
    options: {
      cause?: unknown
      httpStatus?: number
      oauthError?: string
      oauthErrorDescription?: string
    } = {}
  ) {
    super(message, { cause: options.cause })
    this.name = 'GoogleOAuthRequestError'
    this.httpStatus = options.httpStatus
    this.oauthError = options.oauthError
    this.oauthErrorDescription = options.oauthErrorDescription
  }
}

export class GoogleOAuthMissingScopesError extends Error {
  readonly missingScopes: string[]
  readonly grantedScopes: string[]

  constructor(missingScopes: string[], grantedScopes: string[]) {
    super(`Google OAuth token is missing required scopes: ${missingScopes.join(', ')}`)
    this.name = 'GoogleOAuthMissingScopesError'
    this.missingScopes = missingScopes
    this.grantedScopes = grantedScopes
  }
}

export class GoogleOAuthService {
  private readonly client: OAuth2Client
  private readonly redirectUri?: string

  constructor(private readonly config: GoogleOAuthConfig) {
    this.client = new OAuth2Client(config.clientId, config.clientSecret, config.redirectUri)
    this.redirectUri = config.redirectUri
  }

  async exchangeAuthCode(authCode: string, options: ExchangeAuthCodeOptions = {}): Promise<GoogleOAuthExchangeResult> {
    try {
      const { tokens } = await this.client.getToken({
        code: authCode,
        ...(this.redirectUri ? { redirect_uri: this.redirectUri } : {}),
      })

      if (!tokens.id_token) {
        return { success: false, error: new Error('Token exchange failed: missing id_token') }
      }

      const ticket = await this.client.verifyIdToken({
        idToken: tokens.id_token,
        audience: this.config.clientId,
      })

      const payload = ticket.getPayload()
      if (!payload?.sub || !payload.email) {
        return { success: false, error: new Error('Invalid token payload') }
      }

      const scope = typeof tokens.scope === 'string' && tokens.scope.length > 0 ? tokens.scope : undefined
      const grantedScopes = this.parseScopeString(scope)

      const requiredScopes = this.normalizeScopes(options.requiredScopes ?? [])
      if (requiredScopes.length > 0) {
        const grantedScopeSet = new Set(grantedScopes)
        const missingScopes = requiredScopes.filter((entry) => !grantedScopeSet.has(entry))
        if (missingScopes.length > 0) {
          return {
            success: false,
            error: new GoogleOAuthMissingScopesError(missingScopes, grantedScopes),
          }
        }
      }

      return {
        success: true,
        data: {
          user: {
            sub: payload.sub,
            email: payload.email,
            emailVerified: payload.email_verified ?? false,
            firstName: payload.given_name,
            lastName: payload.family_name,
            rawPayload: payload as unknown as Record<string, unknown>,
          },
          refreshToken: tokens.refresh_token ?? undefined,
          accessToken: tokens.access_token ?? undefined,
          idToken: tokens.id_token,
          scope,
          grantedScopes,
        },
      }
    } catch (error) {
      return { success: false, error: this.normalizeExchangeError(error) }
    }
  }

  async revokeToken(token: string): Promise<GoogleOAuthRevokeResult> {
    if (!token || token.trim().length === 0) {
      return { success: false, error: new Error('Token is required') }
    }

    try {
      await this.client.revokeToken(token)
      return { success: true }
    } catch (error) {
      return { success: false, error: this.normalizeRevokeError(error) }
    }
  }

  private normalizeExchangeError(error: unknown): Error {
    return this.normalizeGoogleOAuthError('token exchange', error)
  }

  private normalizeRevokeError(error: unknown): Error {
    return this.normalizeGoogleOAuthError('token revoke', error)
  }

  private normalizeGoogleOAuthError(operation: 'token exchange' | 'token revoke', error: unknown): Error {
    if (error instanceof gaxios.GaxiosError) {
      const status = error.response?.status
      const statusText = error.response?.statusText
      const httpLabel =
        statusText && statusText.length > 0 && typeof status === 'number' ? `HTTP ${status} ${statusText}` : `HTTP ${status ?? 'unknown'}`

      const responseData = this.parseResponseData(error.response?.data)
      const parsed = GoogleOAuthErrorResponseSchema.safeParse(responseData)
      if (parsed.success) {
        const suffix = parsed.data.error_description ? `: ${parsed.data.error_description}` : ''
        return new GoogleOAuthRequestError(
          `Google OAuth ${operation} failed (${httpLabel}): ${parsed.data.error}${suffix}`,
          {
            cause: error,
            httpStatus: typeof status === 'number' ? status : undefined,
            oauthError: parsed.data.error,
            oauthErrorDescription: parsed.data.error_description,
          }
        )
      }

      return new GoogleOAuthRequestError(`Google OAuth ${operation} failed (${httpLabel}): ${error.message}`, {
        cause: error,
        httpStatus: typeof status === 'number' ? status : undefined,
      })
    }

    if (error instanceof Error) {
      const code = (error as NodeJS.ErrnoException).code
      if (typeof code === 'string' && code.length > 0) {
        return new GoogleOAuthRequestError(`Google OAuth ${operation} failed (${code}): ${error.message}`, {
          cause: error,
        })
      }

      return new GoogleOAuthRequestError(`Google OAuth ${operation} failed: ${error.message}`, { cause: error })
    }

    return new Error(`Google OAuth ${operation} failed`)
  }

  private parseScopeString(scope: string | undefined): string[] {
    if (!scope) {
      return []
    }

    return this.normalizeScopes(scope.split(/\s+/g))
  }

  private normalizeScopes(scopes: string[]): string[] {
    const seen = new Set<string>()
    const normalized: string[] = []

    for (const scope of scopes) {
      const trimmed = scope.trim()
      if (!trimmed || seen.has(trimmed)) {
        continue
      }

      seen.add(trimmed)
      normalized.push(trimmed)
    }

    return normalized
  }

  private parseResponseData(data: unknown): unknown {
    if (typeof data !== 'string') {
      return data
    }

    try {
      return JSON.parse(data)
    } catch {
      return data
    }
  }
}

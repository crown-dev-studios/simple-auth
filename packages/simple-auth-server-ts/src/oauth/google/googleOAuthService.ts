import { OAuth2Client } from 'google-auth-library'

export interface GoogleOAuthConfig {
  clientId: string
  clientSecret: string
  redirectUri?: string
}

export type GoogleOAuthUserInfo = {
  sub: string
  email: string
  emailVerified: boolean
  firstName?: string
  lastName?: string
  rawPayload: Record<string, unknown>
}

export type GoogleOAuthExchangeResult =
  | { success: true; data: { user: GoogleOAuthUserInfo; refreshToken?: string; accessToken?: string; idToken: string } }
  | { success: false; error: Error }

export class GoogleOAuthService {
  private readonly client: OAuth2Client
  private readonly redirectUri?: string

  constructor(private readonly config: GoogleOAuthConfig) {
    this.client = new OAuth2Client(config.clientId, config.clientSecret, config.redirectUri)
    this.redirectUri = config.redirectUri
  }

  async exchangeAuthCode(authCode: string): Promise<GoogleOAuthExchangeResult> {
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
        },
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error : new Error('Auth code exchange failed') }
    }
  }
}


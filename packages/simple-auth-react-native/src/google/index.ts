export {
  configureGoogleAuth,
  signInWithGoogle,
  updateGoogleScopes,
  getGoogleGrantedScopes,
  revokeGoogleAccess,
  signOutGoogle,
  type GoogleAuthConfig,
  type GoogleAuthResult,
  type GoogleAuthScopeMode,
  type GoogleScopeUpdateRequest,
} from '@crown-dev-studios/google-auth'

import { OAuthResponseSchema, type OAuthResponse } from '@crown-dev-studios/simple-auth-shared-types'

export const exchangeGoogleAuthCode = async (args: {
  baseUrl: string
  authCode: string
}): Promise<OAuthResponse> => {
  const response = await fetch(`${args.baseUrl.replace(/\/$/, '')}/auth/oauth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ authCode: args.authCode }),
  })

  const data: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message =
      data && typeof data === 'object' && 'message' in data && typeof (data as { message?: unknown }).message === 'string'
        ? (data as { message: string }).message
        : 'Google OAuth exchange failed'
    throw new Error(message)
  }

  return OAuthResponseSchema.parse(data)
}

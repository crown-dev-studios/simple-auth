import { NativeModules, Platform } from 'react-native'

const MODULE_NAME = 'CDSGoogleAuth'

export interface GoogleAuthConfig {
    iosClientId: string
    webClientId: string
    scopes?: string[]
}

export type GoogleAuthScopeMode = 'add' | 'replace'

export interface GoogleScopeUpdateRequest {
    scopes: string[]
    mode: GoogleAuthScopeMode
}

export interface GoogleAuthResult {
    authCode: string
    grantedScopes: string[]
}

const DEFAULT_SCOPES = ['openid', 'email', 'profile']

type NativeGoogleAuthModule = {
    configure: (options: { iosClientId: string; webClientId: string; scopes: string[] }) => Promise<void>
    signIn: () => Promise<{ authCode: string; grantedScopes?: unknown }>
    updateScopes: (scopes: string[], mode: GoogleAuthScopeMode) => Promise<{ authCode: string; grantedScopes?: unknown }>
    getGrantedScopes: () => Promise<unknown>
    revokeAccess: () => Promise<void>
    signOut: () => Promise<void>
}

const getNativeModule = (): NativeGoogleAuthModule => {
    const module = NativeModules[MODULE_NAME]
    if (!module) {
        throw new Error('CDSGoogleAuth native module is not installed')
    }
    return module as NativeGoogleAuthModule
}

const normalizeScopes = (value: unknown): string[] => {
    if (!Array.isArray(value)) {
        return []
    }

    const seen = new Set<string>()
    const normalized: string[] = []

    for (const entry of value) {
        if (typeof entry !== 'string') {
            continue
        }

        const trimmed = entry.trim()
        if (!trimmed || seen.has(trimmed)) {
            continue
        }

        seen.add(trimmed)
        normalized.push(trimmed)
    }

    return normalized
}

const normalizeAuthResult = (result: { authCode: string; grantedScopes?: unknown }): GoogleAuthResult => {
    if (!result.authCode || typeof result.authCode !== 'string') {
        throw new Error('Invalid Google auth response: missing authCode')
    }

    return {
        authCode: result.authCode,
        grantedScopes: normalizeScopes(result.grantedScopes),
    }
}

export const configureGoogleAuth = async (config: GoogleAuthConfig): Promise<void> => {
    if (!config.webClientId) {
        throw new Error('webClientId is required')
    }
    if (Platform.OS === 'ios' && !config.iosClientId) {
        throw new Error('iosClientId is required on iOS')
    }

    const scopes = config.scopes && config.scopes.length > 0 ? config.scopes : DEFAULT_SCOPES
    const native = getNativeModule()
    await native.configure({
        iosClientId: config.iosClientId,
        webClientId: config.webClientId,
        scopes,
    })
}

export const signInWithGoogle = async (): Promise<GoogleAuthResult> => {
    const native = getNativeModule()
    return normalizeAuthResult(await native.signIn())
}

export const updateGoogleScopes = async (request: GoogleScopeUpdateRequest): Promise<GoogleAuthResult> => {
    if (!request || !Array.isArray(request.scopes)) {
        throw new Error('scopes must be an array')
    }
    if (request.mode !== 'add' && request.mode !== 'replace') {
        throw new Error("mode must be 'add' or 'replace'")
    }

    const native = getNativeModule()
    return normalizeAuthResult(await native.updateScopes(request.scopes, request.mode))
}

export const getGoogleGrantedScopes = async (): Promise<string[]> => {
    const native = getNativeModule()
    return normalizeScopes(await native.getGrantedScopes())
}

export const revokeGoogleAccess = async (): Promise<void> => {
    const native = getNativeModule()
    await native.revokeAccess()
}

export const signOutGoogle = async (): Promise<void> => {
    const native = getNativeModule()
    await native.signOut()
}

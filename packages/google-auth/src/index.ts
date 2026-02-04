import { NativeModules, Platform } from 'react-native'

const MODULE_NAME = 'CDSGoogleAuth'

export interface GoogleAuthConfig {
    iosClientId: string
    webClientId: string
    scopes?: string[]
}

export interface GoogleAuthResult {
    authCode: string
}

const DEFAULT_SCOPES = ['openid', 'email', 'profile']

const getNativeModule = () => {
    const module = NativeModules[MODULE_NAME]
    if (!module) {
        throw new Error('CDSGoogleAuth native module is not installed')
    }
    return module as {
        configure: (options: { iosClientId: string; webClientId: string; scopes: string[] }) => Promise<void>
        signIn: () => Promise<GoogleAuthResult>
        signOut: () => Promise<void>
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
    return native.signIn()
}

export const signOutGoogle = async (): Promise<void> => {
    const native = getNativeModule()
    await native.signOut()
}

import { ConfigPlugin, withInfoPlist } from '@expo/config-plugins'

interface GoogleAuthPluginProps {
    iosClientId?: string
    webClientId?: string
    iosReversedClientId?: string
}

const getReversedClientId = (iosClientId: string, explicit?: string) => {
    if (explicit) return explicit

    const match = iosClientId.match(/^(.*)\.apps\.googleusercontent\.com$/)
    if (!match || !match[1]) {
        throw new Error('Unable to derive reversed client ID from iOS client ID')
    }

    return `com.googleusercontent.apps.${match[1]}`
}

export const withGoogleAuth: ConfigPlugin<GoogleAuthPluginProps> = (config, props = {}) => {
    const iosClientId = props.iosClientId
    const webClientId = props.webClientId

    if (!iosClientId || !webClientId) {
        return config
    }

    return withInfoPlist(config, (infoConfig) => {
        const infoPlist = infoConfig.modResults
        infoPlist.GIDClientID = iosClientId
        infoPlist.GIDServerClientID = webClientId

        const reversedClientId = getReversedClientId(iosClientId, props.iosReversedClientId)
        const urlTypes = infoPlist.CFBundleURLTypes ?? []

        const existing = urlTypes.find((item: { CFBundleURLSchemes?: string[] }) =>
            item?.CFBundleURLSchemes?.includes(reversedClientId)
        )

        if (!existing) {
            urlTypes.push({
                CFBundleURLSchemes: [reversedClientId],
            })
        }

        infoPlist.CFBundleURLTypes = urlTypes
        return infoConfig
    })
}
export default withGoogleAuth

# SimpleAuthNative

Pure Swift client helpers for apps using a server-owned auth flow. This package
includes secure token storage, automatic refresh, and a small API client for
refresh and Google auth-code exchange endpoints.

## Product

This repo exposes the `SimpleAuthNative` library product from the root
`Package.swift`.

## Best For

- Native iOS apps that receive app tokens from a backend
- Apps using Google auth-code exchange on the server
- Teams that want a lightweight token manager instead of a full SDK stack

## Add to Your App

Add this repository as a Swift Package dependency and link `SimpleAuthNative`.

Platform requirement:

- iOS 18.0+

## Quick Start

```swift
import Foundation
import SimpleAuthNative

let store = KeychainTokenStore()
let api = SimpleAuthApiClient(
    config: SimpleAuthApiClientConfig(
        baseUrl: URL(string: "https://api.example.com")!
    )
)

let tokenManager = TokenManager(store: store, api: api)
```

## Main Components

### `KeychainTokenStore`

Stores tokens in the iOS keychain.

```swift
let store = KeychainTokenStore(service: "simple-auth", account: "tokens")
```

### `SimpleAuthApiClient`

Calls your auth server for refresh and Google OAuth exchange.

```swift
let api = SimpleAuthApiClient(
    config: SimpleAuthApiClientConfig(
        baseUrl: URL(string: "https://api.example.com")!,
        refreshPath: "/auth/refresh",
        googleOAuthPath: "/auth/oauth/google"
    )
)
```

### `TokenManager`

Handles token loading, refresh, deduplication, and clearing.

```swift
let accessToken = try await tokenManager.getAccessToken()
```

Useful methods:

- `getTokens()`
- `setTokens(_:)`
- `setTokens(accessToken:refreshToken:expiresInSeconds:)`
- `clearTokens()`
- `getAccessToken()`
- `refreshTokens()`

### `OAuthResponse`

`exchangeGoogleAuthCode(authCode:)` returns a typed OAuth response enum:

- `.authenticated`
- `.needsPhone`
- `.needsLinking`

## Typical Google Flow

1. Use `GoogleAuthNative` to obtain a Google `authCode`.
2. Call `api.exchangeGoogleAuthCode(authCode:)`.
3. If the result is `.authenticated`, persist the returned app tokens.
4. If the result needs more onboarding, continue with the returned session data.

## Notes

- This package does not own your user model or session model.
- Refresh failures clear stored tokens.
- The API client assumes your backend matches the Simple Auth JSON contracts.

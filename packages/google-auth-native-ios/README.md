# GoogleAuthNative

Pure Swift Google auth-code sign-in for iOS, packaged as a SwiftPM target. Use
this when your iOS app wants Google Sign-In to return a one-time server auth
code and your backend performs the token exchange.

## Product

This repo exposes the `GoogleAuthNative` library product from the root
`Package.swift`.

## Add to Your App

In Xcode, add this repository as a Swift Package dependency and link the
`GoogleAuthNative` product.

If you declare dependencies in `Package.swift`, point to the repository that
contains this package and depend on the `GoogleAuthNative` product.

Platform requirement:

- iOS 18.0+

## Quick Start

```swift
import GoogleAuthNative
import UIKit

let client = GoogleAuthClient()

client.configure(
    GoogleAuthConfiguration(
        iosClientId: "your-ios-client-id.apps.googleusercontent.com",
        webClientId: "your-web-client-id.apps.googleusercontent.com"
    )
)

let result = try await client.signIn(presentingViewController: viewController)
let authCode = result.authCode
let grantedScopes = result.grantedScopes
```

## Main API

- `GoogleAuthConfiguration`
- `GoogleAuthClient`
- `GoogleAuthResult`
- `GoogleAuthScopeMode`
- `GoogleAuthError`

### Scope Updates

```swift
let updated = try await client.updateScopes(
    scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
    mode: .add,
    presentingViewController: viewController
)
```

### Session Helpers

- `client.getGrantedScopes()`
- `client.signOut()`
- `try await client.revokeAccess()`

## Error Cases

`GoogleAuthError` covers the main failure modes:

- `configMissing`
- `signInInProgress`
- `notSignedIn`
- `noScopeChangeRequired`
- `canceled`
- `timeout`
- `missingAuthCode`
- `presentationError`
- `revokeFailed`
- `underlying`

## Intended Flow

1. Configure the client once.
2. Start Google sign-in from a visible view controller.
3. Send the returned `authCode` to your backend.
4. Exchange the code on the server and continue app auth.

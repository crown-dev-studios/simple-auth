import Foundation
import GoogleSignIn

#if canImport(UIKit)
import UIKit
#endif

#if canImport(AppKit)
import AppKit
#endif

public struct GoogleAuthConfiguration: Sendable {
    public let iosClientId: String
    public let webClientId: String
    public let scopes: [String]

    public init(
        iosClientId: String,
        webClientId: String,
        scopes: [String] = ["openid", "email", "profile"]
    ) {
        self.iosClientId = iosClientId
        self.webClientId = webClientId
        self.scopes = scopes
    }
}

public enum GoogleAuthError: Error {
    case configMissing
    case signInInProgress
    case canceled
    case timeout
    case missingAuthCode
    case presentationError
    case underlying(Error)
}

@MainActor
public final class GoogleAuthClient {
    private var config: GoogleAuthConfiguration?
    private var isSigningIn = false

    private let googleSignInErrorDomain = "com.google.GIDSignIn"
    private let googleSignInCanceledErrorCode = -5

    public init() {}

    public func configure(_ config: GoogleAuthConfiguration) {
        self.config = config
        GIDSignIn.sharedInstance.configuration = GIDConfiguration(
            clientID: config.iosClientId,
            serverClientID: config.webClientId
        )
    }

    private func signInInternal(
        timeoutSeconds: TimeInterval,
        start: (@escaping (GIDSignInResult?, Error?) -> Void) -> Void
    ) async throws -> String {
        let clampedTimeout = max(1, timeoutSeconds)
        return try await withCheckedThrowingContinuation { continuation in
            var didFinish = false

            let timeoutWorkItem = DispatchWorkItem {
                guard !didFinish else { return }
                didFinish = true
                continuation.resume(throwing: GoogleAuthError.timeout)
            }
            DispatchQueue.main.asyncAfter(
                deadline: .now() + clampedTimeout,
                execute: timeoutWorkItem
            )

            start { result, error in
                guard !didFinish else { return }
                didFinish = true
                timeoutWorkItem.cancel()

                if let error {
                    let nsError = error as NSError
                    if nsError.domain == self.googleSignInErrorDomain
                        && nsError.code == self.googleSignInCanceledErrorCode
                    {
                        continuation.resume(throwing: GoogleAuthError.canceled)
                        return
                    }

                    continuation.resume(throwing: GoogleAuthError.underlying(error))
                    return
                }

                guard let authCode = result?.serverAuthCode, !authCode.isEmpty else {
                    continuation.resume(throwing: GoogleAuthError.missingAuthCode)
                    return
                }

                continuation.resume(returning: authCode)
            }
        }
    }

#if canImport(UIKit)
    public func signIn(
        presentingViewController: UIViewController,
        timeoutSeconds: TimeInterval = 60
    ) async throws -> String {
        guard !isSigningIn else {
            throw GoogleAuthError.signInInProgress
        }

        guard let config else {
            throw GoogleAuthError.configMissing
        }

        guard presentingViewController.viewIfLoaded?.window != nil else {
            throw GoogleAuthError.presentationError
        }

        isSigningIn = true
        defer { isSigningIn = false }

        // Ensure configuration remains consistent even if other code mutates it.
        GIDSignIn.sharedInstance.configuration = GIDConfiguration(
            clientID: config.iosClientId,
            serverClientID: config.webClientId
        )

        return try await signInInternal(timeoutSeconds: timeoutSeconds) { completion in
            GIDSignIn.sharedInstance.signIn(
                withPresenting: presentingViewController,
                hint: nil,
                additionalScopes: config.scopes
            ) { result, error in
                completion(result, error)
            }
        }
    }
#endif

#if canImport(AppKit)
    public func signIn(
        presentingWindow: NSWindow,
        timeoutSeconds: TimeInterval = 60
    ) async throws -> String {
        guard !isSigningIn else {
            throw GoogleAuthError.signInInProgress
        }

        guard let config else {
            throw GoogleAuthError.configMissing
        }

        guard presentingWindow.isVisible else {
            throw GoogleAuthError.presentationError
        }

        isSigningIn = true
        defer { isSigningIn = false }

        // Ensure configuration remains consistent even if other code mutates it.
        GIDSignIn.sharedInstance.configuration = GIDConfiguration(
            clientID: config.iosClientId,
            serverClientID: config.webClientId
        )

        return try await signInInternal(timeoutSeconds: timeoutSeconds) { completion in
            GIDSignIn.sharedInstance.signIn(
                withPresenting: presentingWindow,
                hint: nil,
                additionalScopes: config.scopes
            ) { result, error in
                completion(result, error)
            }
        }
    }
#endif

    public func signOut() {
        GIDSignIn.sharedInstance.signOut()
    }
}

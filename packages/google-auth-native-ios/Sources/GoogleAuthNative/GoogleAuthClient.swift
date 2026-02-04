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

private actor CompletionGate {
    private var finished = false

    func tryFinish() -> Bool {
        guard !finished else { return false }
        finished = true
        return true
    }
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
        start: (@escaping @Sendable (GIDSignInResult?, Error?) -> Void) -> Void
    ) async throws -> String {
        let clampedTimeout = max(1, timeoutSeconds)
        let signInErrorDomain = googleSignInErrorDomain
        let signInCanceledErrorCode = googleSignInCanceledErrorCode

        return try await withCheckedThrowingContinuation { continuation in
            let gate = CompletionGate()

            let timeoutTask = Task {
                try? await Task.sleep(for: .seconds(clampedTimeout))
                guard !Task.isCancelled else { return }
                guard await gate.tryFinish() else { return }
                continuation.resume(throwing: GoogleAuthError.timeout)
            }

            start { @Sendable result, error in
                let authCode = result?.serverAuthCode

                let errorInfo: (domain: String, code: Int, description: String)?
                if let error {
                    let nsError = error as NSError
                    errorInfo = (domain: nsError.domain, code: nsError.code, description: nsError.localizedDescription)
                } else {
                    errorInfo = nil
                }

                Task {
                    guard await gate.tryFinish() else { return }
                    timeoutTask.cancel()

                    if let errorInfo {
                        if errorInfo.domain == signInErrorDomain && errorInfo.code == signInCanceledErrorCode {
                            continuation.resume(throwing: GoogleAuthError.canceled)
                            return
                        }

                        let wrapped = NSError(
                            domain: errorInfo.domain,
                            code: errorInfo.code,
                            userInfo: [NSLocalizedDescriptionKey: errorInfo.description]
                        )
                        continuation.resume(throwing: GoogleAuthError.underlying(wrapped))
                        return
                    }

                    guard let authCode, !authCode.isEmpty else {
                        continuation.resume(throwing: GoogleAuthError.missingAuthCode)
                        return
                    }

                    continuation.resume(returning: authCode)
                }
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

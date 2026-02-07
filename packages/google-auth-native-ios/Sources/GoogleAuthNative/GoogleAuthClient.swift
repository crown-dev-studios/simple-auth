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

public enum GoogleAuthScopeMode: String, Sendable {
    case add
    case replace
}

public struct GoogleAuthResult: Sendable {
    public let authCode: String
    public let grantedScopes: [String]

    public init(authCode: String, grantedScopes: [String]) {
        self.authCode = authCode
        self.grantedScopes = grantedScopes
    }
}

public enum GoogleAuthError: Error {
    case configMissing
    case signInInProgress
    case notSignedIn
    case noScopeChangeRequired
    case canceled
    case timeout
    case missingAuthCode
    case presentationError
    case revokeFailed(Error)
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
        let normalizedScopes = normalizeScopes(config.scopes)
        self.config = GoogleAuthConfiguration(
            iosClientId: config.iosClientId,
            webClientId: config.webClientId,
            scopes: normalizedScopes
        )

        GIDSignIn.sharedInstance.configuration = GIDConfiguration(
            clientID: config.iosClientId,
            serverClientID: config.webClientId
        )
    }

    public func getGrantedScopes() -> [String] {
        normalizeScopes(GIDSignIn.sharedInstance.currentUser?.grantedScopes ?? [])
    }

    public func signOut() {
        GIDSignIn.sharedInstance.signOut()
    }

    public func revokeAccess() async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            GIDSignIn.sharedInstance.disconnect { error in
                if let error {
                    continuation.resume(throwing: GoogleAuthError.revokeFailed(error))
                } else {
                    continuation.resume(returning: ())
                }
            }
        }
    }

    private func normalizeScopes(_ scopes: [String]) -> [String] {
        var seen = Set<String>()
        var normalized: [String] = []

        for scope in scopes {
            let trimmed = scope.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { continue }
            if seen.insert(trimmed).inserted {
                normalized.append(trimmed)
            }
        }

        return normalized
    }

    private func mergeScopes(_ lhs: [String], _ rhs: [String]) -> [String] {
        normalizeScopes(lhs + rhs)
    }

    private func signInInternal(
        timeoutSeconds: TimeInterval,
        fallbackScopes: [String],
        start: (@escaping @Sendable (GIDSignInResult?, Error?) -> Void) -> Void
    ) async throws -> GoogleAuthResult {
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
                let grantedScopesCandidate = result?.user.grantedScopes ?? fallbackScopes

                let errorInfo: (domain: String, code: Int, description: String)?
                if let error {
                    let nsError = error as NSError
                    errorInfo = (domain: nsError.domain, code: nsError.code, description: nsError.localizedDescription)
                } else {
                    errorInfo = nil
                }

                Task { @MainActor in
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

                    let grantedScopes = self.normalizeScopes(grantedScopesCandidate)
                    continuation.resume(returning: GoogleAuthResult(authCode: authCode, grantedScopes: grantedScopes))
                }
            }
        }
    }

#if canImport(UIKit)
    public func signIn(
        presentingViewController: UIViewController,
        timeoutSeconds: TimeInterval = 60
    ) async throws -> GoogleAuthResult {
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

        GIDSignIn.sharedInstance.configuration = GIDConfiguration(
            clientID: config.iosClientId,
            serverClientID: config.webClientId
        )

        return try await signInInternal(timeoutSeconds: timeoutSeconds, fallbackScopes: config.scopes) { completion in
            GIDSignIn.sharedInstance.signIn(
                withPresenting: presentingViewController,
                hint: nil,
                additionalScopes: config.scopes
            ) { result, error in
                completion(result, error)
            }
        }
    }

    public func updateScopes(
        scopes: [String],
        mode: GoogleAuthScopeMode,
        presentingViewController: UIViewController,
        timeoutSeconds: TimeInterval = 60
    ) async throws -> GoogleAuthResult {
        guard !isSigningIn else {
            throw GoogleAuthError.signInInProgress
        }

        guard let config else {
            throw GoogleAuthError.configMissing
        }

        guard presentingViewController.viewIfLoaded?.window != nil else {
            throw GoogleAuthError.presentationError
        }

        guard let currentUser = GIDSignIn.sharedInstance.currentUser else {
            throw GoogleAuthError.notSignedIn
        }

        let targetScopes = normalizeScopes(scopes)
        let currentScopes = getGrantedScopes()
        let currentSet = Set(currentScopes)
        let targetSet = Set(targetScopes)

        let requestedScopes: [String]
        switch mode {
        case .add:
            requestedScopes = targetScopes.filter { !currentSet.contains($0) }
            if requestedScopes.isEmpty {
                throw GoogleAuthError.noScopeChangeRequired
            }

        case .replace:
            if targetSet == currentSet {
                throw GoogleAuthError.noScopeChangeRequired
            }

            let hasRemovals = !currentSet.isSubset(of: targetSet)
            if hasRemovals {
                try await revokeAccess()
            }
            requestedScopes = targetScopes
        }

        isSigningIn = true
        defer { isSigningIn = false }

        GIDSignIn.sharedInstance.configuration = GIDConfiguration(
            clientID: config.iosClientId,
            serverClientID: config.webClientId
        )

        switch mode {
        case .add:
            return try await signInInternal(
                timeoutSeconds: timeoutSeconds,
                fallbackScopes: mergeScopes(currentScopes, requestedScopes)
            ) { completion in
                currentUser.addScopes(
                    requestedScopes,
                    presenting: presentingViewController
                ) { result, error in
                    completion(result, error)
                }
            }

        case .replace:
            return try await signInInternal(
                timeoutSeconds: timeoutSeconds,
                fallbackScopes: requestedScopes
            ) { completion in
                GIDSignIn.sharedInstance.signIn(
                    withPresenting: presentingViewController,
                    hint: nil,
                    additionalScopes: requestedScopes
                ) { result, error in
                    completion(result, error)
                }
            }
        }
    }
#endif

#if canImport(AppKit)
    public func signIn(
        presentingWindow: NSWindow,
        timeoutSeconds: TimeInterval = 60
    ) async throws -> GoogleAuthResult {
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

        GIDSignIn.sharedInstance.configuration = GIDConfiguration(
            clientID: config.iosClientId,
            serverClientID: config.webClientId
        )

        return try await signInInternal(timeoutSeconds: timeoutSeconds, fallbackScopes: config.scopes) { completion in
            GIDSignIn.sharedInstance.signIn(
                withPresenting: presentingWindow,
                hint: nil,
                additionalScopes: config.scopes
            ) { result, error in
                completion(result, error)
            }
        }
    }

    public func updateScopes(
        scopes: [String],
        mode: GoogleAuthScopeMode,
        presentingWindow: NSWindow,
        timeoutSeconds: TimeInterval = 60
    ) async throws -> GoogleAuthResult {
        guard !isSigningIn else {
            throw GoogleAuthError.signInInProgress
        }

        guard let config else {
            throw GoogleAuthError.configMissing
        }

        guard presentingWindow.isVisible else {
            throw GoogleAuthError.presentationError
        }

        guard let currentUser = GIDSignIn.sharedInstance.currentUser else {
            throw GoogleAuthError.notSignedIn
        }

        let targetScopes = normalizeScopes(scopes)
        let currentScopes = getGrantedScopes()
        let currentSet = Set(currentScopes)
        let targetSet = Set(targetScopes)

        let requestedScopes: [String]
        switch mode {
        case .add:
            requestedScopes = targetScopes.filter { !currentSet.contains($0) }
            if requestedScopes.isEmpty {
                throw GoogleAuthError.noScopeChangeRequired
            }

        case .replace:
            if targetSet == currentSet {
                throw GoogleAuthError.noScopeChangeRequired
            }

            let hasRemovals = !currentSet.isSubset(of: targetSet)
            if hasRemovals {
                try await revokeAccess()
            }
            requestedScopes = targetScopes
        }

        isSigningIn = true
        defer { isSigningIn = false }

        GIDSignIn.sharedInstance.configuration = GIDConfiguration(
            clientID: config.iosClientId,
            serverClientID: config.webClientId
        )

        switch mode {
        case .add:
            return try await signInInternal(
                timeoutSeconds: timeoutSeconds,
                fallbackScopes: mergeScopes(currentScopes, requestedScopes)
            ) { completion in
                currentUser.addScopes(
                    requestedScopes,
                    presenting: presentingWindow
                ) { result, error in
                    completion(result, error)
                }
            }

        case .replace:
            return try await signInInternal(
                timeoutSeconds: timeoutSeconds,
                fallbackScopes: requestedScopes
            ) { completion in
                GIDSignIn.sharedInstance.signIn(
                    withPresenting: presentingWindow,
                    hint: nil,
                    additionalScopes: requestedScopes
                ) { result, error in
                    completion(result, error)
                }
            }
        }
    }
#endif
}

import Foundation
import GoogleSignIn
@preconcurrency import React
import UIKit

private struct GoogleAuthConfig: Sendable {
    let iosClientId: String
    let webClientId: String
    let scopes: [String]
}

/// React Native bridge module for Google Sign-In.
///
/// ## Thread Safety Invariant
///
/// This class is marked `@unchecked Sendable` because React Native's bridge
/// provides external thread safety guarantees:
///
/// 1. `requiresMainQueueSetup() -> true` ensures all ObjC bridge method calls
///    (configure, signIn, signOut) are dispatched to the main queue.
/// 2. GoogleSignIn SDK callbacks are delivered on the main queue.
/// 3. All property access is therefore serialized on main queue.
///
/// This is a legitimate use of `@unchecked Sendable` per Swift concurrency
/// guidelines - the safety is provided by the framework (React Native), not
/// by Swift's type system.
///
/// TODO: If React Native adopts Swift-native modules with proper actor isolation,
/// migrate this to use `@MainActor` class isolation instead.
@objc(CDSGoogleAuth)
final class CDSGoogleAuth: NSObject, @unchecked Sendable {
    private var config: GoogleAuthConfig?
    private var pendingPromise: (resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock)?
    private var pendingTimeoutTask: Task<Void, Never>?

    private let signInTimeoutSeconds: TimeInterval = 60
    private let googleSignInErrorDomain = "com.google.GIDSignIn"
    private let googleSignInCanceledErrorCode = -5

    @objc
    static func requiresMainQueueSetup() -> Bool {
        true
    }

    // MARK: - Configure

    @objc(configure:resolver:rejecter:)
    func configure(
        _ options: NSDictionary,
        resolver resolve: RCTPromiseResolveBlock,
        rejecter reject: RCTPromiseRejectBlock
    ) {
        guard let iosClientId = options["iosClientId"] as? String, !iosClientId.isEmpty else {
            reject("config_error", "iosClientId is required", nil)
            return
        }

        guard let webClientId = options["webClientId"] as? String, !webClientId.isEmpty else {
            reject("config_error", "webClientId is required", nil)
            return
        }

        let scopes = options["scopes"] as? [String] ?? ["openid", "email", "profile"]
        config = GoogleAuthConfig(iosClientId: iosClientId, webClientId: webClientId, scopes: scopes)
        resolve(nil)
    }

    // MARK: - Sign In

    @objc(signIn:rejecter:)
    func signIn(
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        if pendingPromise != nil {
            reject("sign_in_in_progress", "Google sign-in already in progress", nil)
            return
        }

        guard let config else {
            reject("config_error", "Google auth not configured", nil)
            return
        }

        guard let presenter = RCTPresentedViewController() else {
            reject("presentation_error", "Unable to find a presenting view controller", nil)
            return
        }

        pendingPromise = (resolve: resolve, reject: reject)

        pendingTimeoutTask?.cancel()
        let timeoutSeconds = signInTimeoutSeconds
        pendingTimeoutTask = Task.detached { [weak self] in
            try? await Task.sleep(for: .seconds(timeoutSeconds))
            guard !Task.isCancelled else { return }
            await MainActor.run { [weak self] in
                self?.rejectPending("sign_in_timeout", "Google sign-in timed out", nil)
            }
        }

        let configuration = GIDConfiguration(clientID: config.iosClientId, serverClientID: config.webClientId)
        GIDSignIn.sharedInstance.configuration = configuration

        GIDSignIn.sharedInstance.signIn(
            withPresenting: presenter,
            hint: nil,
            additionalScopes: config.scopes
        ) { [weak self] result, error in
            guard let self else { return }

            if let error {
                let nsError = error as NSError
                if nsError.domain == self.googleSignInErrorDomain
                    && nsError.code == self.googleSignInCanceledErrorCode
                {
                    self.rejectPending("sign_in_canceled", "Google sign-in canceled", nil)
                    return
                }
                self.rejectPending("sign_in_failed", nsError.localizedDescription, error)
                return
            }

            guard let authCode = result?.serverAuthCode, !authCode.isEmpty else {
                self.rejectPending("auth_code_failed", "Missing server auth code", nil)
                return
            }

            self.resolvePending(["authCode": authCode])
        }
    }

    // MARK: - Sign Out

    @objc(signOut:rejecter:)
    func signOut(
        resolver resolve: RCTPromiseResolveBlock,
        rejecter _: RCTPromiseRejectBlock
    ) {
        if pendingPromise != nil {
            rejectPending("sign_in_canceled", "Google sign-in canceled", nil)
        } else {
            pendingTimeoutTask?.cancel()
            pendingTimeoutTask = nil
        }

        GIDSignIn.sharedInstance.signOut()
        resolve(nil)
    }

    // MARK: - Private helpers

    private func resolvePending(_ value: Any?) {
        pendingPromise?.resolve(value)
        clearPending()
    }

    private func rejectPending(_ code: String, _ message: String, _ error: Error?) {
        pendingPromise?.reject(code, message, error)
        clearPending()
    }

    private func clearPending() {
        pendingPromise = nil
        pendingTimeoutTask?.cancel()
        pendingTimeoutTask = nil
    }
}

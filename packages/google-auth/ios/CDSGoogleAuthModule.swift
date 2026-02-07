import Foundation
import GoogleSignIn
@preconcurrency import React
import UIKit

private struct GoogleAuthConfig: Sendable {
    let iosClientId: String
    let webClientId: String
    let scopes: [String]
}

private enum GoogleAuthScopeMode: String {
    case add
    case replace
}

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

        let scopes = normalizeScopes(options["scopes"] as? [String] ?? ["openid", "email", "profile"])
        config = GoogleAuthConfig(iosClientId: iosClientId, webClientId: webClientId, scopes: scopes)
        resolve(nil)
    }

    @objc(signIn:rejecter:)
    func signIn(
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        guard let config else {
            reject("config_error", "Google auth not configured", nil)
            return
        }

        guard let presenter = RCTPresentedViewController() else {
            reject("presentation_error", "Unable to find a presenting view controller", nil)
            return
        }

        startSignIn(
            fallbackScopes: config.scopes,
            resolve: resolve,
            reject: reject
        ) { callback in
            GIDSignIn.sharedInstance.signIn(
                withPresenting: presenter,
                hint: nil,
                additionalScopes: config.scopes,
                completion: callback
            )
        }
    }

    @objc(updateScopes:mode:resolver:rejecter:)
    func updateScopes(
        _ scopes: [String],
        mode: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        guard let config else {
            reject("config_error", "Google auth not configured", nil)
            return
        }

        guard let presenter = RCTPresentedViewController() else {
            reject("presentation_error", "Unable to find a presenting view controller", nil)
            return
        }

        guard let parsedMode = GoogleAuthScopeMode(rawValue: mode.lowercased()) else {
            reject("validation_error", "mode must be 'add' or 'replace'", nil)
            return
        }

        guard let currentUser = GIDSignIn.sharedInstance.currentUser else {
            reject("not_signed_in", "No Google session available", nil)
            return
        }

        let targetScopes = normalizeScopes(scopes)
        let currentScopes = getGrantedScopesInternal()
        let currentSet = Set(currentScopes)
        let targetSet = Set(targetScopes)

        switch parsedMode {
        case .add:
            let scopesToAdd = targetScopes.filter { !currentSet.contains($0) }
            if scopesToAdd.isEmpty {
                reject("no_scope_change_required", "Requested scopes are already granted", nil)
                return
            }

            startSignIn(
                fallbackScopes: mergeScopes(currentScopes, scopesToAdd),
                resolve: resolve,
                reject: reject
            ) { callback in
                currentUser.addScopes(scopesToAdd, presenting: presenter, completion: callback)
            }

        case .replace:
            if targetSet == currentSet {
                reject("no_scope_change_required", "Requested scopes match current granted scopes", nil)
                return
            }

            let hasRemovals = !currentSet.isSubset(of: targetSet)
            let desiredScopes = targetScopes.isEmpty ? config.scopes : targetScopes

            if hasRemovals {
                if !beginPending(resolve: resolve, reject: reject) {
                    return
                }
                GIDSignIn.sharedInstance.disconnect { [weak self] error in
                    guard let self else { return }
                    if let error {
                        self.rejectPending("revoke_failed", (error as NSError).localizedDescription, error)
                        return
                    }

                    self.continueSignIn(
                        fallbackScopes: desiredScopes,
                        start: { callback in
                            GIDSignIn.sharedInstance.signIn(
                                withPresenting: presenter,
                                hint: nil,
                                additionalScopes: desiredScopes,
                                completion: callback
                            )
                        }
                    )
                }
                return
            }

            startSignIn(
                fallbackScopes: desiredScopes,
                resolve: resolve,
                reject: reject
            ) { callback in
                GIDSignIn.sharedInstance.signIn(
                    withPresenting: presenter,
                    hint: nil,
                    additionalScopes: desiredScopes,
                    completion: callback
                )
            }
        }
    }

    @objc(getGrantedScopes:rejecter:)
    func getGrantedScopes(
        resolver resolve: RCTPromiseResolveBlock,
        rejecter _: RCTPromiseRejectBlock
    ) {
        resolve(getGrantedScopesInternal())
    }

    @objc(revokeAccess:rejecter:)
    func revokeAccess(
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        if pendingPromise != nil {
            rejectPending("sign_in_canceled", "Google sign-in canceled", nil)
        } else {
            pendingTimeoutTask?.cancel()
            pendingTimeoutTask = nil
        }

        GIDSignIn.sharedInstance.disconnect { error in
            if let error {
                reject("revoke_failed", (error as NSError).localizedDescription, error)
                return
            }
            resolve(nil)
        }
    }

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

    private func startSignIn(
        fallbackScopes: [String],
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock,
        start: (@escaping (GIDSignInResult?, Error?) -> Void) -> Void
    ) {
        if !beginPending(resolve: resolve, reject: reject) {
            return
        }

        continueSignIn(
            fallbackScopes: fallbackScopes,
            start: start
        )
    }

    private func continueSignIn(
        fallbackScopes: [String],
        start: (@escaping (GIDSignInResult?, Error?) -> Void) -> Void
    ) {
        guard let config else {
            rejectPending("config_error", "Google auth not configured", nil)
            return
        }

        let normalizedFallbackScopes = normalizeScopes(fallbackScopes)

        let configuration = GIDConfiguration(clientID: config.iosClientId, serverClientID: config.webClientId)
        GIDSignIn.sharedInstance.configuration = configuration

        start { [weak self] result, error in
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

            let grantedScopes = self.normalizeScopes(result?.user.grantedScopes ?? normalizedFallbackScopes)
            self.resolvePending(["authCode": authCode, "grantedScopes": grantedScopes])
        }
    }

    private func beginPending(
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) -> Bool {
        if pendingPromise != nil {
            reject("sign_in_in_progress", "Google sign-in already in progress", nil)
            return false
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

        return true
    }

    private func getGrantedScopesInternal() -> [String] {
        normalizeScopes(GIDSignIn.sharedInstance.currentUser?.grantedScopes ?? [])
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

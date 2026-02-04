import Foundation
import GoogleSignIn
@preconcurrency import React
import UIKit

private struct GoogleAuthConfig {
    let iosClientId: String
    let webClientId: String
    let scopes: [String]
}

@objc(CDSGoogleAuth)
final class CDSGoogleAuth: NSObject {
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

        let scopes = options["scopes"] as? [String] ?? ["openid", "email", "profile"]
        config = GoogleAuthConfig(iosClientId: iosClientId, webClientId: webClientId, scopes: scopes)
        resolve(nil)
    }

    @objc(signIn:rejecter:)
    func signIn(
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        if pendingPromise != nil {
            reject("sign_in_in_progress", "Google sign-in already in progress", nil)
            return
        }

        pendingPromise = (resolve: resolve, reject: reject)

        Task { @MainActor [weak self] in
            self?.startSignInOnMain()
        }
    }

    @objc(signOut:rejecter:)
    func signOut(
        resolver resolve: RCTPromiseResolveBlock,
        rejecter _: RCTPromiseRejectBlock
    ) {
        resolve(nil)

        Task { @MainActor [weak self] in
            self?.signOutOnMain()
        }
    }

    @MainActor
    private func startSignInOnMain() {
        guard pendingPromise != nil else {
            return
        }

        guard let config else {
            rejectPending("config_error", "Google auth not configured", nil)
            return
        }

        guard let presenter = RCTPresentedViewController() else {
            rejectPending("presentation_error", "Unable to find a presenting view controller", nil)
            return
        }

        pendingTimeoutTask?.cancel()
        pendingTimeoutTask = Task { @MainActor [weak self] in
            guard let self else { return }
            let nanoseconds = UInt64((self.signInTimeoutSeconds * 1_000_000_000).rounded())
            try? await Task.sleep(nanoseconds: nanoseconds)
            guard !Task.isCancelled else { return }
            self.rejectPending("sign_in_timeout", "Google sign-in timed out", nil)
        }

        let configuration = GIDConfiguration(clientID: config.iosClientId, serverClientID: config.webClientId)
        GIDSignIn.sharedInstance.configuration = configuration

        GIDSignIn.sharedInstance.signIn(
            withPresenting: presenter,
            hint: nil,
            additionalScopes: config.scopes
        ) { [weak self] result, error in
            let authCode = result?.serverAuthCode

            let errorInfo: (domain: String, code: Int, description: String)?
            if let error {
                let nsError = error as NSError
                errorInfo = (domain: nsError.domain, code: nsError.code, description: nsError.localizedDescription)
            } else {
                errorInfo = nil
            }

            Task { @MainActor in
                guard let self else { return }

                if let errorInfo {
                    if errorInfo.domain == self.googleSignInErrorDomain
                        && errorInfo.code == self.googleSignInCanceledErrorCode
                    {
                        self.rejectPending("sign_in_canceled", "Google sign-in canceled", nil)
                        return
                    }

                    let wrapped = NSError(
                        domain: errorInfo.domain,
                        code: errorInfo.code,
                        userInfo: [NSLocalizedDescriptionKey: errorInfo.description]
                    )
                    self.rejectPending("sign_in_failed", errorInfo.description, wrapped)
                    return
                }

                guard let authCode, !authCode.isEmpty else {
                    self.rejectPending("auth_code_failed", "Missing server auth code", nil)
                    return
                }

                self.resolvePending(["authCode": authCode])
            }
        }
    }

    @MainActor
    private func signOutOnMain() {
        if pendingPromise != nil {
            rejectPending("sign_in_canceled", "Google sign-in canceled", nil)
        } else {
            pendingTimeoutTask?.cancel()
            pendingTimeoutTask = nil
        }

        GIDSignIn.sharedInstance.signOut()
    }

    @MainActor
    private func resolvePending(_ value: Any?) {
        pendingPromise?.resolve(value)
        clearPending()
    }

    @MainActor
    private func rejectPending(_ code: String, _ message: String, _ error: Error?) {
        pendingPromise?.reject(code, message, error)
        clearPending()
    }

    @MainActor
    private func clearPending() {
        pendingPromise = nil
        pendingTimeoutTask?.cancel()
        pendingTimeoutTask = nil
    }
}


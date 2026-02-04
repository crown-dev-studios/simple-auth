import Foundation
import React
import UIKit

@objc(CDSGoogleAuth)
class CDSGoogleAuth: NSObject {
    private let client = GoogleAuthClient()
    private var pendingPromise: (resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock)?

    @objc
    static func requiresMainQueueSetup() -> Bool {
        return true
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
        client.configure(
            GoogleAuthConfiguration(
                iosClientId: iosClientId,
                webClientId: webClientId,
                scopes: scopes
            )
        )
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

        guard let presenter = topViewController() else {
            reject("presentation_error", "Unable to find a presenting view controller", nil)
            return
        }

        pendingPromise = (resolve: resolve, reject: reject)
        Task { @MainActor [weak self] in
            guard let self else { return }

            do {
                let authCode = try await self.client.signIn(presentingViewController: presenter)
                self.resolvePending(["authCode": authCode])
            } catch let error as GoogleAuthError {
                switch error {
                    case .configMissing:
                        self.rejectPending("config_error", "Google auth not configured", nil)
                    case .signInInProgress:
                        self.rejectPending("sign_in_in_progress", "Google sign-in already in progress", nil)
                    case .canceled:
                        self.rejectPending("sign_in_canceled", "Google sign-in canceled", nil)
                    case .timeout:
                        self.rejectPending("sign_in_timeout", "Google sign-in timed out", nil)
                    case .missingAuthCode:
                        self.rejectPending("auth_code_failed", "Missing server auth code", nil)
                    case .presentationError:
                        self.rejectPending("presentation_error", "Unable to present Google sign-in UI", nil)
                    case .underlying(let underlyingError):
                        self.rejectPending("sign_in_failed", underlyingError.localizedDescription, underlyingError)
                }
            } catch {
                self.rejectPending("sign_in_failed", error.localizedDescription, error)
            }
        }
    }

    @objc(signOut:rejecter:)
    func signOut(
        resolver resolve: RCTPromiseResolveBlock,
        rejecter reject: RCTPromiseRejectBlock
    ) {
        if pendingPromise != nil {
            rejectPending("sign_in_canceled", "Google sign-in canceled", nil)
        }
        client.signOut()
        resolve(nil)
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
    }

    private func topViewController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes
        let windowScene = scenes.first { $0.activationState == .foregroundActive } as? UIWindowScene
        let keyWindow = windowScene?.windows.first { $0.isKeyWindow }
        guard let rootViewController = keyWindow?.rootViewController else { return nil }
        return findTopViewController(rootViewController)
    }

    private func findTopViewController(_ root: UIViewController) -> UIViewController {
        if let presented = root.presentedViewController {
            return findTopViewController(presented)
        }

        if let nav = root as? UINavigationController, let visible = nav.visibleViewController {
            return findTopViewController(visible)
        }

        if let tab = root as? UITabBarController, let selected = tab.selectedViewController {
            return findTopViewController(selected)
        }

        return root
    }
}

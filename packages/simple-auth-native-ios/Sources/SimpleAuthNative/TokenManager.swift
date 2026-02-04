import Foundation

public struct TokenManagerOptions: Sendable {
    public let refreshLeewaySeconds: Int

    public init(refreshLeewaySeconds: Int = 30) {
        self.refreshLeewaySeconds = refreshLeewaySeconds
    }
}

public actor TokenManager {
    private let store: TokenStore
    private let api: SimpleAuthApiClient
    private let options: TokenManagerOptions

    private var refreshTask: Task<SimpleAuthTokens, Error>?
    private let maxRefreshTokenLength = 4096

    public init(store: TokenStore, api: SimpleAuthApiClient, options: TokenManagerOptions = .init()) {
        self.store = store
        self.api = api
        self.options = options
    }

    private func isValidRefreshToken(_ token: String) -> Bool {
        if token.isEmpty { return false }
        if token.count > maxRefreshTokenLength { return false }
        if token.rangeOfCharacter(from: .whitespacesAndNewlines) != nil { return false }
        return true
    }

    public func getTokens() throws -> SimpleAuthTokens? {
        try store.loadTokens()
    }

    public func setTokens(_ tokens: SimpleAuthTokens) throws {
        try store.saveTokens(tokens)
    }

    public func setTokens(
        accessToken: String,
        refreshToken: String,
        expiresInSeconds: Int
    ) throws {
        let expiresAt = Date().addingTimeInterval(TimeInterval(expiresInSeconds))
        try setTokens(SimpleAuthTokens(accessToken: accessToken, refreshToken: refreshToken, expiresAt: expiresAt))
    }

    public func clearTokens() throws {
        try store.clearTokens()
    }

    public func getAccessToken() async throws -> String? {
        guard let tokens = try store.loadTokens() else {
            return nil
        }

        let leeway = TimeInterval(options.refreshLeewaySeconds)
        let shouldRefresh = tokens.expiresAt.timeIntervalSinceNow <= leeway
        if !shouldRefresh {
            return tokens.accessToken
        }

        let refreshed = try await refreshTokens()
        return refreshed.accessToken
    }

    public func refreshTokens() async throws -> SimpleAuthTokens {
        if let refreshTask {
            return try await refreshTask.value
        }

        let task = Task<SimpleAuthTokens, Error> {
            try await self.refreshTokensOnce()
        }
        refreshTask = task
        return try await task.value
    }

    private func refreshTokensOnce() async throws -> SimpleAuthTokens {
        defer { refreshTask = nil }

        guard let current = try store.loadTokens() else {
            throw SimpleAuthApiClientError.invalidResponse
        }
        guard isValidRefreshToken(current.refreshToken) else {
            try? store.clearTokens()
            throw SimpleAuthApiClientError.invalidResponse
        }

        do {
            let refreshed = try await api.refresh(refreshToken: current.refreshToken)
            let expiresAt = Date().addingTimeInterval(TimeInterval(refreshed.expiresIn))
            let updated = SimpleAuthTokens(
                accessToken: refreshed.accessToken,
                refreshToken: refreshed.refreshToken,
                expiresAt: expiresAt
            )
            try store.saveTokens(updated)
            return updated
        } catch {
            try? store.clearTokens()
            throw error
        }
    }
}

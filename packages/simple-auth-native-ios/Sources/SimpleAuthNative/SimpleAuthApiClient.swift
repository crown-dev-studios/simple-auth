import Foundation

public struct SimpleAuthApiClientConfig: Sendable {
    public let baseUrl: URL
    public let refreshPath: String
    public let googleOAuthPath: String

    public init(
        baseUrl: URL,
        refreshPath: String = "/auth/refresh",
        googleOAuthPath: String = "/auth/oauth/google"
    ) {
        self.baseUrl = baseUrl
        self.refreshPath = refreshPath
        self.googleOAuthPath = googleOAuthPath
    }
}

public struct AuthTokensResponse: Decodable, Sendable {
    public let accessToken: String
    public let refreshToken: String
    public let expiresIn: Int
}

public enum SimpleAuthApiClientError: Error {
    case invalidResponse
    case httpError(statusCode: Int)
}

public actor SimpleAuthApiClient {
    private let config: SimpleAuthApiClientConfig
    private let session: URLSession
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    public init(config: SimpleAuthApiClientConfig, session: URLSession = .shared) {
        self.config = config
        self.session = session
    }

    public func refresh(refreshToken: String) async throws -> AuthTokensResponse {
        struct RefreshRequest: Encodable {
            let refreshToken: String
        }

        let url = URL(string: config.refreshPath, relativeTo: config.baseUrl)?.absoluteURL
        guard let url else {
            throw SimpleAuthApiClientError.invalidResponse
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(RefreshRequest(refreshToken: refreshToken))

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw SimpleAuthApiClientError.invalidResponse
        }

        guard (200..<300).contains(http.statusCode) else {
            // Never include tokens in errors. Response body may still contain sensitive data.
            _ = data
            throw SimpleAuthApiClientError.httpError(statusCode: http.statusCode)
        }

        return try decoder.decode(AuthTokensResponse.self, from: data)
    }

    public func exchangeGoogleAuthCode(authCode: String) async throws -> OAuthResponse {
        struct GoogleOAuthRequest: Encodable {
            let authCode: String
        }

        let url = URL(string: config.googleOAuthPath, relativeTo: config.baseUrl)?.absoluteURL
        guard let url else {
            throw SimpleAuthApiClientError.invalidResponse
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(GoogleOAuthRequest(authCode: authCode))

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw SimpleAuthApiClientError.invalidResponse
        }

        guard (200..<300).contains(http.statusCode) else {
            _ = data
            throw SimpleAuthApiClientError.httpError(statusCode: http.statusCode)
        }

        return try decoder.decode(OAuthResponse.self, from: data)
    }
}

import Foundation

public enum OAuthFlowType: String, Decodable, Sendable {
    case new
    case returning
}

public struct SimpleAuthUser: Decodable, Sendable {
    public let id: String
    public let email: String

    public init(id: String, email: String) {
        self.id = id
        self.email = email
    }
}

public struct OAuthAuthenticatedResponse: Decodable, Sendable {
    public let status: String
    public let user: SimpleAuthUser
    public let tokens: AuthTokensResponse
}

public struct OAuthNeedsPhoneResponse: Decodable, Sendable {
    public let status: String
    public let sessionToken: String
    public let email: String
    public let flowType: OAuthFlowType
    public let maskedPhone: String?
}

public struct OAuthNeedsLinkingResponse: Decodable, Sendable {
    public let status: String
    public let sessionToken: String
    public let maskedEmail: String
}

public enum OAuthResponse: Decodable, Sendable {
    case authenticated(OAuthAuthenticatedResponse)
    case needsPhone(OAuthNeedsPhoneResponse)
    case needsLinking(OAuthNeedsLinkingResponse)

    public var status: String {
        switch self {
            case .authenticated(let response): response.status
            case .needsPhone(let response): response.status
            case .needsLinking(let response): response.status
        }
    }

    private enum CodingKeys: String, CodingKey {
        case status
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let status = try container.decode(String.self, forKey: .status)

        switch status {
            case "authenticated":
                self = .authenticated(try OAuthAuthenticatedResponse(from: decoder))
            case "needs_phone":
                self = .needsPhone(try OAuthNeedsPhoneResponse(from: decoder))
            case "needs_linking":
                self = .needsLinking(try OAuthNeedsLinkingResponse(from: decoder))
            default:
                throw SimpleAuthApiClientError.invalidResponse
        }
    }
}


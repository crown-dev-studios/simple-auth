import Foundation

public protocol TokenStore {
    func loadTokens() throws -> SimpleAuthTokens?
    func saveTokens(_ tokens: SimpleAuthTokens) throws
    func clearTokens() throws
}


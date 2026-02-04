import Foundation
import Security

public enum KeychainTokenStoreError: Error {
    case unexpectedStatus(OSStatus)
    case invalidData
}

public final class KeychainTokenStore: TokenStore {
    private let service: String
    private let account: String
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    public init(service: String = "simple-auth", account: String = "tokens") {
        self.service = service
        self.account = account
    }

    public func loadTokens() throws -> SimpleAuthTokens? {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]

        #if os(iOS)
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        #endif

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)

        if status == errSecItemNotFound {
            return nil
        }

        guard status == errSecSuccess else {
            throw KeychainTokenStoreError.unexpectedStatus(status)
        }

        guard let data = item as? Data else {
            throw KeychainTokenStoreError.invalidData
        }

        do {
            return try decoder.decode(SimpleAuthTokens.self, from: data)
        } catch {
            throw KeychainTokenStoreError.invalidData
        }
    }

    public func saveTokens(_ tokens: SimpleAuthTokens) throws {
        let data = try encoder.encode(tokens)

        let baseQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]

        let attributes: [String: Any] = [
            kSecValueData as String: data,
        ]

        var addQuery = baseQuery
        addQuery[kSecValueData as String] = data

        #if os(iOS)
        addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        #endif

        let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
        if addStatus == errSecSuccess {
            return
        }

        if addStatus != errSecDuplicateItem {
            throw KeychainTokenStoreError.unexpectedStatus(addStatus)
        }

        let updateStatus = SecItemUpdate(baseQuery as CFDictionary, attributes as CFDictionary)
        guard updateStatus == errSecSuccess else {
            throw KeychainTokenStoreError.unexpectedStatus(updateStatus)
        }
    }

    public func clearTokens() throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]

        let status = SecItemDelete(query as CFDictionary)
        if status == errSecItemNotFound {
            return
        }

        guard status == errSecSuccess else {
            throw KeychainTokenStoreError.unexpectedStatus(status)
        }
    }
}


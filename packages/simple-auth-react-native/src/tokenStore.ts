import * as SecureStore from 'expo-secure-store'
import { StoredTokensSchema, type StoredTokens } from './types'

export interface TokenStore {
  getTokens(): Promise<StoredTokens | null>
  setTokens(tokens: StoredTokens): Promise<void>
  clearTokens(): Promise<void>
}

export interface SecureStoreAdapter {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  deleteItem(key: string): Promise<void>
}

const expoSecureStoreAdapter: SecureStoreAdapter = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  deleteItem: (key) => SecureStore.deleteItemAsync(key),
}

export const createSecureStoreTokenStore = (
  key: string,
  adapter: SecureStoreAdapter = expoSecureStoreAdapter
): TokenStore => ({
  async getTokens(): Promise<StoredTokens | null> {
    const raw = await adapter.getItem(key)
    if (!raw) return null
    try {
      return StoredTokensSchema.parse(JSON.parse(raw))
    } catch {
      return null
    }
  },

  async setTokens(tokens: StoredTokens): Promise<void> {
    await adapter.setItem(key, JSON.stringify(StoredTokensSchema.parse(tokens)))
  },

  async clearTokens(): Promise<void> {
    await adapter.deleteItem(key)
  },
})


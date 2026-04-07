/**
 * ChatLab Web UI - Environment Detection and Configuration
 * Detects runtime environment and configures API client accordingly
 * Provides composables for Vue components to conditionally render UI
 */

// ==================== Environment Detection ====================

/**
 * Detect if running in Electron environment
 */
export function isElectronEnvironment(): boolean {
  // Check for Electron-specific globals
  if (typeof window !== 'undefined') {
    const w = window as any
    return !!(
      w.electron ||
      w.chatApi ||
      w.aiApi ||
      (w.process && w.process.versions && w.process.versions.electron)
    )
  }
  return false
}

/**
 * Detect if running in browser environment
 */
export function isBrowserEnvironment(): boolean {
  return typeof window !== 'undefined' && !isElectronEnvironment()
}

/**
 * Get API server URL from environment
 */
export function getApiServerUrl(): string {
  // In Electron, API runs on localhost:9871
  if (isElectronEnvironment()) {
    return 'http://127.0.0.1:9871'
  }

  // In browser, use current host
  if (typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.host}`
  }

  return 'http://localhost:9871'
}

/**
 * Get environment information
 */
export function getEnvironmentInfo(): {
  isElectron: boolean
  isBrowser: boolean
  apiUrl: string
  userAgent: string
  isDev: boolean
} {
  const isElectron = isElectronEnvironment()

  return {
    isElectron,
    isBrowser: !isElectron,
    apiUrl: getApiServerUrl(),
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    isDev: typeof process !== 'undefined' && process.env?.NODE_ENV === 'development',
  }
}

// ==================== Vue Composables ====================

import { computed, Ref, ref } from 'vue'
import { getApiClient } from '@/api/client'

/**
 * Composable for environment-aware API operations
 * Usage in Vue components:
 *   const { isElectron, apiClient, baseUrl } = useApiEnvironment()
 */
export function useApiEnvironment() {
  const envInfo = getEnvironmentInfo()
  const apiClient = getApiClient()

  console.log('[Web UI] Environment detected:', {
    isElectron: envInfo.isElectron,
    isBrowser: envInfo.isBrowser,
    apiUrl: envInfo.apiUrl,
  })

  return {
    // Environment flags
    isElectron: computed(() => envInfo.isElectron),
    isBrowser: computed(() => envInfo.isBrowser),
    isDev: computed(() => envInfo.isDev),

    // API client
    apiClient,

    // Configuration
    baseUrl: envInfo.apiUrl,
    userAgent: envInfo.userAgent,

    // Helper to reload environment
    reloadEnvironment: () => {
      window.location.reload()
    },
  }
}

/**
 * Composable for authentication state
 * Usage in Vue components:
 *   const { isAuthenticated, user, login, logout } = useAuth()
 */
export function useAuth() {
  const apiClient = getApiClient()
  const isAuthenticated = ref(false)
  const user = ref<{ id: string; username: string } | null>(null)
  const token = ref<string | null>(null)
  const error = ref<string | null>(null)
  const loading = ref(false)

  // Check if already authenticated
  const checkAuth = async () => {
    try {
      const isAuth = await apiClient.isAuthenticated()
      isAuthenticated.value = isAuth

      const storedToken = localStorage.getItem('chatlab_token')
      if (storedToken && isAuth) {
        token.value = storedToken
      }

      console.log('[Auth] Authentication check:', { isAuth, hasToken: !!storedToken })
    } catch (err) {
      console.error('[Auth] Authentication check failed:', err)
    }
  }

  // Login
  const login = async (username: string, password: string) => {
    loading.value = true
    error.value = null

    try {
      console.log('[Auth] Logging in as:', username)

      const result = await apiClient.login({ username, password })

      if (result.success) {
        const token = result.token
        const userId = result.userId || 'unknown'

        isAuthenticated.value = true
        user.value = { id: userId, username }

        if (token) {
          apiClient.setToken(token, result.expiresAt || 0)
        }

        console.log('[Auth] Login successful for:', username)
        return { success: true }
      } else {
        error.value = result.error || 'Login failed'
        console.warn('[Auth] Login failed:', error.value)
        return { success: false, error: error.value }
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Login error'
      console.error('[Auth] Login error:', err)
      return { success: false, error: error.value }
    } finally {
      loading.value = false
    }
  }

  // Register
  const register = async (username: string, password: string) => {
    loading.value = true
    error.value = null

    try {
      console.log('[Auth] Registering user:', username)

      // For now, return a registration action
      // In real implementation, call API endpoint
      const result = { success: true, userId: 'new-user-id' }

      if (result.success) {
        console.log('[Auth] Registration successful for:', username)
        return { success: true }
      } else {
        error.value = 'Registration failed'
        return { success: false, error: error.value }
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Registration error'
      console.error('[Auth] Registration error:', err)
      return { success: false, error: error.value }
    } finally {
      loading.value = false
    }
  }

  // Logout
  const logout = async () => {
    loading.value = true

    try {
      console.log('[Auth] Logging out')

      await apiClient.logout()

      isAuthenticated.value = false
      user.value = null
      token.value = null
      error.value = null
      apiClient.clearToken()

      localStorage.removeItem('chatlab_token')
      localStorage.removeItem('chatlab_token_expires_at')

      console.log('[Auth] Logout successful')
      return { success: true }
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Logout error'
      console.error('[Auth] Logout error:', err)
      return { success: false, error: error.value }
    } finally {
      loading.value = false
    }
  }

  return {
    // State
    isAuthenticated: computed(() => isAuthenticated.value),
    user: computed(() => user.value),
    token: computed(() => token.value),
    error: computed(() => error.value),
    loading: computed(() => loading.value),

    // Methods
    checkAuth,
    login,
    register,
    logout,
  }
}

/**
 * Composable for API operations
 * Usage in Vue components:
 *   const { data, loading, error, fetchSessions } = useApi()
 */
export function useApi() {
  const apiClient = getApiClient()
  const loading = ref(false)
  const error = ref<string | null>(null)

  const executeApiCall = async <T,>(
    operation: () => Promise<T>,
    operationName: string
  ): Promise<{ success: boolean; data?: T; error?: string }> => {
    loading.value = true
    error.value = null

    try {
      console.log(`[API] Executing ${operationName}`)
      const result = await operation()
      console.log(`[API] ${operationName} success`)
      return { success: true, data: result }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      error.value = errorMsg
      console.error(`[API] ${operationName} error:`, err)
      return { success: false, error: errorMsg }
    } finally {
      loading.value = false
    }
  }

  // Session operations
  const listSessions = async () => {
    return executeApiCall(
      () => apiClient.listSessions(),
      'listSessions'
    )
  }

  const getSession = async (sessionId: string) => {
    return executeApiCall(
      () => apiClient.getSession(sessionId),
      `getSession(${sessionId})`
    )
  }

  // Conversation operations
  const createConversation = async (sessionId: string, title?: string) => {
    return executeApiCall(
      () =>
        apiClient.createConversation({
          sessionId,
          title,
          assistantId: 'default',
        }),
      `createConversation(${sessionId})`
    )
  }

  const listConversations = async (sessionId: string) => {
    return executeApiCall(
      () => apiClient.listConversations(sessionId),
      `listConversations(${sessionId})`
    )
  }

  const deleteConversation = async (conversationId: string) => {
    return executeApiCall(
      () => apiClient.deleteConversation({ conversationId }),
      `deleteConversation(${conversationId})`
    )
  }

  // Message operations
  const sendMessage = async (conversationId: string, content: string) => {
    return executeApiCall(
      () => apiClient.sendMessage({ conversationId, content }),
      `sendMessage(${conversationId})`
    )
  }

  const getMessages = async (conversationId: string, limit = 20, offset = 0) => {
    return executeApiCall(
      () => apiClient.getMessages({ conversationId, limit, offset }),
      `getMessages(${conversationId})`
    )
  }

  return {
    // State
    loading: computed(() => loading.value),
    error: computed(() => error.value),

    // Session methods
    listSessions,
    getSession,

    // Conversation methods
    createConversation,
    listConversations,
    deleteConversation,

    // Message methods
    sendMessage,
    getMessages,
  }
}

/**
 * Composable for responsive layout based on environment
 * Usage in Vue components:
 *   const { showNativeMenu, useDesktopLayout } = useLayout()
 */
export function useLayout() {
  const envInfo = getEnvironmentInfo()

  // In Electron, show native menu; in browser, show web menu
  const showNativeMenu = computed(() => envInfo.isElectron)
  const showWebMenu = computed(() => !envInfo.isElectron)

  // Desktop layout for Electron, responsive for browser
  const useDesktopLayout = computed(() => envInfo.isElectron)

  // Show/hide certain features based on environment
  const showServerSettings = computed(() => envInfo.isElectron)
  const showLoginForm = computed(() => !envInfo.isElectron)

  console.log('[Layout] Configuration:', {
    showNativeMenu: showNativeMenu.value,
    showWebMenu: showWebMenu.value,
    useDesktopLayout: useDesktopLayout.value,
  })

  return {
    // Layout flags
    showNativeMenu,
    showWebMenu,
    useDesktopLayout,

    // Feature flags
    showServerSettings,
    showLoginForm,

    // Environment
    isElectron: computed(() => envInfo.isElectron),
    isBrowser: computed(() => envInfo.isBrowser),
  }
}

// ==================== Global Configuration ====================

/**
 * Initialize Web UI environment
 * Call this in main.ts or App.vue beforeMount
 */
export function initializeWebUI() {
  const envInfo = getEnvironmentInfo()

  console.log('╔════════════════════════════════════════════════════════╗')
  console.log('║          ChatLab Web UI - Initialization              ║')
  console.log('╚════════════════════════════════════════════════════════╝')

  console.log('[Web UI] Environment Information:')
  console.log(`  • Runtime: ${envInfo.isElectron ? 'Electron (Desktop)' : 'Browser (Web)'}`)
  console.log(`  • API Server: ${envInfo.apiUrl}`)
  console.log(`  • Mode: ${envInfo.isDev ? 'Development' : 'Production'}`)
  console.log(`  • User Agent: ${envInfo.userAgent.slice(0, 80)}...`)

  // Log API client initialization
  const apiClient = getApiClient()
  console.log('[Web UI] API Client:')
  console.log(`  • Type: ${apiClient.isElectron() ? 'Electron IPC' : 'HTTP'}`)
  console.log(`  • Status: Ready`)

  // Restore auth token if available
  if (!envInfo.isElectron) {
    const token = localStorage.getItem('chatlab_token')
    const expiresAt = localStorage.getItem('chatlab_token_expires_at')
    if (token && expiresAt) {
      const expiresAtNum = parseInt(expiresAt, 10)
      if (expiresAtNum > Date.now()) {
        apiClient.setToken(token, expiresAtNum)
        console.log('[Web UI] Restored authentication token from storage')
      } else {
        console.log('[Web UI] Stored token has expired')
        localStorage.removeItem('chatlab_token')
        localStorage.removeItem('chatlab_token_expires_at')
      }
    }
  }

  console.log('[Web UI] Initialization complete\n')

  return envInfo
}

/**
 * Export types for use in components
 */
export type { EnvironmentInfo } from './types'

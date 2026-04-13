/**
 * HTTP-based API Client Implementation
 * Used for accessing the Web UI from a browser via HTTP
 */

import type {
  IApiClient,
  AuthCredentials,
  AuthResponse,
  LogoutResponse,
  ListSessionsResponse,
  GetSessionResponse,
  DeleteSessionResponse,
  CreateConversationRequest,
  CreateConversationResponse,
  ListConversationsResponse,
  DeleteConversationRequest,
  DeleteConversationResponse,
  SendMessageRequest,
  SendMessageResponse,
  GetMessagesRequest,
  GetMessagesResponse,
} from './types'

/**
 * HttpClient - HTTP-based API client for Web UI
 * Makes requests to Fastify API server with Bearer token authentication
 */
export class HttpClient implements IApiClient {
  private baseURL: string
  private token: string | null = null
  private tokenExpiresAt: number = 0

  constructor(baseURL: string = '') {
    // If baseURL is empty, derive from current location
    this.baseURL = baseURL || `${window.location.protocol}//${window.location.host}`
  }

  /**
   * Make HTTP request with authentication
   */
  private async request<T>(method: string, path: string, body?: Record<string, any>): Promise<T | null> {
    const url = `${this.baseURL}/api/webui${path}`
    console.log(`[HttpClient] ${method} ${url}`, body ? { hasBody: true } : '')

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    // Add authorization token if available
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`
    }

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      })

      console.log(`[HttpClient] Response: ${response.status} ${response.statusText}`)

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '')
        console.error(`[HttpClient] Error response:`, errorBody)
        if (response.status === 401) {
          // Token expired or invalid
          this.clearToken()
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()
      console.log(`[HttpClient] Response data:`, JSON.stringify(data).slice(0, 500))
      return data
    } catch (error) {
      console.error(`[HttpClient] Request failed:`, error)
      throw error
    }
  }

  /**
   * Login with credentials
   */
  async login(credentials: AuthCredentials): Promise<AuthResponse> {
    try {
      // The API wraps response in { success, data: { token, ... }, meta: {...} }
      const response = await this.request<any>('POST', '/auth/login', {
        username: credentials.username,
        password: credentials.password,
      })

      if (!response) {
        return { success: false, error: 'Unknown error' }
      }

      // Extract token from data wrapper (successResponse nests payload under .data)
      const token = response.data?.token ?? response.token
      const expiresAt = response.data?.expiresAt ?? response.expiresAt
      const userId = response.data?.userId ?? response.userId

      if (response.success && token && expiresAt) {
        this.setToken(token, expiresAt)
      }

      return {
        success: response.success,
        token,
        expiresAt,
        userId,
        error: response.error?.message ?? response.error,
      }
    } catch (error) {
      return {
        success: false,
        error: `Login failed: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  /**
   * Logout
   */
  async logout(): Promise<LogoutResponse> {
    try {
      const response = await this.request<LogoutResponse>('POST', '/auth/logout')
      this.clearToken()
      return response || { success: true }
    } catch (error) {
      console.error('[HttpClient] Logout error:', error)
      this.clearToken()
      return { success: true }
    }
  }

  /**
   * Check if authenticated
   */
  async isAuthenticated(): Promise<boolean> {
    if (!this.token) {
      return false
    }

    // Check if token has expired
    if (this.tokenExpiresAt && Date.now() > this.tokenExpiresAt) {
      this.clearToken()
      return false
    }

    return true
  }

  /**
   * Get current authentication token
   */
  async getToken(): Promise<string | null> {
    return this.token
  }

  /**
   * Set token and expiration
   */
  setToken(token: string, expiresAt: number): void {
    this.token = token
    this.tokenExpiresAt = expiresAt
    // Use sessionStorage (tab-scoped) instead of localStorage to limit XSS token theft window
    sessionStorage.setItem('chatlab_token', token)
    sessionStorage.setItem('chatlab_token_expires_at', String(expiresAt))
  }

  /**
   * Clear token
   */
  clearToken(): void {
    this.token = null
    this.tokenExpiresAt = 0
    sessionStorage.removeItem('chatlab_token')
    sessionStorage.removeItem('chatlab_token_expires_at')
  }

  /**
   * Restore token from sessionStorage
   */
  restoreToken(): void {
    const token = sessionStorage.getItem('chatlab_token')
    const expiresAt = sessionStorage.getItem('chatlab_token_expires_at')

    if (token && expiresAt) {
      const expiresAtNum = parseInt(expiresAt, 10)
      if (Date.now() < expiresAtNum) {
        this.token = token
        this.tokenExpiresAt = expiresAtNum
      } else {
        this.clearToken()
      }
    }
  }

  /**
   * List all analysis sessions
   */
  async listSessions(): Promise<ListSessionsResponse> {
    try {
      const response = await this.request<ListSessionsResponse>('GET', '/sessions')
      return response || { success: false, error: 'Unknown error' }
    } catch (error) {
      return {
        success: false,
        error: `Failed to list sessions: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  /**
   * Get a specific analysis session
   */
  async getSession(sessionId: string): Promise<GetSessionResponse> {
    try {
      const response = await this.request<GetSessionResponse>('GET', `/sessions/${sessionId}`)
      return response || { success: false, error: 'Unknown error' }
    } catch (error) {
      return {
        success: false,
        error: `Failed to get session: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  /**
   * Delete an analysis session
   */
  async deleteSession(sessionId: string): Promise<DeleteSessionResponse> {
    try {
      const response = await this.request<DeleteSessionResponse>('DELETE', `/sessions/${sessionId}`)
      return response || { success: false, error: 'Unknown error' }
    } catch (error) {
      return {
        success: false,
        error: `Failed to delete session: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  /**
   * Create a new AI conversation
   */
  async createConversation(request: CreateConversationRequest): Promise<CreateConversationResponse> {
    try {
      const response = await this.request<CreateConversationResponse>('POST', '/conversations', {
        sessionId: request.sessionId,
        title: request.title,
        assistantId: request.assistantId,
      })

      return response || { success: false, error: 'Unknown error' }
    } catch (error) {
      return {
        success: false,
        error: `Failed to create conversation: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  /**
   * List conversations for a session
   */
  async listConversations(sessionId: string): Promise<ListConversationsResponse> {
    try {
      const response = await this.request<ListConversationsResponse>('GET', `/sessions/${sessionId}/conversations`)

      return response || { success: false, error: 'Unknown error' }
    } catch (error) {
      return {
        success: false,
        error: `Failed to list conversations: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  /**
   * Delete a conversation
   */
  async deleteConversation(request: DeleteConversationRequest): Promise<DeleteConversationResponse> {
    try {
      const response = await this.request<DeleteConversationResponse>(
        'DELETE',
        `/conversations/${request.conversationId}`
      )

      return response || { success: false, error: 'Unknown error' }
    } catch (error) {
      return {
        success: false,
        error: `Failed to delete conversation: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  /**
   * Send a message in a conversation
   */
  async sendMessage(request: SendMessageRequest): Promise<SendMessageResponse> {
    try {
      const response = await this.request<SendMessageResponse>(
        'POST',
        `/conversations/${request.conversationId}/messages`,
        { content: request.content }
      )

      return response || { success: false, error: 'Unknown error' }
    } catch (error) {
      return {
        success: false,
        error: `Failed to send message: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  /**
   * Get messages from a conversation
   */
  async getMessages(request: GetMessagesRequest): Promise<GetMessagesResponse> {
    try {
      const params = new URLSearchParams()
      if (request.limit) params.append('limit', String(request.limit))
      if (request.offset) params.append('offset', String(request.offset))

      const query = params.toString() ? `?${params.toString()}` : ''
      const response = await this.request<GetMessagesResponse>(
        'GET',
        `/conversations/${request.conversationId}/messages${query}`
      )

      return response || { success: false, error: 'Unknown error' }
    } catch (error) {
      return {
        success: false,
        error: `Failed to get messages: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  /**
   * Check if running in Electron
   */
  isElectron(): boolean {
    return false
  }

  // ==================== Admin API ====================

  async adminGetServerStatus(): Promise<any> {
    return this.request<any>('GET', '/admin/server/status')
  }

  async adminEnableServer(): Promise<any> {
    return this.request<any>('POST', '/admin/server/enable')
  }

  async adminDisableServer(): Promise<any> {
    return this.request<any>('POST', '/admin/server/disable')
  }

  async adminChangePort(port: number): Promise<any> {
    return this.request<any>('POST', '/admin/server/port', { port })
  }

  async adminListUsers(): Promise<any> {
    return this.request<any>('GET', '/admin/users')
  }

  async adminDisableUser(username: string): Promise<any> {
    return this.request<any>('POST', '/admin/users/disable', { username })
  }

  async adminEnableUser(username: string): Promise<any> {
    return this.request<any>('POST', '/admin/users/enable', { username })
  }

  async adminDeleteUser(username: string): Promise<any> {
    return this.request<any>('POST', '/admin/users/delete', { username })
  }

  async adminResetPassword(username: string, newPassword: string): Promise<any> {
    return this.request<any>('POST', '/admin/users/reset-password', { username, newPassword })
  }

  async adminGetStatistics(): Promise<any> {
    return this.request<any>('GET', '/admin/statistics')
  }
}

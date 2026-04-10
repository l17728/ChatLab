/**
 * ChatLab Web UI Routes
 * Handles authentication, conversation management, and AI messaging
 * Comprehensive logging for all operations
 * Updated to use database-backed user management
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import * as worker from '../../worker/workerManager'
import { successResponse, errorResponse, ApiError, ApiErrorCode, conversationNotFound, sessionNotFound, invalidFormat, serverError } from '../errors'
import { handleLogin, handleLogout, handleRegister, handleChangePassword, verifyToken } from '../auth-db'
import { getActiveConfig, buildPiModel } from '../../ai/llm/index'
import { streamSimple, completeSimple, type Message as PiMessage, type TextContent as PiTextContent } from '@mariozechner/pi-ai'
import * as webuiDb from '../../database/global/webui'

function toPiMessages(msgs: Array<{ role: string; content: string }>): PiMessage[] {
  return msgs.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
    timestamp: Date.now(),
  })) as unknown as PiMessage[]
}

// ==================== Types ====================

interface CreateConversationRequest {
  sessionId: string
  title?: string
  assistantId?: string
}

interface SendMessageRequest {
  content: string
}

interface GetMessagesQuery {
  limit?: string
  offset?: string
}

// Alias DB types for use in handlers
type Conversation = webuiDb.WebUIConversation
type Message = webuiDb.WebUIMessage

// ==================== Utility Functions ====================

/**
 * Generate unique ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Log operation with context
 */
function logOperation(
  operation: string,
  context: string,
  details?: Record<string, any>
): void {
  const timestamp = new Date().toISOString()
  console.log(`[WebUI API] [${timestamp}] ${operation} - ${context}`, details || '')
}

/**
 * Verify request authentication using JWT middleware
 */
async function verifyRequest(request: FastifyRequest, _reply: FastifyReply): Promise<{ valid: boolean; userId?: string; username?: string }> {
  try {
    const authHeader = request.headers.authorization

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('[WebUI Auth] Missing or invalid Authorization header')
      return { valid: false }
    }

    const token = authHeader.slice(7)
    const result = verifyToken(token)

    if (!result.valid) {
      console.log('[WebUI Auth] Token verification failed')
      return { valid: false }
    }

    console.log('[WebUI Auth] Token verified successfully for user:', result.username)
    return {
      valid: true,
      userId: result.userId,
      username: result.username,
    }
  } catch (error) {
    console.error('[WebUI Auth] Request verification error:', error)
    return { valid: false }
  }
}

// ==================== Route Handlers ====================

/**
 * POST /api/webui/auth/login
 * User login endpoint
 */
async function handleAuthLogin(
  request: FastifyRequest<{ Body: { username: string; password: string } }>,
  reply: FastifyReply
): Promise<any> {
  try {
    const { username, password } = request.body

    logOperation('LOGIN_ATTEMPT', `User: ${username}`)

    if (!username || !password) {
      logOperation('LOGIN_FAILED', 'Missing credentials', { username })
      const err = invalidFormat('Username and password are required')
      return reply.code(err.statusCode).send(errorResponse(err))
    }

    const result = await handleLogin(username, password)

    if (result.success) {
      logOperation('LOGIN_SUCCESS', `User: ${username}`, {
        userId: result.userId,
        token: result.token?.slice(0, 20) + '...',
        expiresAt: new Date(result.expiresAt || 0).toISOString(),
      })
      return successResponse({
        token: result.token,
        userId: result.userId,
        username: result.username,
        expiresAt: result.expiresAt,
      })
    } else {
      logOperation('LOGIN_FAILED', `User: ${username}`, { error: result.error })
      const err = new ApiError(ApiErrorCode.LOGIN_FAILED, result.error || 'Login failed')
      return reply.code(401).send(errorResponse(err))
    }
  } catch (error) {
    console.error('[WebUI API] Login error:', error)
    const err = serverError(`Login error: ${error instanceof Error ? error.message : String(error)}`)
    return reply.code(err.statusCode).send(errorResponse(err))
  }
}

/**
 * POST /api/webui/auth/register
 * User registration endpoint
 */
async function handleAuthRegister(
  request: FastifyRequest<{ Body: { username: string; password: string } }>,
  reply: FastifyReply
): Promise<any> {
  try {
    const { username, password } = request.body

    logOperation('REGISTER_ATTEMPT', `User: ${username}`)

    if (!username || !password) {
      logOperation('REGISTER_FAILED', 'Missing credentials', { username })
      const err = invalidFormat('Username and password are required')
      return reply.code(err.statusCode).send(errorResponse(err))
    }

    const result = await handleRegister(username, password)

    if (result.success) {
      logOperation('REGISTER_SUCCESS', `User: ${username}`, {
        userId: result.userId,
      })
      return successResponse({
        userId: result.userId,
        username: username,
      })
    } else {
      logOperation('REGISTER_FAILED', `User: ${username}`, { error: result.error })
      const err = new ApiError(ApiErrorCode.INVALID_FORMAT, result.error || 'Registration failed')
      return reply.code(400).send(errorResponse(err))
    }
  } catch (error) {
    console.error('[WebUI API] Registration error:', error)
    const err = serverError(`Registration error: ${error instanceof Error ? error.message : String(error)}`)
    return reply.code(err.statusCode).send(errorResponse(err))
  }
}

/**
 * POST /api/webui/auth/logout
 * User logout endpoint
 */
async function handleAuthLogout(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<any> {
  try {
    const verification = await verifyRequest(request, reply)
    if (!verification.valid) {
      const err = new ApiError(ApiErrorCode.UNAUTHORIZED, 'Invalid or missing token')
      return reply.code(401).send(errorResponse(err))
    }

    const authHeader = request.headers.authorization
    const token = authHeader!.slice(7)
    handleLogout(token)

    logOperation('LOGOUT', `User: ${verification.username}`)

    return successResponse({ success: true })
  } catch (error) {
    console.error('[WebUI API] Logout error:', error)
    const err = serverError(`Logout error: ${error instanceof Error ? error.message : String(error)}`)
    return reply.code(err.statusCode).send(errorResponse(err))
  }
}

/**
 * POST /api/webui/auth/change-password
 * Change user password
 */
async function handleChangePasswordEndpoint(
  request: FastifyRequest<{ Body: { oldPassword: string; newPassword: string } }>,
  reply: FastifyReply
): Promise<any> {
  try {
    const verification = await verifyRequest(request, reply)
    if (!verification.valid) {
      const err = new ApiError(ApiErrorCode.UNAUTHORIZED, 'Invalid or missing token')
      return reply.code(401).send(errorResponse(err))
    }

    const { oldPassword, newPassword } = request.body

    logOperation('CHANGE_PASSWORD', `User: ${verification.username}`)

    if (!oldPassword || !newPassword) {
      const err = invalidFormat('Old password and new password are required')
      return reply.code(err.statusCode).send(errorResponse(err))
    }

    const result = handleChangePassword(verification.username!, oldPassword, newPassword)

    if (result.success) {
      logOperation('CHANGE_PASSWORD_SUCCESS', `User: ${verification.username}`)
      return successResponse({ success: true })
    } else {
      logOperation('CHANGE_PASSWORD_FAILED', `User: ${verification.username}`, { error: result.error })
      const err = new ApiError(ApiErrorCode.INVALID_FORMAT, result.error || 'Password change failed')
      return reply.code(400).send(errorResponse(err))
    }
  } catch (error) {
    console.error('[WebUI API] Password change error:', error)
    const err = serverError(`Password change error: ${error instanceof Error ? error.message : String(error)}`)
    return reply.code(err.statusCode).send(errorResponse(err))
  }
}

/**
 * GET /api/webui/sessions
 * List all analysis sessions
 */
async function listSessionsHandler(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<any> {
  try {
    // Verify authentication
    const verification = await verifyRequest(request, reply)
    if (!verification.valid) {
      console.log('[WebUI Auth] Unauthorized access to list sessions')
      const err = new ApiError(ApiErrorCode.UNAUTHORIZED, 'Invalid or missing token')
      return reply.code(401).send(errorResponse(err))
    }

    logOperation('LIST_SESSIONS', 'Retrieving all sessions', {
      userId: verification.userId,
      ip: request.ip,
      userAgent: request.headers['user-agent']?.slice(0, 80),
    })
    const sessions = await worker.getAllSessions()
    logOperation('LIST_SESSIONS_SUCCESS', `Found ${sessions.length} sessions`, {
      userId: verification.userId,
      sessionIds: sessions.map(s => s.id),
      sessionNames: sessions.map(s => (s as any).name),
    })
    const response = successResponse(sessions)
    logOperation('LIST_SESSIONS_RESPONSE', `Sending response`, {
      userId: verification.userId,
      responseShape: { success: response.success, dataLength: Array.isArray(response.data) ? response.data.length : typeof response.data },
    })
    return response
  } catch (error) {
    console.error('[WebUI API] Error listing sessions:', error)
    const err = serverError(`Failed to list sessions: ${error instanceof Error ? error.message : String(error)}`)
    return reply.code(err.statusCode).send(errorResponse(err))
  }
}

/**
 * GET /api/webui/sessions/:sessionId
 * Get single session
 */
async function getSessionHandler(
  request: FastifyRequest<{ Params: { sessionId: string } }>,
  reply: FastifyReply
): Promise<any> {
  try {
    const verification = await verifyRequest(request, reply)
    if (!verification.valid) {
      const err = new ApiError(ApiErrorCode.UNAUTHORIZED, 'Invalid or missing token')
      return reply.code(401).send(errorResponse(err))
    }

    const { sessionId } = request.params

    logOperation('GET_SESSION', `Session: ${sessionId}`)

    const session = await worker.getSession(sessionId)
    if (!session) {
      logOperation('GET_SESSION_NOT_FOUND', `Session: ${sessionId}`)
      const err = sessionNotFound(sessionId)
      return reply.code(err.statusCode).send(errorResponse(err))
    }

    logOperation('GET_SESSION_SUCCESS', `Session: ${sessionId}`, {
      name: session.name,
      messageCount: (session as any).messageCount,
    })

    return successResponse(session)
  } catch (error) {
    console.error('[WebUI API] Error getting session:', error)
    const err = serverError(`Failed to get session: ${error instanceof Error ? error.message : String(error)}`)
    return reply.code(err.statusCode).send(errorResponse(err))
  }
}

/**
 * POST /api/webui/conversations
 * Create new conversation
 */
async function createConversationHandler(
  request: FastifyRequest<{ Body: CreateConversationRequest }>,
  reply: FastifyReply
): Promise<any> {
  try {
    const verification = await verifyRequest(request, reply)
    if (!verification.valid) {
      const err = new ApiError(ApiErrorCode.UNAUTHORIZED, 'Invalid or missing token')
      return reply.code(401).send(errorResponse(err))
    }

    const { sessionId, title, assistantId } = request.body

    logOperation('CREATE_CONVERSATION', `Session: ${sessionId}`, { title, assistantId })

    // Verify session exists
    const session = await worker.getSession(sessionId)
    if (!session) {
      logOperation('CREATE_CONVERSATION_SESSION_NOT_FOUND', `Session: ${sessionId}`)
      const err = sessionNotFound(sessionId)
      return reply.code(err.statusCode).send(errorResponse(err))
    }

    const conversationId = generateId()
    const now = Date.now()
    const conversation: Conversation = {
      id: conversationId,
      sessionId,
      title: title || null,
      assistantId: assistantId || 'default',
      createdAt: now,
      updatedAt: now,
    }

    webuiDb.createConversation(conversation)

    logOperation('CREATE_CONVERSATION_SUCCESS', `Conversation: ${conversationId}`, {
      sessionId,
      title,
    })

    return successResponse(conversation, { conversationId })
  } catch (error) {
    console.error('[WebUI API] Error creating conversation:', error)
    const err = serverError(`Failed to create conversation: ${error instanceof Error ? error.message : String(error)}`)
    return reply.code(err.statusCode).send(errorResponse(err))
  }
}

/**
 * GET /api/webui/sessions/:sessionId/conversations
 * List conversations for session
 */
async function listConversationsHandler(
  request: FastifyRequest<{ Params: { sessionId: string } }>,
  reply: FastifyReply
): Promise<any> {
  try {
    const verification = await verifyRequest(request, reply)
    if (!verification.valid) {
      const err = new ApiError(ApiErrorCode.UNAUTHORIZED, 'Invalid or missing token')
      return reply.code(401).send(errorResponse(err))
    }

    const { sessionId } = request.params

    logOperation('LIST_CONVERSATIONS', `Session: ${sessionId}`)

    // Verify session exists
    const session = await worker.getSession(sessionId)
    if (!session) {
      logOperation('LIST_CONVERSATIONS_SESSION_NOT_FOUND', `Session: ${sessionId}`)
      const err = sessionNotFound(sessionId)
      return reply.code(err.statusCode).send(errorResponse(err))
    }

    const sessionConversations = webuiDb.listConversationsBySession(sessionId)

    logOperation('LIST_CONVERSATIONS_SUCCESS', `Session: ${sessionId}`, {
      count: sessionConversations.length,
    })

    return successResponse(sessionConversations)
  } catch (error) {
    console.error('[WebUI API] Error listing conversations:', error)
    const err = serverError(`Failed to list conversations: ${error instanceof Error ? error.message : String(error)}`)
    return reply.code(err.statusCode).send(errorResponse(err))
  }
}

/**
 * DELETE /api/webui/conversations/:conversationId
 * Delete conversation
 */
async function deleteConversationHandler(
  request: FastifyRequest<{ Params: { conversationId: string } }>,
  reply: FastifyReply
): Promise<any> {
  try {
    const verification = await verifyRequest(request, reply)
    if (!verification.valid) {
      const err = new ApiError(ApiErrorCode.UNAUTHORIZED, 'Invalid or missing token')
      return reply.code(401).send(errorResponse(err))
    }

    const { conversationId } = request.params

    logOperation('DELETE_CONVERSATION', `Conversation: ${conversationId}`)

    if (!webuiDb.getConversation(conversationId)) {
      logOperation('DELETE_CONVERSATION_NOT_FOUND', `Conversation: ${conversationId}`)
      const err = conversationNotFound(conversationId)
      return reply.code(err.statusCode).send(errorResponse(err))
    }

    webuiDb.deleteConversation(conversationId)

    logOperation('DELETE_CONVERSATION_SUCCESS', `Conversation: ${conversationId}`)

    return successResponse({ success: true })
  } catch (error) {
    console.error('[WebUI API] Error deleting conversation:', error)
    const err = serverError(`Failed to delete conversation: ${error instanceof Error ? error.message : String(error)}`)
    return reply.code(err.statusCode).send(errorResponse(err))
  }
}

/**
 * POST /api/webui/conversations/:conversationId/messages
 * Send message in conversation
 */
async function sendMessageHandler(
  request: FastifyRequest<{
    Params: { conversationId: string }
    Body: SendMessageRequest
  }>,
  reply: FastifyReply
): Promise<any> {
  try {
    const verification = await verifyRequest(request, reply)
    if (!verification.valid) {
      const err = new ApiError(ApiErrorCode.UNAUTHORIZED, 'Invalid or missing token')
      return reply.code(401).send(errorResponse(err))
    }

    const { conversationId } = request.params
    const { content } = request.body

    logOperation('SEND_MESSAGE', `Conversation: ${conversationId}`, {
      contentLength: content?.length,
    })

    if (!webuiDb.getConversation(conversationId)) {
      logOperation('SEND_MESSAGE_CONVERSATION_NOT_FOUND', `Conversation: ${conversationId}`)
      const err = conversationNotFound(conversationId)
      return reply.code(err.statusCode).send(errorResponse(err))
    }

    if (!content || content.trim().length === 0) {
      logOperation('SEND_MESSAGE_EMPTY_CONTENT', `Conversation: ${conversationId}`)
      const err = invalidFormat('Message content cannot be empty')
      return reply.code(err.statusCode).send(errorResponse(err))
    }

    const messageId = generateId()
    const userMessage: Message = {
      id: messageId,
      conversationId,
      role: 'user',
      content: content.trim(),
      timestamp: Date.now(),
    }

    webuiDb.insertMessage(userMessage)
    webuiDb.updateConversationTs(conversationId, userMessage.timestamp)

    // Call real AI engine
    const activeConfig = getActiveConfig()
    if (activeConfig) {
      try {
        const piModel = buildPiModel(activeConfig)
        const historyMsgs = toPiMessages(
          webuiDb.getLastMessages(conversationId, 20).map((m) => ({ role: m.role, content: m.content }))
        )
        const result = await completeSimple(
          piModel,
          { messages: historyMsgs },
          { apiKey: activeConfig.apiKey }
        )
        const aiContent = result.content
          .filter((item): item is PiTextContent => item.type === 'text')
          .map((item) => item.text)
          .join('')
        const assistantMessage: Message = {
          id: generateId(),
          conversationId,
          role: 'assistant',
          content: aiContent,
          timestamp: Date.now(),
        }
        webuiDb.insertMessage(assistantMessage)
        webuiDb.updateConversationTs(conversationId, assistantMessage.timestamp)
        logOperation('SEND_MESSAGE_AI_RESPONSE', `Conversation: ${conversationId}`, {
          aiContentLength: aiContent.length,
        })
      } catch (aiError) {
        console.error('[WebUI API] AI call failed:', aiError)
        // Non-fatal: user message was stored, AI response missing
      }
    }

    logOperation('SEND_MESSAGE_SUCCESS', `Conversation: ${conversationId}`, {
      messageId,
      contentLength: content.length,
    })

    return successResponse(userMessage)
  } catch (error) {
    console.error('[WebUI API] Error sending message:', error)
    const err = serverError(`Failed to send message: ${error instanceof Error ? error.message : String(error)}`)
    return reply.code(err.statusCode).send(errorResponse(err))
  }
}

/**
 * GET /api/webui/conversations/:conversationId/stream
 * Stream AI response via SSE for a pending user message
 */
async function streamMessageHandler(
  request: FastifyRequest<{
    Params: { conversationId: string }
    Querystring: { content: string }
  }>,
  reply: FastifyReply
): Promise<any> {
  const verification = await verifyRequest(request, reply)
  if (!verification.valid) {
    reply.code(401).send({ error: 'Unauthorized' })
    return
  }

  const { conversationId } = request.params
  const content = (request.query as any).content as string | undefined

  if (!webuiDb.getConversation(conversationId)) {
    reply.code(404).send({ error: 'Conversation not found' })
    return
  }

  if (!content || content.trim().length === 0) {
    reply.code(400).send({ error: 'content query param required' })
    return
  }

  // Store user message
  const userMsgId = generateId()
  const userMessage: Message = {
    id: userMsgId,
    conversationId,
    role: 'user',
    content: content.trim(),
    timestamp: Date.now(),
  }
  webuiDb.insertMessage(userMessage)
  webuiDb.updateConversationTs(conversationId, userMessage.timestamp)

  // SSE headers
  reply.raw.setHeader('Content-Type', 'text/event-stream')
  reply.raw.setHeader('Cache-Control', 'no-cache')
  reply.raw.setHeader('Connection', 'keep-alive')
  reply.raw.flushHeaders()

  const sendEvent = (event: string, data: object) => {
    reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  // Emit user message first
  sendEvent('user_message', userMessage)

  const activeConfig = getActiveConfig()
  if (!activeConfig) {
    sendEvent('error', { message: 'No active AI configuration' })
    reply.raw.end()
    return
  }

  const assistantMsgId = generateId()
  let fullContent = ''

  try {
    const piModel = buildPiModel(activeConfig)
    const historyMsgs = toPiMessages(
      webuiDb.getLastMessages(conversationId, 20).map((m) => ({ role: m.role, content: m.content }))
    )

    const eventStream = streamSimple(
      piModel,
      { messages: historyMsgs },
      { apiKey: activeConfig.apiKey }
    )

    for await (const event of eventStream) {
      if (event.type === 'text_delta') {
        fullContent += event.delta
        sendEvent('content', { type: 'content', text: event.delta })
      }
    }
  } catch (err) {
    console.error('[WebUI API] SSE stream error:', err)
    sendEvent('error', { message: err instanceof Error ? err.message : String(err) })
    reply.raw.end()
    return
  }

  // Store assistant message
  const assistantMessage: Message = {
    id: assistantMsgId,
    conversationId,
    role: 'assistant',
    content: fullContent,
    timestamp: Date.now(),
  }
  webuiDb.insertMessage(assistantMessage)
  webuiDb.updateConversationTs(conversationId, assistantMessage.timestamp)

  sendEvent('done', { type: 'done', messageId: assistantMsgId })
  reply.raw.end()
}

/**
 * GET /api/webui/conversations/:conversationId/messages
 * Get messages from conversation (paginated)
 */
async function getMessagesHandler(
  request: FastifyRequest<{
    Params: { conversationId: string }
    Querystring: GetMessagesQuery
  }>,
  reply: FastifyReply
): Promise<any> {
  try {
    const verification = await verifyRequest(request, reply)
    if (!verification.valid) {
      const err = new ApiError(ApiErrorCode.UNAUTHORIZED, 'Invalid or missing token')
      return reply.code(401).send(errorResponse(err))
    }

    const { conversationId } = request.params
    const limit = Math.min(100, Math.max(1, parseInt(request.query.limit || '20', 10) || 20))
    const offset = Math.max(0, parseInt(request.query.offset || '0', 10) || 0)

    logOperation('GET_MESSAGES', `Conversation: ${conversationId}`, { limit, offset })

    if (!webuiDb.getConversation(conversationId)) {
      logOperation('GET_MESSAGES_CONVERSATION_NOT_FOUND', `Conversation: ${conversationId}`)
      const err = conversationNotFound(conversationId)
      return reply.code(err.statusCode).send(errorResponse(err))
    }

    const paginatedMessages = webuiDb.getMessages(conversationId, limit, offset)
    const total = paginatedMessages.length + offset // approximate

    logOperation('GET_MESSAGES_SUCCESS', `Conversation: ${conversationId}`, {
      total,
      returned: paginatedMessages.length,
      offset,
      limit,
    })

    return successResponse({
      messages: paginatedMessages,
      total,
      offset,
      limit,
    })
  } catch (error) {
    console.error('[WebUI API] Error getting messages:', error)
    const err = serverError(`Failed to get messages: ${error instanceof Error ? error.message : String(error)}`)
    return reply.code(err.statusCode).send(errorResponse(err))
  }
}

// ==================== Route Registration ====================

export function registerWebUIRoutes(server: FastifyInstance): void {
  console.log('[WebUI API] Registering WebUI routes...')

  // ==================== Authentication Routes ====================

  server.post<{ Body: { username: string; password: string } }>(
    '/api/webui/auth/login',
    { logLevel: 'warn' },
    handleAuthLogin
  )

  server.post<{ Body: { username: string; password: string } }>(
    '/api/webui/auth/register',
    { logLevel: 'warn' },
    handleAuthRegister
  )

  server.post('/api/webui/auth/logout', { logLevel: 'warn' }, handleAuthLogout)

  server.post<{ Body: { oldPassword: string; newPassword: string } }>(
    '/api/webui/auth/change-password',
    { logLevel: 'warn' },
    handleChangePasswordEndpoint
  )

  // ==================== Session Routes ====================

  server.get('/api/webui/sessions', { logLevel: 'warn' }, listSessionsHandler)

  server.get<{ Params: { sessionId: string } }>(
    '/api/webui/sessions/:sessionId',
    { logLevel: 'warn' },
    getSessionHandler
  )

  // ==================== Conversation Routes ====================

  server.post<{ Body: CreateConversationRequest }>(
    '/api/webui/conversations',
    { logLevel: 'warn' },
    createConversationHandler
  )

  server.get<{ Params: { sessionId: string } }>(
    '/api/webui/sessions/:sessionId/conversations',
    { logLevel: 'warn' },
    listConversationsHandler
  )

  server.delete<{ Params: { conversationId: string } }>(
    '/api/webui/conversations/:conversationId',
    { logLevel: 'warn' },
    deleteConversationHandler
  )

  // ==================== Message Routes ====================

  server.post<{
    Params: { conversationId: string }
    Body: SendMessageRequest
  }>(
    '/api/webui/conversations/:conversationId/messages',
    { logLevel: 'warn' },
    sendMessageHandler
  )

  server.get<{
    Params: { conversationId: string }
    Querystring: { content: string }
  }>(
    '/api/webui/conversations/:conversationId/stream',
    { logLevel: 'warn' },
    streamMessageHandler
  )

  server.get<{
    Params: { conversationId: string }
    Querystring: GetMessagesQuery
  }>(
    '/api/webui/conversations/:conversationId/messages',
    { logLevel: 'warn' },
    getMessagesHandler
  )

  console.log('[WebUI API] WebUI routes registered successfully')
}

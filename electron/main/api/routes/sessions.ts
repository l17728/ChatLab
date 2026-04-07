/**
 * ChatLab API — Session and export routes
 */

import type { FastifyInstance } from 'fastify'
import * as worker from '../../worker/workerManager'
import * as assistantManager from '../../ai/assistant'
import { successResponse, sessionNotFound, exportTooLarge, sqlExecutionError, ApiError, errorResponse } from '../errors'

const EXPORT_MESSAGE_LIMIT = 100_000

async function ensureSession(sessionId: string) {
  const session = await worker.getSession(sessionId)
  if (!session) throw sessionNotFound(sessionId)
  return session
}

export function registerSessionRoutes(server: FastifyInstance): void {
  // GET /api/v1/sessions — List all sessions
  server.get('/api/v1/sessions', async () => {
    const sessions = await worker.getAllSessions()
    return successResponse(sessions)
  })

  // GET /api/v1/sessions/:id — Single session detail
  server.get<{ Params: { id: string } }>('/api/v1/sessions/:id', async (request) => {
    const session = await ensureSession(request.params.id)
    return successResponse(session)
  })

  // GET /api/v1/sessions/:id/messages — Query messages (paginated)
  server.get<{
    Params: { id: string }
    Querystring: {
      page?: string
      limit?: string
      startTime?: string
      endTime?: string
      keyword?: string
      senderId?: string
      type?: string
    }
  }>('/api/v1/sessions/:id/messages', async (request) => {
    const { id } = request.params
    await ensureSession(id)

    const page = Math.max(1, parseInt(request.query.page || '1', 10) || 1)
    const limit = Math.min(1000, Math.max(1, parseInt(request.query.limit || '100', 10) || 100))
    const offset = (page - 1) * limit

    const { startTime, endTime, keyword, senderId } = request.query

    const filter: any = {}
    if (startTime) filter.startTs = parseInt(startTime, 10)
    if (endTime) filter.endTs = parseInt(endTime, 10)
    const hasFilter = filter.startTs || filter.endTs

    const keywords = keyword ? [keyword] : []
    const senderIdNum = senderId ? parseInt(senderId, 10) : undefined

    const result = await worker.searchMessages(id, keywords, hasFilter ? filter : undefined, limit, offset, senderIdNum)

    return successResponse({
      messages: result.messages,
      total: result.total,
      page,
      limit,
      totalPages: Math.ceil(result.total / limit),
    })
  })

  // GET /api/v1/sessions/:id/members — Member list
  server.get<{ Params: { id: string } }>('/api/v1/sessions/:id/members', async (request) => {
    await ensureSession(request.params.id)
    const members = await worker.getMembers(request.params.id)
    return successResponse(members)
  })

  // GET /api/v1/sessions/:id/stats/overview — Overview statistics
  server.get<{ Params: { id: string } }>('/api/v1/sessions/:id/stats/overview', async (request) => {
    const { id } = request.params
    const session = await ensureSession(id)

    const [timeRange, memberActivity, typeDistribution] = await Promise.all([
      worker.getTimeRange(id),
      worker.getMemberActivity(id),
      worker.getMessageTypeDistribution(id),
    ])

    const typeMap: Record<string, number> = {}
    for (const item of typeDistribution) {
      typeMap[String(item.type)] = item.count
    }

    const topMembers = memberActivity.slice(0, 10).map((m: any) => ({
      platformId: m.platformId,
      name: m.name,
      messageCount: m.messageCount,
      percentage: m.percentage,
    }))

    return successResponse({
      messageCount: session.messageCount,
      memberCount: session.memberCount,
      timeRange: timeRange || { start: 0, end: 0 },
      messageTypeDistribution: typeMap,
      topMembers,
    })
  })

  // POST /api/v1/sessions/:id/sql — Execute SQL (read-only)
  // Supports optional params array for parameterized queries (pluginQuery compatibility)
  server.post<{ Params: { id: string }; Body: { sql: string; params?: any[] } }>('/api/v1/sessions/:id/sql', async (request, reply) => {
    const { id } = request.params
    await ensureSession(id)

    const { sql, params } = request.body || {}
    if (!sql || typeof sql !== 'string') {
      const err = sqlExecutionError('Missing sql parameter')
      return reply.code(err.statusCode).send(errorResponse(err))
    }

    try {
      // pluginQuery 始终返回行数组（无论是否有参数），与 Worker IPC 保持一致
      const safeParams = params && Array.isArray(params) ? params : []
      const result = await worker.pluginQuery(id, sql, safeParams)
      return successResponse(result)
    } catch (err: any) {
      const message = err.message || 'SQL execution error'
      if (message.includes('SELECT') || message.includes('只读') || message.includes('readonly')) {
        const apiErr = new ApiError('SQL_READONLY_VIOLATION' as any, message)
        apiErr.statusCode = 400
        return reply.code(400).send(errorResponse(apiErr))
      }
      const apiErr = sqlExecutionError(message)
      return reply.code(apiErr.statusCode).send(errorResponse(apiErr))
    }
  })

  // GET /api/v1/sessions/:id/export — Export ChatLab Format JSON
  server.get<{ Params: { id: string } }>('/api/v1/sessions/:id/export', async (request, reply) => {
    const { id } = request.params
    const session = await ensureSession(id)

    if (session.messageCount > EXPORT_MESSAGE_LIMIT) {
      const err = exportTooLarge(session.messageCount, EXPORT_MESSAGE_LIMIT)
      return reply.code(err.statusCode).send(errorResponse(err))
    }

    const [members, messagesResult] = await Promise.all([
      worker.getMembers(id),
      worker.searchMessages(id, [], undefined, EXPORT_MESSAGE_LIMIT, 0),
    ])

    const chatLabFormat = {
      chatlab: {
        version: '0.0.2',
        exportedAt: Math.floor(Date.now() / 1000),
        generator: 'ChatLab API',
      },
      meta: {
        name: session.name,
        platform: session.platform,
        type: session.type,
        groupId: session.groupId || undefined,
      },
      members: members.map((m: any) => ({
        platformId: m.platformId,
        accountName: m.accountName || m.platformId,
        groupNickname: m.groupNickname || undefined,
        aliases: Array.isArray(m.aliases) && m.aliases.length > 0 ? m.aliases : undefined,
      })),
      messages: messagesResult.messages.map((msg: any) => ({
        sender: msg.senderPlatformId,
        accountName: msg.senderName || undefined,
        timestamp: msg.timestamp,
        type: msg.type,
        content: msg.content || null,
      })),
    }

    return successResponse(chatLabFormat)
  })

  // GET /api/v1/sessions/:id/stats/member-activity — Member activity stats
  server.get<{ Params: { id: string }; Querystring: { startTime?: string; endTime?: string } }>(
    '/api/v1/sessions/:id/stats/member-activity',
    async (request) => {
      console.log('[Session API] member-activity route hit for session:', request.params.id)
      const { id } = request.params
      await ensureSession(id)
      const filter: any = {}
      if (request.query.startTime) filter.startTs = parseInt(request.query.startTime, 10)
      if (request.query.endTime) filter.endTs = parseInt(request.query.endTime, 10)
      const data = await worker.getMemberActivity(id, Object.keys(filter).length > 0 ? filter : undefined)
      return successResponse(data)
    }
  )

  // GET /api/v1/sessions/:id/stats/hourly-activity — Hourly activity stats
  server.get<{ Params: { id: string }; Querystring: { startTime?: string; endTime?: string } }>(
    '/api/v1/sessions/:id/stats/hourly-activity',
    async (request) => {
      const { id } = request.params
      await ensureSession(id)
      const filter: any = {}
      if (request.query.startTime) filter.startTs = parseInt(request.query.startTime, 10)
      if (request.query.endTime) filter.endTs = parseInt(request.query.endTime, 10)
      const data = await worker.getHourlyActivity(id, Object.keys(filter).length > 0 ? filter : undefined)
      return successResponse(data)
    }
  )

  // GET /api/v1/sessions/:id/stats/daily-activity — Daily activity stats
  server.get<{ Params: { id: string }; Querystring: { startTime?: string; endTime?: string } }>(
    '/api/v1/sessions/:id/stats/daily-activity',
    async (request) => {
      const { id } = request.params
      await ensureSession(id)
      const filter: any = {}
      if (request.query.startTime) filter.startTs = parseInt(request.query.startTime, 10)
      if (request.query.endTime) filter.endTs = parseInt(request.query.endTime, 10)
      const data = await worker.getDailyActivity(id, Object.keys(filter).length > 0 ? filter : undefined)
      return successResponse(data)
    }
  )

  // GET /api/v1/sessions/:id/stats/message-type-distribution — Message type distribution
  server.get<{ Params: { id: string }; Querystring: { startTime?: string; endTime?: string } }>(
    '/api/v1/sessions/:id/stats/message-type-distribution',
    async (request) => {
      const { id } = request.params
      await ensureSession(id)
      const filter: any = {}
      if (request.query.startTime) filter.startTs = parseInt(request.query.startTime, 10)
      if (request.query.endTime) filter.endTs = parseInt(request.query.endTime, 10)
      const data = await worker.getMessageTypeDistribution(id, Object.keys(filter).length > 0 ? filter : undefined)
      return successResponse(data)
    }
  )

  // GET /api/v1/sessions/:id/stats/time-range — Full time range of messages
  server.get<{ Params: { id: string } }>('/api/v1/sessions/:id/stats/time-range', async (request) => {
    const { id } = request.params
    await ensureSession(id)
    const range = await worker.getTimeRange(id)
    return successResponse(range || { start: 0, end: 0 })
  })

  // GET /api/v1/sessions/:id/stats/available-years — Years with message activity
  server.get<{ Params: { id: string } }>('/api/v1/sessions/:id/stats/available-years', async (request) => {
    const { id } = request.params
    await ensureSession(id)
    const years = await worker.getAvailableYears(id)
    return successResponse(years)
  })

  // GET /api/v1/sessions/:id/stats/weekday-activity — Weekday distribution
  server.get<{ Params: { id: string }; Querystring: { startTime?: string; endTime?: string } }>(
    '/api/v1/sessions/:id/stats/weekday-activity',
    async (request) => {
      const { id } = request.params
      await ensureSession(id)
      const filter: any = {}
      if (request.query.startTime) filter.startTs = parseInt(request.query.startTime, 10)
      if (request.query.endTime) filter.endTs = parseInt(request.query.endTime, 10)
      const data = await worker.getWeekdayActivity(id, Object.keys(filter).length > 0 ? filter : undefined)
      return successResponse(data)
    }
  )

  // GET /api/v1/sessions/:id/stats/catchphrase — Catchphrase analysis
  server.get<{ Params: { id: string }; Querystring: { startTime?: string; endTime?: string } }>(
    '/api/v1/sessions/:id/stats/catchphrase',
    async (request) => {
      const { id } = request.params
      await ensureSession(id)
      const filter: any = {}
      if (request.query.startTime) filter.startTs = parseInt(request.query.startTime, 10)
      if (request.query.endTime) filter.endTs = parseInt(request.query.endTime, 10)
      const data = await worker.getCatchphraseAnalysis(id, Object.keys(filter).length > 0 ? filter : undefined)
      return successResponse(data)
    }
  )

  // GET /api/v1/sessions/:id/stats/laugh — Laugh/keyword analysis
  server.get<{ Params: { id: string }; Querystring: { startTime?: string; endTime?: string; keywords?: string } }>(
    '/api/v1/sessions/:id/stats/laugh',
    async (request) => {
      const { id } = request.params
      await ensureSession(id)
      const filter: any = {}
      if (request.query.startTime) filter.startTs = parseInt(request.query.startTime, 10)
      if (request.query.endTime) filter.endTs = parseInt(request.query.endTime, 10)
      const keywords = request.query.keywords ? request.query.keywords.split(',') : undefined
      const data = await worker.getLaughAnalysis(id, Object.keys(filter).length > 0 ? filter : undefined, keywords)
      return successResponse(data)
    }
  )

  // GET /api/v1/sessions/:id/stats/mention — Mention/interaction graph
  server.get<{ Params: { id: string }; Querystring: { startTime?: string; endTime?: string } }>(
    '/api/v1/sessions/:id/stats/mention',
    async (request) => {
      const { id } = request.params
      await ensureSession(id)
      const filter: any = {}
      if (request.query.startTime) filter.startTs = parseInt(request.query.startTime, 10)
      if (request.query.endTime) filter.endTs = parseInt(request.query.endTime, 10)
      const data = await worker.getMentionAnalysis(id, Object.keys(filter).length > 0 ? filter : undefined)
      return successResponse(data)
    }
  )

  // GET /api/v1/sessions/:id/members/paginated — Paginated member list
  server.get<{
    Params: { id: string }
    Querystring: { page?: string; pageSize?: string; search?: string; sortBy?: string; sortOrder?: string }
  }>('/api/v1/sessions/:id/members/paginated', async (request) => {
    const { id } = request.params
    await ensureSession(id)
    const params: any = {}
    if (request.query.page) params.page = parseInt(request.query.page, 10)
    if (request.query.pageSize) params.pageSize = parseInt(request.query.pageSize, 10)
    if (request.query.search) params.search = request.query.search
    if (request.query.sortBy) params.sortBy = request.query.sortBy
    if (request.query.sortOrder) params.sortOrder = request.query.sortOrder
    const data = await worker.getMembersPaginated(id, params)
    return successResponse(data)
  })

  // GET /api/v1/sessions/:id/members/:memberId/name-history — Member name history
  server.get<{ Params: { id: string; memberId: string } }>(
    '/api/v1/sessions/:id/members/:memberId/name-history',
    async (request) => {
      const { id, memberId } = request.params
      await ensureSession(id)
      const data = await worker.getMemberNameHistory(id, parseInt(memberId, 10))
      return successResponse(data)
    }
  )

  // GET /api/v1/nlp/pos-tags — POS tag definitions (not session-specific)
  server.get('/api/v1/nlp/pos-tags', async () => {
    const data = await worker.query('getPosTags', {})
    return successResponse(data)
  })

  // GET /api/v1/sessions/:id/messages/before/:messageId — Messages before a given message
  server.get<{
    Params: { id: string; messageId: string }
    Querystring: { limit?: string; startTime?: string; endTime?: string; senderId?: string; keywords?: string }
  }>('/api/v1/sessions/:id/messages/before/:messageId', async (request) => {
    const { id, messageId } = request.params
    await ensureSession(id)
    const q = request.query
    const filter: any = {}
    if (q.startTime) filter.startTs = parseInt(q.startTime, 10)
    if (q.endTime) filter.endTs = parseInt(q.endTime, 10)
    const limit = q.limit ? parseInt(q.limit, 10) : 50
    const senderId = q.senderId ? parseInt(q.senderId, 10) : undefined
    const keywords = q.keywords ? q.keywords.split(',').filter(Boolean) : undefined
    const data = await worker.getMessagesBefore(
      id,
      parseInt(messageId, 10),
      limit,
      Object.keys(filter).length > 0 ? filter : undefined,
      senderId,
      keywords
    )
    return successResponse(data)
  })

  // GET /api/v1/sessions/:id/messages/after/:messageId — Messages after a given message
  server.get<{
    Params: { id: string; messageId: string }
    Querystring: { limit?: string; startTime?: string; endTime?: string; senderId?: string; keywords?: string }
  }>('/api/v1/sessions/:id/messages/after/:messageId', async (request) => {
    const { id, messageId } = request.params
    await ensureSession(id)
    const q = request.query
    const filter: any = {}
    if (q.startTime) filter.startTs = parseInt(q.startTime, 10)
    if (q.endTime) filter.endTs = parseInt(q.endTime, 10)
    const limit = q.limit ? parseInt(q.limit, 10) : 50
    const senderId = q.senderId ? parseInt(q.senderId, 10) : undefined
    const keywords = q.keywords ? q.keywords.split(',').filter(Boolean) : undefined
    const data = await worker.getMessagesAfter(
      id,
      parseInt(messageId, 10),
      limit,
      Object.keys(filter).length > 0 ? filter : undefined,
      senderId,
      keywords
    )
    return successResponse(data)
  })

  // GET /api/v1/sessions/:id/messages/context/:messageId — Context around a message
  server.get<{
    Params: { id: string; messageId: string }
    Querystring: { contextSize?: string }
  }>('/api/v1/sessions/:id/messages/context/:messageId', async (request) => {
    const { id, messageId } = request.params
    await ensureSession(id)
    const contextSize = request.query.contextSize ? parseInt(request.query.contextSize, 10) : undefined
    const data = await worker.getMessageContext(id, parseInt(messageId, 10), contextSize)
    return successResponse(data)
  })

  // GET /api/v1/sessions/:id/messages/recent — All recent messages
  server.get<{
    Params: { id: string }
    Querystring: { limit?: string; startTime?: string; endTime?: string; senderId?: string }
  }>('/api/v1/sessions/:id/messages/recent', async (request) => {
    const { id } = request.params
    await ensureSession(id)
    const q = request.query
    const filter: any = {}
    if (q.startTime) filter.startTs = parseInt(q.startTime, 10)
    if (q.endTime) filter.endTs = parseInt(q.endTime, 10)
    const limit = q.limit ? parseInt(q.limit, 10) : 100
    const data = await worker.getAllRecentMessages(
      id,
      Object.keys(filter).length > 0 ? filter : undefined,
      limit
    )
    return successResponse(data)
  })

  // GET /api/v1/sessions/:id/nlp/word-frequency — Word frequency for wordcloud
  server.get<{
    Params: { id: string }
    Querystring: {
      locale?: string
      startTime?: string
      endTime?: string
      memberId?: string
      topN?: string
      minCount?: string
      posFilterMode?: string
      customPosTags?: string
      enableStopwords?: string
    }
  }>('/api/v1/sessions/:id/nlp/word-frequency', async (request) => {
    const { id } = request.params
    await ensureSession(id)
    const q = request.query
    const timeFilter: any = {}
    if (q.startTime) timeFilter.startTs = parseInt(q.startTime, 10)
    if (q.endTime) timeFilter.endTs = parseInt(q.endTime, 10)
    const params: any = {
      sessionId: id,
      locale: q.locale || 'zh-CN',
      topN: q.topN ? parseInt(q.topN, 10) : 150,
      minCount: q.minCount ? parseInt(q.minCount, 10) : 2,
      posFilterMode: q.posFilterMode || 'meaningful',
      enableStopwords: q.enableStopwords !== 'false',
    }
    if (Object.keys(timeFilter).length > 0) params.timeFilter = timeFilter
    if (q.memberId) params.memberId = parseInt(q.memberId, 10)
    if (q.customPosTags) params.customPosTags = q.customPosTags.split(',').filter(Boolean)
    const data = await worker.query('getWordFrequency', params)
    return successResponse(data)
  })

  // GET /api/v1/sessions/:id/sql/execute — Execute SQL (read-only, GET version for SQLLab)
  server.get<{ Params: { id: string }; Querystring: { sql?: string } }>(
    '/api/v1/sessions/:id/sql/execute',
    async (request, reply) => {
      const { id } = request.params
      await ensureSession(id)
      const sql = request.query.sql
      if (!sql) {
        const err = sqlExecutionError('Missing sql parameter')
        return reply.code(err.statusCode).send(errorResponse(err))
      }
      try {
        const result = await worker.executeRawSQL(id, sql)
        return successResponse(result)
      } catch (err: any) {
        const apiErr = sqlExecutionError(err.message || 'SQL execution error')
        return reply.code(apiErr.statusCode).send(errorResponse(apiErr))
      }
    }
  )

  // POST /api/v1/sessions/:id/sql/execute — Execute SQL (read-only, POST version for SQLLab)
  server.post<{ Params: { id: string }; Body: { sql: string } }>(
    '/api/v1/sessions/:id/sql/execute',
    async (request, reply) => {
      const { id } = request.params
      await ensureSession(id)
      const { sql } = request.body || {}
      if (!sql) {
        const err = sqlExecutionError('Missing sql parameter')
        return reply.code(err.statusCode).send(errorResponse(err))
      }
      try {
        const result = await worker.executeRawSQL(id, sql)
        return successResponse(result)
      } catch (err: any) {
        const apiErr = sqlExecutionError(err.message || 'SQL execution error')
        return reply.code(apiErr.statusCode).send(errorResponse(apiErr))
      }
    }
  )

  // GET /api/v1/sessions/:id/sql/schema — Get database schema
  server.get<{ Params: { id: string } }>('/api/v1/sessions/:id/sql/schema', async (request) => {
    const { id } = request.params
    await ensureSession(id)
    const data = await worker.getSchema(id)
    return successResponse(data)
  })

  // GET /api/v1/sessions/:id/ai/conversations — List AI conversations for session
  server.get<{ Params: { id: string } }>('/api/v1/sessions/:id/ai/conversations', async (request) => {
    const { id } = request.params
    await ensureSession(id)
    const aiConversations = await import('../../ai/conversations')
    const data = aiConversations.getConversations(id)
    return successResponse(data)
  })

  // GET /api/v1/ai/conversations/:conversationId — Get single AI conversation
  server.get<{ Params: { conversationId: string } }>(
    '/api/v1/ai/conversations/:conversationId',
    async (request) => {
      const aiConversations = await import('../../ai/conversations')
      const data = aiConversations.getConversation(request.params.conversationId)
      return successResponse(data)
    }
  )

  // PATCH /api/v1/ai/conversations/:conversationId/title — Update conversation title
  server.patch<{ Params: { conversationId: string }; Body: { title: string } }>(
    '/api/v1/ai/conversations/:conversationId/title',
    async (request) => {
      const aiConversations = await import('../../ai/conversations')
      const data = aiConversations.updateConversationTitle(request.params.conversationId, request.body.title)
      return successResponse(data)
    }
  )

  // DELETE /api/v1/ai/conversations/:conversationId — Delete AI conversation
  server.delete<{ Params: { conversationId: string } }>(
    '/api/v1/ai/conversations/:conversationId',
    async (request) => {
      const aiConversations = await import('../../ai/conversations')
      const data = aiConversations.deleteConversation(request.params.conversationId)
      return successResponse(data)
    }
  )

  // GET /api/v1/ai/conversations/:conversationId/messages — Get AI conversation messages
  server.get<{ Params: { conversationId: string } }>(
    '/api/v1/ai/conversations/:conversationId/messages',
    async (request) => {
      const aiConversations = await import('../../ai/conversations')
      const data = aiConversations.getMessages(request.params.conversationId)
      return successResponse(data)
    }
  )

  // GET /api/v1/assistants — List all assistants (for WebUI)
  server.get('/api/v1/assistants', async () => {
    const assistants = assistantManager.getAllAssistants()
    return successResponse(assistants)
  })

  // GET /api/v1/assistants/:id — Get single assistant config (for WebUI)
  server.get<{ Params: { id: string } }>('/api/v1/assistants/:id', async (request) => {
    const config = assistantManager.getAssistantConfig(request.params.id)
    if (!config) {
      throw sessionNotFound(request.params.id)
    }
    return successResponse(config)
  })
}

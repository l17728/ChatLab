/**
 * ChatLab Collaboration API Routes
 * Exposes task, todo, focus, knowledge, graph, and identity services via HTTP
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { successResponse, errorResponse, ApiError, ApiErrorCode, serverError, invalidFormat } from '../errors'
import { verifyToken } from '../auth-db'
import { taskService } from '../../services/taskService'
import { todoService } from '../../services/todoService'
import { focusService } from '../../services/focusService'
import { knowledgeService } from '../../services/knowledgeService'
import { graphService } from '../../services/graphService'
import { identityService } from '../../services/identityService'

// ==================== Auth helper ====================

async function verifyBearer(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const auth = request.headers.authorization
  const remoteIp = request.ip
  const isLocal = remoteIp === '127.0.0.1' || remoteIp === '::1' || remoteIp === '::ffff:127.0.0.1'

  if (!auth) {
    if (isLocal) return true // Electron desktop — no token needed
    reply.code(401).send(errorResponse(new ApiError(ApiErrorCode.UNAUTHORIZED, 'Authentication required')))
    return false
  }

  if (!auth.startsWith('Bearer ')) {
    reply.code(401).send(errorResponse(new ApiError(ApiErrorCode.UNAUTHORIZED, 'Invalid auth format')))
    return false
  }

  const token = auth.slice(7)
  const result = await verifyToken(token)
  if (!result.valid) {
    reply.code(401).send(errorResponse(new ApiError(ApiErrorCode.UNAUTHORIZED, 'Invalid or expired token')))
    return false
  }
  return true
}

// ==================== Tasks ====================

async function listTasksHandler(request: FastifyRequest, reply: FastifyReply): Promise<any> {
  try {
    if (!(await verifyBearer(request, reply))) return
    const q = request.query as any
    // sessionId 不是 TaskQueryOptions 的已知字段，由下层按需忽略。
    // 这里只传已定义的字段避免 TS 类型错误。
    const tasks = taskService.queryTasks({
      status: q.status,
      owner: q.owner,
      priority: q.priority,
      limit: q.limit ? Number(q.limit) : undefined,
      offset: q.offset ? Number(q.offset) : undefined,
      sortBy: q.sortBy,
      sortOrder: q.sortOrder,
    })
    return successResponse({ tasks, total: tasks.length })
  } catch (error) {
    console.error('[WebUI API] Failed to list tasks:', error)
    const err = serverError('Failed to list tasks')
    return reply.code(err.statusCode).send(errorResponse(err))
  }
}

async function createTaskHandler(request: FastifyRequest, reply: FastifyReply): Promise<any> {
  try {
    if (!(await verifyBearer(request, reply))) return
    const body = request.body as any
    if (!body?.title) {
      const err = invalidFormat('title is required')
      return reply.code(err.statusCode).send(errorResponse(err))
    }
    if (typeof body.title === 'string' && body.title.length > 500) {
      const err = invalidFormat('title exceeds maximum length of 500')
      return reply.code(err.statusCode).send(errorResponse(err))
    }
    if (typeof body.description === 'string' && body.description.length > 5000) {
      const err = invalidFormat('description exceeds maximum length of 5000')
      return reply.code(err.statusCode).send(errorResponse(err))
    }
    const id = taskService.createTask({
      title: body.title,
      description: body.description,
      status: body.status || 'pending',
      priority: body.priority || 'normal',
      ownerGlobalUserId: body.ownerGlobalUserId,
      ownerDisplayName: body.ownerDisplayName,
      dueTs: body.dueTs,
      confidence: body.confidence ?? 1.0,
      isManual: body.isManual ?? true,
      tags: body.tags || [],
      metadata: body.metadata || {},
    })
    const task = taskService.getTask(id)
    return reply.code(201).send(successResponse({ task }))
  } catch (error) {
    console.error('[WebUI API] Failed to create task:', error)
    const err = serverError('Failed to create task')
    return reply.code(err.statusCode).send(errorResponse(err))
  }
}

async function getTaskHandler(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply): Promise<any> {
  try {
    if (!(await verifyBearer(request, reply))) return
    const id = Number(request.params.id)
    if (isNaN(id)) {
      const err = invalidFormat('Invalid task id')
      return reply.code(err.statusCode).send(errorResponse(err))
    }
    const task = taskService.getTask(id)
    if (!task) {
      const err = new ApiError(ApiErrorCode.SESSION_NOT_FOUND, 'Task not found')
      return reply.code(404).send(errorResponse(err))
    }
    return successResponse({ task })
  } catch (error) {
    console.error('[WebUI API] Failed to get task:', error)
    const err = serverError('Failed to get task')
    return reply.code(err.statusCode).send(errorResponse(err))
  }
}

async function updateTaskHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
): Promise<any> {
  try {
    if (!(await verifyBearer(request, reply))) return
    const id = Number(request.params.id)
    if (isNaN(id)) {
      const err = invalidFormat('Invalid task id')
      return reply.code(err.statusCode).send(errorResponse(err))
    }
    const body = request.body as any
    const updated = taskService.updateTask(id, body)
    if (!updated) {
      const err = new ApiError(ApiErrorCode.SESSION_NOT_FOUND, 'Task not found')
      return reply.code(404).send(errorResponse(err))
    }
    return successResponse({ task: taskService.getTask(id) })
  } catch (error) {
    console.error('[WebUI API] Failed to update task:', error)
    const err = serverError('Failed to update task')
    return reply.code(err.statusCode).send(errorResponse(err))
  }
}

async function deleteTaskHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
): Promise<any> {
  try {
    if (!(await verifyBearer(request, reply))) return
    const id = Number(request.params.id)
    if (isNaN(id)) {
      const err = invalidFormat('Invalid task id')
      return reply.code(err.statusCode).send(errorResponse(err))
    }
    const deleted = taskService.deleteTask(id)
    if (!deleted) {
      const err = new ApiError(ApiErrorCode.SESSION_NOT_FOUND, 'Task not found')
      return reply.code(404).send(errorResponse(err))
    }
    return successResponse({ deleted: true })
  } catch (error) {
    console.error('[WebUI API] Failed to delete task:', error)
    const err = serverError('Failed to delete task')
    return reply.code(err.statusCode).send(errorResponse(err))
  }
}

// ==================== Todos ====================

async function listTodosHandler(request: FastifyRequest, reply: FastifyReply): Promise<any> {
  try {
    if (!(await verifyBearer(request, reply))) return
    const q = request.query as any
    const todos = todoService.getTodos({
      globalUserId: q.globalUserId,
      status: q.status,
      priority: q.priority,
      isStarred: q.isStarred !== undefined ? q.isStarred === 'true' : undefined,
      sourceType: q.sourceType,
      limit: q.limit ? Number(q.limit) : undefined,
      offset: q.offset ? Number(q.offset) : undefined,
      sortBy: q.sortBy,
      sortOrder: q.sortOrder,
    })
    return successResponse({ todos, total: todos.length })
  } catch (error) {
    console.error('[WebUI API] Failed to list todos:', error)
    const err = serverError('Failed to list todos')
    return reply.code(err.statusCode).send(errorResponse(err))
  }
}

async function createTodoHandler(request: FastifyRequest, reply: FastifyReply): Promise<any> {
  try {
    if (!(await verifyBearer(request, reply))) return
    const body = request.body as any
    if (!body?.title || !body?.globalUserId) {
      const err = invalidFormat('title and globalUserId are required')
      return reply.code(err.statusCode).send(errorResponse(err))
    }
    if (typeof body.title === 'string' && body.title.length > 500) {
      const err = invalidFormat('title exceeds maximum length of 500')
      return reply.code(err.statusCode).send(errorResponse(err))
    }
    if (typeof body.description === 'string' && body.description.length > 5000) {
      const err = invalidFormat('description exceeds maximum length of 5000')
      return reply.code(err.statusCode).send(errorResponse(err))
    }
    if (typeof body.notes === 'string' && body.notes.length > 5000) {
      const err = invalidFormat('notes exceeds maximum length of 5000')
      return reply.code(err.statusCode).send(errorResponse(err))
    }
    const id = todoService.createTodo({
      globalUserId: body.globalUserId,
      taskId: body.taskId,
      taskTitle: body.taskTitle,
      title: body.title,
      description: body.description,
      status: body.status || 'pending',
      priority: body.priority || 'normal',
      dueTs: body.dueTs,
      reminderTs: body.reminderTs,
      notes: body.notes,
      tags: body.tags || [],
      isStarred: body.isStarred ?? false,
      progress: body.progress ?? 0,
      sourceType: body.sourceType || 'manual',
      sourceSessionId: body.sourceSessionId,
    })
    return reply.code(201).send(successResponse({ todo: todoService.getTodo(id) }))
  } catch (error) {
    console.error('[WebUI API] Failed to create todo:', error)
    const err = serverError('Failed to create todo')
    return reply.code(err.statusCode).send(errorResponse(err))
  }
}

async function getTodoHandler(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply): Promise<any> {
  try {
    if (!(await verifyBearer(request, reply))) return
    const id = Number(request.params.id)
    if (isNaN(id)) {
      const err = invalidFormat('Invalid todo id')
      return reply.code(err.statusCode).send(errorResponse(err))
    }
    const todo = todoService.getTodo(id)
    if (!todo) {
      const err = new ApiError(ApiErrorCode.SESSION_NOT_FOUND, 'Todo not found')
      return reply.code(404).send(errorResponse(err))
    }
    return successResponse({ todo })
  } catch (error) {
    console.error('[WebUI API] Failed to get todo:', error)
    const err = serverError('Failed to get todo')
    return reply.code(err.statusCode).send(errorResponse(err))
  }
}

async function updateTodoHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
): Promise<any> {
  try {
    if (!(await verifyBearer(request, reply))) return
    const id = Number(request.params.id)
    if (isNaN(id)) {
      const err = invalidFormat('Invalid todo id')
      return reply.code(err.statusCode).send(errorResponse(err))
    }
    const body = request.body as any
    const updated = todoService.updateTodo(id, body)
    if (!updated) {
      const err = new ApiError(ApiErrorCode.SESSION_NOT_FOUND, 'Todo not found')
      return reply.code(404).send(errorResponse(err))
    }
    return successResponse({ todo: todoService.getTodo(id) })
  } catch (error) {
    console.error('[WebUI API] Failed to update todo:', error)
    const err = serverError('Failed to update todo')
    return reply.code(err.statusCode).send(errorResponse(err))
  }
}

async function deleteTodoHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
): Promise<any> {
  try {
    if (!(await verifyBearer(request, reply))) return
    const id = Number(request.params.id)
    if (isNaN(id)) {
      const err = invalidFormat('Invalid todo id')
      return reply.code(err.statusCode).send(errorResponse(err))
    }
    const deleted = todoService.deleteTodo(id)
    if (!deleted) {
      const err = new ApiError(ApiErrorCode.SESSION_NOT_FOUND, 'Todo not found')
      return reply.code(404).send(errorResponse(err))
    }
    return successResponse({ deleted: true })
  } catch (error) {
    console.error('[WebUI API] Failed to delete todo:', error)
    const err = serverError('Failed to delete todo')
    return reply.code(err.statusCode).send(errorResponse(err))
  }
}

// ==================== Focus ====================

async function listFocusHandler(request: FastifyRequest, reply: FastifyReply): Promise<any> {
  try {
    if (!(await verifyBearer(request, reply))) return
    const q = request.query as any
    const items = focusService.getFocusItems({
      globalUserId: q.globalUserId,
      type: q.type,
      status: q.status,
      limit: q.limit ? Number(q.limit) : undefined,
      offset: q.offset ? Number(q.offset) : undefined,
    })
    return successResponse({ items, total: items.length })
  } catch (error) {
    console.error('[WebUI API] Failed to list focus items:', error)
    const err = serverError('Failed to list focus items')
    return reply.code(err.statusCode).send(errorResponse(err))
  }
}

async function createFocusHandler(request: FastifyRequest, reply: FastifyReply): Promise<any> {
  try {
    if (!(await verifyBearer(request, reply))) return
    const body = request.body as any
    if (!body?.title || !body?.globalUserId || !body?.type) {
      const err = invalidFormat('title, globalUserId and type are required')
      return reply.code(err.statusCode).send(errorResponse(err))
    }
    if (typeof body.title === 'string' && body.title.length > 500) {
      const err = invalidFormat('title exceeds maximum length of 500')
      return reply.code(err.statusCode).send(errorResponse(err))
    }
    if (typeof body.description === 'string' && body.description.length > 5000) {
      const err = invalidFormat('description exceeds maximum length of 5000')
      return reply.code(err.statusCode).send(errorResponse(err))
    }
    const id = focusService.createFocusItem({
      globalUserId: body.globalUserId,
      type: body.type,
      title: body.title,
      description: body.description,
      keywords: body.keywords || [],
      color: body.color,
      status: body.status || 'active',
      lastActivityTs: body.lastActivityTs,
      lastSummary: body.lastSummary,
    })
    const items = focusService.getFocusItems({ globalUserId: body.globalUserId, limit: 1 })
    const item = items.find((i) => i.id === id) || null
    return reply.code(201).send(successResponse({ item }))
  } catch (error) {
    console.error('[WebUI API] Failed to create focus item:', error)
    const err = serverError('Failed to create focus item')
    return reply.code(err.statusCode).send(errorResponse(err))
  }
}

async function updateFocusHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
): Promise<any> {
  try {
    if (!(await verifyBearer(request, reply))) return
    const id = Number(request.params.id)
    if (isNaN(id)) {
      const err = invalidFormat('Invalid focus item id')
      return reply.code(err.statusCode).send(errorResponse(err))
    }
    const body = request.body as any
    const updated = focusService.updateFocusItem(id, body)
    if (!updated) {
      const err = new ApiError(ApiErrorCode.SESSION_NOT_FOUND, 'Focus item not found')
      return reply.code(404).send(errorResponse(err))
    }
    return successResponse({ updated: true })
  } catch (error) {
    console.error('[WebUI API] Failed to update focus item:', error)
    const err = serverError('Failed to update focus item')
    return reply.code(err.statusCode).send(errorResponse(err))
  }
}

async function archiveFocusHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
): Promise<any> {
  try {
    if (!(await verifyBearer(request, reply))) return
    const id = Number(request.params.id)
    if (isNaN(id)) {
      const err = invalidFormat('Invalid focus item id')
      return reply.code(err.statusCode).send(errorResponse(err))
    }
    const archived = focusService.archiveFocusItem(id)
    if (!archived) {
      const err = new ApiError(ApiErrorCode.SESSION_NOT_FOUND, 'Focus item not found')
      return reply.code(404).send(errorResponse(err))
    }
    return successResponse({ archived: true })
  } catch (error) {
    console.error('[WebUI API] Failed to archive focus item:', error)
    const err = serverError('Failed to archive focus item')
    return reply.code(err.statusCode).send(errorResponse(err))
  }
}

// ==================== Knowledge ====================

async function listKnowledgeHandler(request: FastifyRequest, reply: FastifyReply): Promise<any> {
  try {
    if (!(await verifyBearer(request, reply))) return
    const q = request.query as any
    const items = knowledgeService.queryItems({
      type: q.type,
      category: q.category,
      status: q.status,
      searchText: q.searchText,
      sessionId: q.sessionId,
      limit: q.limit ? Number(q.limit) : undefined,
      offset: q.offset ? Number(q.offset) : undefined,
      sortBy: q.sortBy,
      sortOrder: q.sortOrder,
    })
    return successResponse({ items, total: items.length })
  } catch (error) {
    console.error('[WebUI API] Failed to list knowledge items:', error)
    const err = serverError('Failed to list knowledge items')
    return reply.code(err.statusCode).send(errorResponse(err))
  }
}

async function createKnowledgeHandler(request: FastifyRequest, reply: FastifyReply): Promise<any> {
  try {
    if (!(await verifyBearer(request, reply))) return
    const body = request.body as any
    if (!body?.title || !body?.content || !body?.type) {
      const err = invalidFormat('title, content and type are required')
      return reply.code(err.statusCode).send(errorResponse(err))
    }
    if (typeof body.title === 'string' && body.title.length > 500) {
      const err = invalidFormat('title exceeds maximum length of 500')
      return reply.code(err.statusCode).send(errorResponse(err))
    }
    if (typeof body.content === 'string' && body.content.length > 50000) {
      const err = invalidFormat('content exceeds maximum length of 50000')
      return reply.code(err.statusCode).send(errorResponse(err))
    }
    if (typeof body.summary === 'string' && body.summary.length > 5000) {
      const err = invalidFormat('summary exceeds maximum length of 5000')
      return reply.code(err.statusCode).send(errorResponse(err))
    }
    const id = knowledgeService.createItem({
      type: body.type,
      title: body.title,
      content: body.content,
      summary: body.summary,
      category: body.category,
      tags: body.tags || [],
      sourceSessionIds: body.sourceSessionIds || [],
      sourceMessageRefs: body.sourceMessageRefs || [],
      confidence: body.confidence ?? 1.0,
      isEdited: body.isEdited ?? false,
      status: body.status || 'active',
      parentId: body.parentId,
    })
    return reply.code(201).send(successResponse({ item: knowledgeService.getItem(id) }))
  } catch (error) {
    console.error('[WebUI API] Failed to create knowledge item:', error)
    const err = serverError('Failed to create knowledge item')
    return reply.code(err.statusCode).send(errorResponse(err))
  }
}

async function getKnowledgeHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
): Promise<any> {
  try {
    if (!(await verifyBearer(request, reply))) return
    const id = Number(request.params.id)
    if (isNaN(id)) {
      const err = invalidFormat('Invalid knowledge item id')
      return reply.code(err.statusCode).send(errorResponse(err))
    }
    const item = knowledgeService.getItem(id)
    if (!item) {
      const err = new ApiError(ApiErrorCode.SESSION_NOT_FOUND, 'Knowledge item not found')
      return reply.code(404).send(errorResponse(err))
    }
    knowledgeService.incrementViewCount(id)
    return successResponse({ item })
  } catch (error) {
    console.error('[WebUI API] Failed to get knowledge item:', error)
    const err = serverError('Failed to get knowledge item')
    return reply.code(err.statusCode).send(errorResponse(err))
  }
}

async function updateKnowledgeHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
): Promise<any> {
  try {
    if (!(await verifyBearer(request, reply))) return
    const id = Number(request.params.id)
    if (isNaN(id)) {
      const err = invalidFormat('Invalid knowledge item id')
      return reply.code(err.statusCode).send(errorResponse(err))
    }
    const body = request.body as any
    const updated = knowledgeService.updateItem(id, body)
    if (!updated) {
      const err = new ApiError(ApiErrorCode.SESSION_NOT_FOUND, 'Knowledge item not found')
      return reply.code(404).send(errorResponse(err))
    }
    return successResponse({ item: knowledgeService.getItem(id) })
  } catch (error) {
    console.error('[WebUI API] Failed to update knowledge item:', error)
    const err = serverError('Failed to update knowledge item')
    return reply.code(err.statusCode).send(errorResponse(err))
  }
}

async function archiveKnowledgeHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
): Promise<any> {
  try {
    if (!(await verifyBearer(request, reply))) return
    const id = Number(request.params.id)
    if (isNaN(id)) {
      const err = invalidFormat('Invalid knowledge item id')
      return reply.code(err.statusCode).send(errorResponse(err))
    }
    const archived = knowledgeService.archiveItem(id)
    if (!archived) {
      const err = new ApiError(ApiErrorCode.SESSION_NOT_FOUND, 'Knowledge item not found')
      return reply.code(404).send(errorResponse(err))
    }
    return successResponse({ archived: true })
  } catch (error) {
    console.error('[WebUI API] Failed to archive knowledge item:', error)
    const err = serverError('Failed to archive knowledge item')
    return reply.code(err.statusCode).send(errorResponse(err))
  }
}

async function getKnowledgeCategoriesHandler(request: FastifyRequest, reply: FastifyReply): Promise<any> {
  try {
    if (!(await verifyBearer(request, reply))) return
    const categories = knowledgeService.getCategories()
    return successResponse({ categories })
  } catch (error) {
    console.error('[WebUI API] Failed to get categories:', error)
    const err = serverError('Failed to get categories')
    return reply.code(err.statusCode).send(errorResponse(err))
  }
}

async function markKnowledgeHelpfulHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
): Promise<any> {
  try {
    if (!(await verifyBearer(request, reply))) return
    const id = Number(request.params.id)
    if (isNaN(id)) {
      const err = invalidFormat('Invalid knowledge item id')
      return reply.code(err.statusCode).send(errorResponse(err))
    }
    knowledgeService.incrementHelpfulCount(id)
    return successResponse({ marked: true })
  } catch (error) {
    console.error('[WebUI API] Failed to mark helpful:', error)
    const err = serverError('Failed to mark helpful')
    return reply.code(err.statusCode).send(errorResponse(err))
  }
}

// ==================== Graph ====================

async function listGraphNodesHandler(request: FastifyRequest, reply: FastifyReply): Promise<any> {
  try {
    if (!(await verifyBearer(request, reply))) return
    const q = request.query as any
    const nodes = graphService.queryNodes({
      types: q.types ? (Array.isArray(q.types) ? q.types : [q.types]) : undefined,
      sessionId: q.sessionId,
      fromTs: q.fromTs ? Number(q.fromTs) : undefined,
      toTs: q.toTs ? Number(q.toTs) : undefined,
      limit: q.limit ? Number(q.limit) : undefined,
    })
    return successResponse({ nodes, total: nodes.length })
  } catch (error) {
    console.error('[WebUI API] Failed to list graph nodes:', error)
    const err = serverError('Failed to list graph nodes')
    return reply.code(err.statusCode).send(errorResponse(err))
  }
}

async function upsertGraphNodeHandler(request: FastifyRequest, reply: FastifyReply): Promise<any> {
  try {
    if (!(await verifyBearer(request, reply))) return
    const body = request.body as any
    if (!body?.type || !body?.name) {
      const err = invalidFormat('type and name are required')
      return reply.code(err.statusCode).send(errorResponse(err))
    }
    if (typeof body.name === 'string' && body.name.length > 500) {
      const err = invalidFormat('name exceeds maximum length of 500')
      return reply.code(err.statusCode).send(errorResponse(err))
    }
    if (typeof body.displayName === 'string' && body.displayName.length > 500) {
      const err = invalidFormat('displayName exceeds maximum length of 500')
      return reply.code(err.statusCode).send(errorResponse(err))
    }
    const now = Date.now()
    const id = graphService.upsertNode({
      type: body.type,
      isCoreType: body.isCoreType ?? false,
      name: body.name,
      displayName: body.displayName,
      properties: body.properties || {},
      firstSeenTs: body.firstSeenTs || now,
      lastSeenTs: body.lastSeenTs || now,
      sourceSessions: body.sourceSessions || [],
      sourceMessageRefs: body.sourceMessageRefs || [],
      confidence: body.confidence ?? 1.0,
      color: body.color,
      icon: body.icon,
    })
    return reply.code(201).send(successResponse({ id }))
  } catch (error) {
    console.error('[WebUI API] Failed to upsert graph node:', error)
    const err = serverError('Failed to upsert graph node')
    return reply.code(err.statusCode).send(errorResponse(err))
  }
}

async function listGraphEdgesHandler(request: FastifyRequest, reply: FastifyReply): Promise<any> {
  try {
    if (!(await verifyBearer(request, reply))) return
    const q = request.query as any
    const nodeIds = q.nodeIds ? (Array.isArray(q.nodeIds) ? q.nodeIds : [q.nodeIds]).map(Number) : []
    const edges = graphService.queryEdges(nodeIds)
    return successResponse({ edges, total: edges.length })
  } catch (error) {
    console.error('[WebUI API] Failed to list graph edges:', error)
    const err = serverError('Failed to list graph edges')
    return reply.code(err.statusCode).send(errorResponse(err))
  }
}

async function upsertGraphEdgeHandler(request: FastifyRequest, reply: FastifyReply): Promise<any> {
  try {
    if (!(await verifyBearer(request, reply))) return
    const body = request.body as any
    if (!body?.type || body?.sourceNodeId === undefined || body?.targetNodeId === undefined) {
      const err = invalidFormat('type, sourceNodeId and targetNodeId are required')
      return reply.code(err.statusCode).send(errorResponse(err))
    }
    const now = Date.now()
    const id = graphService.upsertEdge({
      type: body.type,
      isCoreType: body.isCoreType ?? false,
      sourceNodeId: body.sourceNodeId,
      targetNodeId: body.targetNodeId,
      properties: body.properties || {},
      firstSeenTs: body.firstSeenTs || now,
      lastSeenTs: body.lastSeenTs || now,
      sourceSessions: body.sourceSessions || [],
      confidence: body.confidence ?? 1.0,
    })
    return reply.code(201).send(successResponse({ id }))
  } catch (error) {
    console.error('[WebUI API] Failed to upsert graph edge:', error)
    const err = serverError('Failed to upsert graph edge')
    return reply.code(err.statusCode).send(errorResponse(err))
  }
}

async function getGraphStatsHandler(request: FastifyRequest, reply: FastifyReply): Promise<any> {
  try {
    if (!(await verifyBearer(request, reply))) return
    const stats = graphService.getStats()
    return successResponse(stats)
  } catch (error) {
    console.error('[WebUI API] Failed to get graph stats:', error)
    const err = serverError('Failed to get graph stats')
    return reply.code(err.statusCode).send(errorResponse(err))
  }
}

// ==================== Identity ====================

async function matchIdentityHandler(request: FastifyRequest, reply: FastifyReply): Promise<any> {
  try {
    if (!(await verifyBearer(request, reply))) return
    const body = request.body as any
    if (!body?.sessionId || !body?.member) {
      const err = invalidFormat('sessionId and member are required')
      return reply.code(err.statusCode).send(errorResponse(err))
    }
    const result = await identityService.matchUserIdentity(
      body.sessionId,
      body.member,
      body.globalNicknames || [],
      body.matchStrategy || 'fuzzy'
    )
    return successResponse(result)
  } catch (error) {
    console.error('[WebUI API] Failed to match identity:', error)
    const err = serverError('Failed to match identity')
    return reply.code(err.statusCode).send(errorResponse(err))
  }
}

async function confirmIdentityHandler(request: FastifyRequest, reply: FastifyReply): Promise<any> {
  try {
    if (!(await verifyBearer(request, reply))) return
    const body = request.body as any
    if (!body?.sessionId || body?.memberId === undefined || !body?.displayName) {
      const err = invalidFormat('sessionId, memberId and displayName are required')
      return reply.code(err.statusCode).send(errorResponse(err))
    }
    const globalUserId = await identityService.confirmIdentity(body.sessionId, body.memberId, body.displayName)
    return successResponse({ globalUserId })
  } catch (error) {
    console.error('[WebUI API] Failed to confirm identity:', error)
    const err = serverError('Failed to confirm identity')
    return reply.code(err.statusCode).send(errorResponse(err))
  }
}

async function getMemberCandidatesHandler(request: FastifyRequest, reply: FastifyReply): Promise<any> {
  try {
    if (!(await verifyBearer(request, reply))) return
    const q = request.query as any
    if (!q.sessionId || q.memberId === undefined) {
      const err = invalidFormat('sessionId and memberId are required')
      return reply.code(err.statusCode).send(errorResponse(err))
    }
    const candidates = await identityService.getMemberCandidates(
      q.sessionId,
      Number(q.memberId),
      q.topK ? Number(q.topK) : 5
    )
    return successResponse({ candidates })
  } catch (error) {
    console.error('[WebUI API] Failed to get candidates:', error)
    const err = serverError('Failed to get candidates')
    return reply.code(err.statusCode).send(errorResponse(err))
  }
}

// ==================== Route Registration ====================

export function registerCollaborationRoutes(server: FastifyInstance): void {
  console.log('[Collaboration] Registering collaboration routes...')

  // Tasks
  server.get('/api/v1/collaboration/tasks', { logLevel: 'warn' }, listTasksHandler)
  server.post('/api/v1/collaboration/tasks', { logLevel: 'warn' }, createTaskHandler)
  server.get<{ Params: { id: string } }>('/api/v1/collaboration/tasks/:id', { logLevel: 'warn' }, getTaskHandler)
  server.put<{ Params: { id: string } }>('/api/v1/collaboration/tasks/:id', { logLevel: 'warn' }, updateTaskHandler)
  server.delete<{ Params: { id: string } }>('/api/v1/collaboration/tasks/:id', { logLevel: 'warn' }, deleteTaskHandler)

  // Todos
  server.get('/api/v1/collaboration/todos', { logLevel: 'warn' }, listTodosHandler)
  server.post('/api/v1/collaboration/todos', { logLevel: 'warn' }, createTodoHandler)
  server.get<{ Params: { id: string } }>('/api/v1/collaboration/todos/:id', { logLevel: 'warn' }, getTodoHandler)
  server.put<{ Params: { id: string } }>('/api/v1/collaboration/todos/:id', { logLevel: 'warn' }, updateTodoHandler)
  server.delete<{ Params: { id: string } }>('/api/v1/collaboration/todos/:id', { logLevel: 'warn' }, deleteTodoHandler)

  // Focus
  server.get('/api/v1/collaboration/focus', { logLevel: 'warn' }, listFocusHandler)
  server.post('/api/v1/collaboration/focus', { logLevel: 'warn' }, createFocusHandler)
  server.put<{ Params: { id: string } }>('/api/v1/collaboration/focus/:id', { logLevel: 'warn' }, updateFocusHandler)
  server.delete<{ Params: { id: string } }>(
    '/api/v1/collaboration/focus/:id',
    { logLevel: 'warn' },
    archiveFocusHandler
  )

  // Knowledge
  server.get('/api/v1/collaboration/knowledge', { logLevel: 'warn' }, listKnowledgeHandler)
  server.post('/api/v1/collaboration/knowledge', { logLevel: 'warn' }, createKnowledgeHandler)
  server.get('/api/v1/collaboration/knowledge/categories', { logLevel: 'warn' }, getKnowledgeCategoriesHandler)
  server.get<{ Params: { id: string } }>(
    '/api/v1/collaboration/knowledge/:id',
    { logLevel: 'warn' },
    getKnowledgeHandler
  )
  server.put<{ Params: { id: string } }>(
    '/api/v1/collaboration/knowledge/:id',
    { logLevel: 'warn' },
    updateKnowledgeHandler
  )
  server.delete<{ Params: { id: string } }>(
    '/api/v1/collaboration/knowledge/:id',
    { logLevel: 'warn' },
    archiveKnowledgeHandler
  )
  server.post<{ Params: { id: string } }>(
    '/api/v1/collaboration/knowledge/:id/helpful',
    { logLevel: 'warn' },
    markKnowledgeHelpfulHandler
  )

  // Graph
  server.get('/api/v1/collaboration/graph/nodes', { logLevel: 'warn' }, listGraphNodesHandler)
  server.post('/api/v1/collaboration/graph/nodes', { logLevel: 'warn' }, upsertGraphNodeHandler)
  server.get('/api/v1/collaboration/graph/edges', { logLevel: 'warn' }, listGraphEdgesHandler)
  server.post('/api/v1/collaboration/graph/edges', { logLevel: 'warn' }, upsertGraphEdgeHandler)
  server.get('/api/v1/collaboration/graph/stats', { logLevel: 'warn' }, getGraphStatsHandler)

  // Identity
  server.post('/api/v1/collaboration/identity/match', { logLevel: 'warn' }, matchIdentityHandler)
  server.post('/api/v1/collaboration/identity/confirm', { logLevel: 'warn' }, confirmIdentityHandler)
  server.get('/api/v1/collaboration/identity/candidates', { logLevel: 'warn' }, getMemberCandidatesHandler)

  console.log('[Collaboration] Collaboration routes registered successfully')
}

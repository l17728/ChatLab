/**
 * 协作功能 IPC 处理器
 * 处理 global_task（任务CRUD）和 extraction_job（提取任务状态）相关的 IPC 请求
 */

import { ipcMain } from 'electron'
import type { IpcContext } from './types'
import { extractionJobService } from '../database/global/extraction'
import type { JobType } from '../database/global/extraction'
import { initGlobalDatabases } from '../database/global'
import { taskService } from '../services/taskService'
import type { TaskQueryOptions } from '../services/taskService'
import { todoService } from '../services/todoService'
import type { TodoQueryOptions } from '../services/todoService'
import { knowledgeService } from '../services/knowledgeService'
import type { KnowledgeQueryOptions } from '../services/knowledgeService'
import { focusService } from '../services/focusService'
import type { FocusQueryOptions } from '../services/focusService'
import { graphService } from '../services/graphService'
import type { GraphQueryOptions } from '../services/graphService'
import {
  startTaskExtraction,
  startGraphExtraction,
  startFaqExtraction,
  startFocusExtraction,
  startUnifiedExtraction,
} from '../services/extractionRunner'
import { openDatabase } from '../database/core'
import { logAnalysis } from '../ai/analysisLog'

/**
 * 注册协作功能 IPC 处理器
 */
export function registerCollaborationHandlers(ctx: IpcContext): void {
  const { win } = ctx
  // 确保全局数据库已初始化
  initGlobalDatabases()

  // ==================== 任务 CRUD ====================

  ipcMain.handle('collab:getTasks', async (_event, options?: TaskQueryOptions) => {
    try {
      return { success: true, data: taskService.queryTasks(options) }
    } catch (error) {
      console.error('[Collaboration] getTasks failed:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('collab:getTask', async (_event, taskId: number) => {
    try {
      return { success: true, data: taskService.getTask(taskId) }
    } catch (error) {
      console.error('[Collaboration] getTask failed:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle(
    'collab:createTask',
    async (_event, payload: Parameters<typeof taskService.createTask>[0] & { sessionId?: string }) => {
      if (!payload || typeof payload !== 'object') {
        return { success: false, error: 'task is required' }
      }
      try {
        const { sessionId, ...task } = payload
        const metadata = { ...(task.metadata ?? {}), ...(sessionId ? { sessionId } : {}) }
        const normalized = { ...task, tags: task.tags ?? [], metadata }
        const id = taskService.createTask(normalized)
        // 手工建的任务也要落 task_source，否则 getTasksBySession 查不到（和 extractionRunner 同构）
        if (sessionId) {
          taskService.addTaskSource(id, sessionId, 0, Date.now(), task.confidence ?? 1.0)
        }
        return { success: true, data: id }
      } catch (error) {
        console.error('[Collaboration] createTask failed:', error)
        return { success: false, error: String(error) }
      }
    }
  )

  ipcMain.handle(
    'collab:updateTask',
    async (_event, taskId: number, updates: Parameters<typeof taskService.updateTask>[1]) => {
      try {
        const ok = taskService.updateTask(taskId, updates)
        return { success: ok }
      } catch (error) {
        console.error('[Collaboration] updateTask failed:', error)
        return { success: false, error: String(error) }
      }
    }
  )

  ipcMain.handle('collab:deleteTask', async (_event, taskId: number) => {
    try {
      const ok = taskService.deleteTask(taskId)
      return { success: ok }
    } catch (error) {
      console.error('[Collaboration] deleteTask failed:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('collab:getTasksBySession', async (_event, sessionId: string, status?: string) => {
    if (!sessionId || typeof sessionId !== 'string') {
      return { success: false, error: 'sessionId is required and must be a non-empty string' }
    }
    try {
      return { success: true, data: taskService.getTasksBySession(sessionId, status) }
    } catch (error) {
      console.error('[Collaboration] getTasksBySession failed:', error)
      return { success: false, error: String(error) }
    }
  })

  // ==================== 提取任务 ====================

  ipcMain.handle('collab:getExtractionJobs', async (_event, sessionId: string) => {
    try {
      return { success: true, data: extractionJobService.getJobsBySession(sessionId) }
    } catch (error) {
      console.error('[Collaboration] getExtractionJobs failed:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('collab:getExtractionJob', async (_event, jobId: string) => {
    try {
      return { success: true, data: extractionJobService.getJob(jobId) }
    } catch (error) {
      console.error('[Collaboration] getExtractionJob failed:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle(
    'collab:createExtractionJob',
    async (
      _event,
      sessionId: string,
      jobType: JobType,
      forceRerun: boolean = false,
      globalNicknames: string[] = []
    ) => {
      try {
        logAnalysis(
          'info',
          `IPC createExtractionJob: sessionId=${sessionId} jobType=${jobType} forceRerun=${forceRerun} nicknames=${globalNicknames.length}`
        )
        const job = await extractionJobService.createJob(sessionId, jobType, forceRerun)
        logAnalysis('info', `Job resolved: id=${job.id} status=${job.status}`)
        // createJob 现在永远返回 pending（新 job）或 running（互斥的活跃任务）——
        // 没有已 done 直接回显的路径了。worker 自己内部还会再查 running 做二次互斥。
        {
          if (jobType === 'tasks') {
            startTaskExtraction(sessionId, win).catch((err) =>
              console.error('[Collaboration] startTaskExtraction error:', err)
            )
          } else if (jobType === 'graph') {
            startGraphExtraction(sessionId, win).catch((err) =>
              console.error('[Collaboration] startGraphExtraction error:', err)
            )
          } else if (jobType === 'faq') {
            startFaqExtraction(sessionId, win).catch((err) =>
              console.error('[Collaboration] startFaqExtraction error:', err)
            )
          } else if (jobType === 'focus') {
            startFocusExtraction(sessionId, win).catch((err) =>
              console.error('[Collaboration] startFocusExtraction error:', err)
            )
          } else if (jobType === 'all') {
            startUnifiedExtraction(sessionId, win, forceRerun, globalNicknames).catch((err) =>
              console.error('[Collaboration] startUnifiedExtraction error:', err)
            )
          }
        }
        return { success: true, data: job }
      } catch (error) {
        console.error('[Collaboration] createExtractionJob failed:', error)
        return { success: false, error: String(error) }
      }
    }
  )

  // 查询某会话的增量分析状态：有多少新消息还未分析
  ipcMain.handle('collab:getAnalysisStatus', async (_event, sessionId: string) => {
    try {
      const lastDone = extractionJobService.getLatestDoneJob(sessionId, 'all')
      const lastAnalyzedId = (lastDone?.resultSummary?.lastAnalyzedMessageId as number | undefined) ?? 0
      const { total } = await (await import('../worker/workerManager')).getAllRecentMessages(sessionId, undefined, 1)
      // 简化：假设 id 连续递增（SQLite 自增），新消息数 = total - lastAnalyzedId
      // 如不连续，后续可改为 "count where id > lastAnalyzedId"
      const newMessageCount = Math.max(0, total - lastAnalyzedId)
      return {
        success: true,
        data: {
          sessionId,
          lastAnalyzedMessageId: lastAnalyzedId,
          lastAnalyzedAt: lastDone?.finishedAt ?? null,
          totalMessages: total,
          newMessageCount,
          hasNewMessages: newMessageCount > 0,
          everAnalyzed: !!lastDone,
        },
      }
    } catch (error) {
      console.error('[Collaboration] getAnalysisStatus failed:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('collab:retryExtractionJob', async (_event, jobId: string) => {
    try {
      extractionJobService.retryJob(jobId)
      return { success: true }
    } catch (error) {
      console.error('[Collaboration] retryExtractionJob failed:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('collab:getFailedJobs', async (_event, limit: number = 10) => {
    try {
      const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 10
      return { success: true, data: extractionJobService.getFailedJobs(safeLimit) }
    } catch (error) {
      console.error('[Collaboration] getFailedJobs failed:', error)
      return { success: false, error: String(error) }
    }
  })

  // ==================== 待办 CRUD ====================

  ipcMain.handle('collab:getTodos', async (_event, options?: TodoQueryOptions) => {
    try {
      return { success: true, data: todoService.getTodos(options) }
    } catch (error) {
      console.error('[Collaboration] getTodos failed:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('collab:getTodo', async (_event, todoId: number) => {
    try {
      return { success: true, data: todoService.getTodo(todoId) }
    } catch (error) {
      console.error('[Collaboration] getTodo failed:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle(
    'collab:createTodo',
    async (_event, todo: Partial<Parameters<typeof todoService.createTodo>[0]> & { title: string }) => {
      try {
        // Runtime validation — IPC args lose TypeScript types after serialization
        if (!todo.title || typeof todo.title !== 'string' || todo.title.trim() === '') {
          return { success: false, error: 'title is required and must be a non-empty string' }
        }
        // 应用默认值，确保必填字段存在
        const fullTodo: Parameters<typeof todoService.createTodo>[0] = {
          globalUserId: todo.globalUserId || 'default',
          title: todo.title.trim().slice(0, 500),
          description: todo.description,
          status: todo.status || 'pending',
          priority: todo.priority || 'normal',
          progress: todo.progress ?? 0,
          tags: todo.tags || [],
          isStarred: todo.isStarred ?? false,
          sourceType: todo.sourceType || 'manual',
          sourceSessionId: todo.sourceSessionId,
          taskId: todo.taskId,
          taskTitle: todo.taskTitle,
          dueTs: todo.dueTs,
          reminderTs: todo.reminderTs,
          notes: todo.notes,
          completedTs: todo.completedTs,
        }
        const id = todoService.createTodo(fullTodo)
        console.log('[Collaboration] createTodo:', todo.title, '→ id', id)
        return { success: true, data: id }
      } catch (error) {
        console.error('[Collaboration] createTodo failed:', error)
        return { success: false, error: String(error) }
      }
    }
  )

  ipcMain.handle(
    'collab:updateTodo',
    async (_event, todoId: number, updates: Parameters<typeof todoService.updateTodo>[1]) => {
      try {
        const ok = todoService.updateTodo(todoId, updates)
        return { success: ok }
      } catch (error) {
        console.error('[Collaboration] updateTodo failed:', error)
        return { success: false, error: String(error) }
      }
    }
  )

  ipcMain.handle('collab:deleteTodo', async (_event, todoId: number) => {
    try {
      const ok = todoService.deleteTodo(todoId)
      return { success: ok }
    } catch (error) {
      console.error('[Collaboration] deleteTodo failed:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('collab:syncTodoFromTask', async (_event, globalUserId: string, taskId: number) => {
    try {
      const task = taskService.getTask(taskId)
      if (!task) return { success: false, error: 'task not found' }
      const todoId = todoService.syncFromTask(globalUserId, taskId, task.title, {
        status: task.status as any,
        priority: task.priority as any,
        description: task.description,
        dueTs: task.dueTs,
      })
      return { success: true, data: todoId }
    } catch (error) {
      console.error('[Collaboration] syncTodoFromTask failed:', error)
      return { success: false, error: String(error) }
    }
  })

  // ==================== 知识库 CRUD ====================

  ipcMain.handle('collab:getKnowledgeItems', async (_event, options?: KnowledgeQueryOptions) => {
    try {
      return { success: true, data: knowledgeService.queryItems(options) }
    } catch (error) {
      console.error('[Collaboration] getKnowledgeItems failed:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('collab:getKnowledgeItem', async (_event, itemId: number) => {
    try {
      return { success: true, data: knowledgeService.getItem(itemId) }
    } catch (error) {
      console.error('[Collaboration] getKnowledgeItem failed:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle(
    'collab:createKnowledgeItem',
    async (_event, item: Parameters<typeof knowledgeService.createItem>[0]) => {
      if (!item || typeof item !== 'object') {
        return { success: false, error: 'item is required' }
      }
      if (!item.title || typeof item.title !== 'string' || item.title.trim() === '') {
        return { success: false, error: 'title is required and must be a non-empty string' }
      }
      if (!item.content || typeof item.content !== 'string') {
        return { success: false, error: 'content is required and must be a string' }
      }
      if (!item.type || typeof item.type !== 'string') {
        return { success: false, error: 'type is required and must be a string' }
      }
      try {
        const id = knowledgeService.createItem({ ...item, title: item.title.trim() })
        return { success: true, data: id }
      } catch (error) {
        console.error('[Collaboration] createKnowledgeItem failed:', error)
        return { success: false, error: String(error) }
      }
    }
  )

  ipcMain.handle(
    'collab:updateKnowledgeItem',
    async (_event, itemId: number, updates: Parameters<typeof knowledgeService.updateItem>[1]) => {
      try {
        const ok = knowledgeService.updateItem(itemId, updates)
        return { success: ok }
      } catch (error) {
        console.error('[Collaboration] updateKnowledgeItem failed:', error)
        return { success: false, error: String(error) }
      }
    }
  )

  ipcMain.handle('collab:archiveKnowledgeItem', async (_event, itemId: number) => {
    try {
      const ok = knowledgeService.archiveItem(itemId)
      return { success: ok }
    } catch (error) {
      console.error('[Collaboration] archiveKnowledgeItem failed:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('collab:getKnowledgeCategories', async () => {
    try {
      return { success: true, data: knowledgeService.getCategories() }
    } catch (error) {
      console.error('[Collaboration] getKnowledgeCategories failed:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('collab:markKnowledgeHelpful', async (_event, itemId: number) => {
    try {
      knowledgeService.incrementHelpfulCount(itemId)
      return { success: true }
    } catch (error) {
      console.error('[Collaboration] markKnowledgeHelpful failed:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('collab:incrementKnowledgeView', async (_event, itemId: number) => {
    try {
      knowledgeService.incrementViewCount(itemId)
      return { success: true }
    } catch (error) {
      console.error('[Collaboration] incrementKnowledgeView failed:', error)
      return { success: false, error: String(error) }
    }
  })

  // ==================== 关注点 CRUD ====================

  ipcMain.handle('collab:getFocusItems', async (_event, options?: FocusQueryOptions) => {
    try {
      return { success: true, data: focusService.getFocusItems(options) }
    } catch (error) {
      console.error('[Collaboration] getFocusItems failed:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('collab:createFocusItem', async (_event, item: Parameters<typeof focusService.createFocusItem>[0]) => {
    if (!item || typeof item !== 'object') {
      return { success: false, error: 'item is required' }
    }
    if (!item.title || typeof item.title !== 'string' || item.title.trim() === '') {
      return { success: false, error: 'title is required and must be a non-empty string' }
    }
    if (!item.type || typeof item.type !== 'string') {
      return { success: false, error: 'type is required and must be a string' }
    }
    if (!item.globalUserId || typeof item.globalUserId !== 'string') {
      return { success: false, error: 'globalUserId is required and must be a string' }
    }
    try {
      const id = focusService.createFocusItem({ ...item, title: item.title.trim() })
      return { success: true, data: id }
    } catch (error) {
      console.error('[Collaboration] createFocusItem failed:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle(
    'collab:updateFocusItem',
    async (_event, itemId: number, updates: Parameters<typeof focusService.updateFocusItem>[1]) => {
      try {
        const ok = focusService.updateFocusItem(itemId, updates)
        return { success: ok }
      } catch (error) {
        console.error('[Collaboration] updateFocusItem failed:', error)
        return { success: false, error: String(error) }
      }
    }
  )

  ipcMain.handle('collab:archiveFocusItem', async (_event, itemId: number) => {
    try {
      const ok = focusService.archiveFocusItem(itemId)
      return { success: ok }
    } catch (error) {
      console.error('[Collaboration] archiveFocusItem failed:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('collab:incrementFocusMentionCount', async (_event, focusId: number, sessionId: string) => {
    try {
      focusService.incrementMentionCount(focusId, sessionId)
      return { success: true }
    } catch (error) {
      console.error('[Collaboration] incrementFocusMentionCount failed:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle(
    'collab:addTaskSource',
    async (_event, taskId: number, sessionId: string, messageId: number, messageTs: number, confidence?: number) => {
      try {
        taskService.addTaskSource(taskId, sessionId, messageId, messageTs, confidence)
        return { success: true }
      } catch (error) {
        console.error('[Collaboration] addTaskSource failed:', error)
        return { success: false, error: String(error) }
      }
    }
  )

  ipcMain.handle('collab:getFocusActivity', async (_event, focusId: number, limit?: number) => {
    try {
      return { success: true, data: focusService.getFocusActivity(focusId, limit) }
    } catch (error) {
      console.error('[Collaboration] getFocusActivity failed:', error)
      return { success: false, error: String(error) }
    }
  })

  // ==================== 知识图谱 ====================

  ipcMain.handle('collab:getGraphNodes', async (_event, options?: GraphQueryOptions) => {
    try {
      return { success: true, data: graphService.queryNodes(options) }
    } catch (error) {
      console.error('[Collaboration] getGraphNodes failed:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('collab:getGraphEdges', async (_event, nodeIds: number[]) => {
    if (!Array.isArray(nodeIds)) return { success: false, error: 'nodeIds must be array' }
    try {
      return { success: true, data: graphService.queryEdges(nodeIds) }
    } catch (error) {
      console.error('[Collaboration] getGraphEdges failed:', error)
      return { success: false, error: 'Failed to get graph edges' }
    }
  })

  ipcMain.handle('collab:getGraphStats', async () => {
    try {
      return { success: true, data: graphService.getStats() }
    } catch (error) {
      console.error('[Collaboration] getGraphStats failed:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('collab:upsertGraphNode', async (_event, node: Parameters<typeof graphService.upsertNode>[0]) => {
    if (!node || typeof node !== 'object') {
      return { success: false, error: 'node is required' }
    }
    try {
      const normalized = {
        ...node,
        sourceSessions: node.sourceSessions ?? [],
        sourceMessageRefs: node.sourceMessageRefs ?? [],
      }
      const nodeId = graphService.upsertNode(normalized)
      console.log('[Collaboration] upsertGraphNode:', normalized.name, '→ id', nodeId)
      return { success: true, data: nodeId }
    } catch (error) {
      console.error('[Collaboration] upsertGraphNode failed:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('collab:upsertGraphEdge', async (_event, edge: Parameters<typeof graphService.upsertEdge>[0]) => {
    if (!edge || typeof edge !== 'object') {
      return { success: false, error: 'edge is required' }
    }
    try {
      const normalized = { ...edge, sourceSessions: edge.sourceSessions ?? [] }
      const edgeId = graphService.upsertEdge(normalized)
      console.log('[Collaboration] upsertGraphEdge:', normalized.type, '→ id', edgeId)
      return { success: true, data: edgeId }
    } catch (error) {
      console.error('[Collaboration] upsertGraphEdge failed:', error)
      return { success: false, error: String(error) }
    }
  })

  // 获取会话发言量 Top N 成员（用于身份 Layer 2 Toast）
  ipcMain.handle('collab:getSessionTopMembers', async (_event, sessionId: string, topN: number = 3) => {
    if (typeof sessionId !== 'string' || !sessionId) return { success: false, error: 'invalid sessionId' }
    const safeTopN = Number.isFinite(topN) && topN > 0 ? Math.floor(topN) : 3
    try {
      const db = openDatabase(sessionId, true)
      if (!db) return { success: false, error: 'session not found' }
      try {
        const rows = db
          .prepare(
            `SELECT m.id, COALESCE(m.group_nickname, m.account_name, 'Unknown') AS name,
              COUNT(msg.id) AS message_count
             FROM member m
             LEFT JOIN message msg ON msg.sender_id = m.id
             GROUP BY m.id
             ORDER BY message_count DESC
             LIMIT ?`
          )
          .all(safeTopN) as Array<{ id: number; name: string; message_count: number }>
        return {
          success: true,
          data: rows.map((r) => ({ id: r.id, name: r.name, messageCount: r.message_count })),
        }
      } finally {
        db.close()
      }
    } catch (error) {
      console.error('[Collaboration] getSessionTopMembers failed:', error)
      return { success: false, error: String(error) }
    }
  })

  console.log('[Collaboration] IPC handlers registered')
}

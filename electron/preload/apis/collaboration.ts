/**
 * 协作功能 Preload API
 * 暴露任务管理、提取任务状态等协作功能给渲染进程
 */
import { ipcRenderer } from 'electron'
import type { GlobalTask, TaskQueryOptions } from '../../../electron/main/services/taskService'
import type { ExtractionJob, JobType } from '../../../electron/main/database/global/extraction'
import type { PersonalTodo, TodoQueryOptions } from '../../../electron/main/services/todoService'
import type { KnowledgeItem, KnowledgeQueryOptions } from '../../../electron/main/services/knowledgeService'
import type { FocusItem, FocusQueryOptions } from '../../../electron/main/services/focusService'
import type { GraphNode, GraphEdge, GraphQueryOptions } from '../../../electron/main/services/graphService'

export type { GlobalTask, TaskQueryOptions, ExtractionJob, JobType, PersonalTodo, TodoQueryOptions, KnowledgeItem, KnowledgeQueryOptions, FocusItem, FocusQueryOptions, GraphNode, GraphEdge, GraphQueryOptions }

export interface CollabApiResult<T = void> {
  success: boolean
  data?: T
  error?: string
}

export const collabApi = {
  // ==================== 任务管理 ====================
  getTasks: (options?: TaskQueryOptions): Promise<CollabApiResult<GlobalTask[]>> =>
    ipcRenderer.invoke('collab:getTasks', options),

  getTask: (taskId: number): Promise<CollabApiResult<GlobalTask>> =>
    ipcRenderer.invoke('collab:getTask', taskId),

  createTask: (
    task: Omit<GlobalTask, 'id' | 'createdTs' | 'updatedTs'>
  ): Promise<CollabApiResult<number>> => ipcRenderer.invoke('collab:createTask', task),

  updateTask: (taskId: number, updates: Partial<GlobalTask>): Promise<CollabApiResult> =>
    ipcRenderer.invoke('collab:updateTask', taskId, updates),

  deleteTask: (taskId: number): Promise<CollabApiResult> =>
    ipcRenderer.invoke('collab:deleteTask', taskId),

  getTasksBySession: (sessionId: string): Promise<CollabApiResult<GlobalTask[]>> =>
    ipcRenderer.invoke('collab:getTasksBySession', sessionId),

  // ==================== 提取任务状态 ====================
  getExtractionJobs: (sessionId: string): Promise<CollabApiResult<ExtractionJob[]>> =>
    ipcRenderer.invoke('collab:getExtractionJobs', sessionId),

  getExtractionJob: (jobId: string): Promise<CollabApiResult<ExtractionJob>> =>
    ipcRenderer.invoke('collab:getExtractionJob', jobId),

  createExtractionJob: (
    sessionId: string,
    jobType: JobType,
    forceRerun?: boolean
  ): Promise<CollabApiResult<ExtractionJob>> =>
    ipcRenderer.invoke('collab:createExtractionJob', sessionId, jobType, forceRerun),

  retryExtractionJob: (jobId: string): Promise<CollabApiResult> =>
    ipcRenderer.invoke('collab:retryExtractionJob', jobId),

  getFailedJobs: (limit?: number): Promise<CollabApiResult<ExtractionJob[]>> =>
    ipcRenderer.invoke('collab:getFailedJobs', limit),

  // ==================== 待办管理 ====================
  getTodos: (options?: TodoQueryOptions): Promise<CollabApiResult<PersonalTodo[]>> =>
    ipcRenderer.invoke('collab:getTodos', options),

  getTodo: (todoId: number): Promise<CollabApiResult<PersonalTodo>> =>
    ipcRenderer.invoke('collab:getTodo', todoId),

  createTodo: (
    todo: Partial<Omit<PersonalTodo, 'id' | 'createdTs' | 'updatedTs'>> & { title: string }
  ): Promise<CollabApiResult<number>> => ipcRenderer.invoke('collab:createTodo', todo),

  updateTodo: (todoId: number, updates: Partial<PersonalTodo>): Promise<CollabApiResult> =>
    ipcRenderer.invoke('collab:updateTodo', todoId, updates),

  deleteTodo: (todoId: number): Promise<CollabApiResult> =>
    ipcRenderer.invoke('collab:deleteTodo', todoId),

  syncTodoFromTask: (globalUserId: string, taskId: number): Promise<CollabApiResult<number>> =>
    ipcRenderer.invoke('collab:syncTodoFromTask', globalUserId, taskId),

  // ==================== 知识库 ====================
  getKnowledgeItems: (options?: KnowledgeQueryOptions): Promise<CollabApiResult<KnowledgeItem[]>> =>
    ipcRenderer.invoke('collab:getKnowledgeItems', options),

  getKnowledgeItem: (itemId: number): Promise<CollabApiResult<KnowledgeItem>> =>
    ipcRenderer.invoke('collab:getKnowledgeItem', itemId),

  createKnowledgeItem: (
    item: Omit<KnowledgeItem, 'id' | 'createdTs' | 'updatedTs' | 'viewCount' | 'helpfulCount' | 'version'>
  ): Promise<CollabApiResult<number>> => ipcRenderer.invoke('collab:createKnowledgeItem', item),

  updateKnowledgeItem: (itemId: number, updates: Partial<KnowledgeItem>): Promise<CollabApiResult> =>
    ipcRenderer.invoke('collab:updateKnowledgeItem', itemId, updates),

  archiveKnowledgeItem: (itemId: number): Promise<CollabApiResult> =>
    ipcRenderer.invoke('collab:archiveKnowledgeItem', itemId),

  getKnowledgeCategories: (): Promise<CollabApiResult<Array<{ category: string; count: number }>>> =>
    ipcRenderer.invoke('collab:getKnowledgeCategories'),

  markKnowledgeHelpful: (itemId: number): Promise<CollabApiResult> =>
    ipcRenderer.invoke('collab:markKnowledgeHelpful', itemId),

  incrementKnowledgeView: (itemId: number): Promise<CollabApiResult> =>
    ipcRenderer.invoke('collab:incrementKnowledgeView', itemId),

  // ==================== 关注点 ====================
  getFocusItems: (options?: FocusQueryOptions): Promise<CollabApiResult<FocusItem[]>> =>
    ipcRenderer.invoke('collab:getFocusItems', options),

  createFocusItem: (
    item: Omit<FocusItem, 'id' | 'createdTs' | 'updatedTs' | 'mentionCount' | 'relatedSessionCount'>
  ): Promise<CollabApiResult<number>> => ipcRenderer.invoke('collab:createFocusItem', item),

  updateFocusItem: (itemId: number, updates: Partial<FocusItem>): Promise<CollabApiResult> =>
    ipcRenderer.invoke('collab:updateFocusItem', itemId, updates),

  archiveFocusItem: (itemId: number): Promise<CollabApiResult> =>
    ipcRenderer.invoke('collab:archiveFocusItem', itemId),

  getFocusActivity: (
    focusId: number,
    limit?: number
  ): Promise<CollabApiResult<Array<{ sessionId: string; messageId: number; messageTs: number; relevance: number; summary?: string }>>> =>
    ipcRenderer.invoke('collab:getFocusActivity', focusId, limit),

  // ==================== 知识图谱 ====================
  getGraphNodes: (options?: GraphQueryOptions): Promise<CollabApiResult<GraphNode[]>> =>
    ipcRenderer.invoke('collab:getGraphNodes', options),

  getGraphEdges: (nodeIds: number[]): Promise<CollabApiResult<GraphEdge[]>> =>
    ipcRenderer.invoke('collab:getGraphEdges', nodeIds),

  getGraphStats: (): Promise<CollabApiResult<{ nodeCount: number; edgeCount: number; nodeTypes: Array<{ type: string; count: number }> }>> =>
    ipcRenderer.invoke('collab:getGraphStats'),

  upsertGraphNode: (node: Omit<GraphNode, 'id' | 'occurrenceCount'>): Promise<CollabApiResult<number>> =>
    ipcRenderer.invoke('collab:upsertGraphNode', node),

  upsertGraphEdge: (edge: Omit<GraphEdge, 'id' | 'occurrenceCount'>): Promise<CollabApiResult<number>> =>
    ipcRenderer.invoke('collab:upsertGraphEdge', edge),

  getSessionTopMembers: (
    sessionId: string,
    topN?: number
  ): Promise<CollabApiResult<Array<{ id: number; name: string; messageCount: number }>>> =>
    ipcRenderer.invoke('collab:getSessionTopMembers', sessionId, topN),

  // ==================== 测试辅助（also used by production flows）====================
  incrementFocusMentionCount: (focusId: number, sessionId: string): Promise<CollabApiResult> =>
    ipcRenderer.invoke('collab:incrementFocusMentionCount', focusId, sessionId),

  addTaskSource: (
    taskId: number,
    sessionId: string,
    messageId: number,
    messageTs: number,
    confidence?: number
  ): Promise<CollabApiResult> =>
    ipcRenderer.invoke('collab:addTaskSource', taskId, sessionId, messageId, messageTs, confidence),
}

/** CollabApi 类型，供 Window 接口扩展使用 */
export type CollabApi = typeof collabApi

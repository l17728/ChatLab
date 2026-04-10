/**
 * 全局任务服务
 * 负责任务的 CRUD 操作、跨会话聚合、查询等
 */

import type Database from 'better-sqlite3'
import { getGlobalDb } from '../database/global/index'

export interface TaskParticipant {
  globalUserId: string
  role: string
  sessionId?: string
}

export interface TaskSource {
  sessionId: string
  messageId: number
  messageTs: number
  confidence: number
}

export interface GlobalTask {
  id: number
  title: string
  description?: string
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  priority: 'low' | 'normal' | 'high' | 'urgent'
  ownerGlobalUserId?: string
  ownerDisplayName?: string
  dueTs?: number
  createdTs: number
  updatedTs: number
  completedTs?: number
  confidence: number // 0-1，AI 提取置信度
  isManual: boolean
  tags: string[]
  metadata: Record<string, unknown>
  participants?: TaskParticipant[]
  sources?: TaskSource[]
}

export interface TaskQueryOptions {
  status?: string | string[]
  owner?: string
  sessionId?: string
  priority?: string | string[]
  dueBefore?: number
  dueAfter?: number
  limit?: number
  offset?: number
  sortBy?: 'created' | 'due' | 'updated'
  sortOrder?: 'asc' | 'desc'
}

export class TaskService {
  private db: Database.Database

  constructor() {
    this.db = getGlobalDb('collaboration')
  }

  /**
   * 创建任务
   */
  createTask(task: Omit<GlobalTask, 'id' | 'createdTs' | 'updatedTs'>): number {
    const now = Date.now()

    const stmt = this.db.prepare(`
      INSERT INTO global_task (
        title, description, status, priority, owner_global_user_id,
        owner_display_name, due_ts, created_ts, updated_ts,
        confidence, is_manual, tags, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const result = stmt.run(
      task.title,
      task.description || null,
      task.status,
      task.priority,
      task.ownerGlobalUserId || null,
      task.ownerDisplayName || null,
      task.dueTs || null,
      now,
      now,
      task.confidence,
      task.isManual ? 1 : 0,
      JSON.stringify(task.tags),
      JSON.stringify(task.metadata)
    )

    return result.lastInsertRowid as number
  }

  /**
   * 获取任务
   */
  getTask(taskId: number): GlobalTask | null {
    const row = this.db
      .prepare('SELECT * FROM global_task WHERE id = ?')
      .get(taskId) as any

    if (!row) return null
    const task = this.parseTask(row)
    task.participants = this.getParticipants(taskId)
    task.sources = this.getSources(taskId)
    return task
  }

  /**
   * 更新任务
   */
  updateTask(taskId: number, updates: Partial<GlobalTask>): boolean {
    const now = Date.now()
    const current = this.getTask(taskId)

    if (!current) return false

    const merged = { ...current, ...updates, updatedTs: now }

    const stmt = this.db.prepare(`
      UPDATE global_task SET
        title = ?, description = ?, status = ?, priority = ?,
        owner_global_user_id = ?, owner_display_name = ?, due_ts = ?,
        completed_ts = ?, confidence = ?, is_manual = ?,
        tags = ?, metadata = ?, updated_ts = ?
      WHERE id = ?
    `)

    const result = stmt.run(
      merged.title,
      merged.description || null,
      merged.status,
      merged.priority,
      merged.ownerGlobalUserId || null,
      merged.ownerDisplayName || null,
      merged.dueTs || null,
      merged.completedTs || null,
      merged.confidence,
      merged.isManual ? 1 : 0,
      JSON.stringify(merged.tags),
      JSON.stringify(merged.metadata),
      now,
      taskId
    )

    // 如果是手动编辑，记录编辑历史
    if (updates.isManual) {
      Object.keys(updates).forEach((key) => {
        if (key !== 'isManual' && current[key as keyof GlobalTask] !== updates[key as keyof GlobalTask]) {
          this.recordEditHistory(taskId, key, String(current[key as keyof GlobalTask]), String(updates[key as keyof GlobalTask]), 'manual')
        }
      })
    }

    return result.changes > 0
  }

  /**
   * 删除任务
   */
  deleteTask(taskId: number): boolean {
    const stmt = this.db.prepare('DELETE FROM global_task WHERE id = ?')
    const result = stmt.run(taskId)
    return result.changes > 0
  }

  /**
   * 查询任务
   */
  queryTasks(options: TaskQueryOptions = {}): GlobalTask[] {
    let query = 'SELECT * FROM global_task WHERE 1=1'
    const params: any[] = []

    if (options.status) {
      const statuses = Array.isArray(options.status) ? options.status : [options.status]
      query += ` AND status IN (${statuses.map(() => '?').join(',')})`
      params.push(...statuses)
    }

    if (options.owner) {
      query += ' AND owner_global_user_id = ?'
      params.push(options.owner)
    }

    if (options.priority) {
      const priorities = Array.isArray(options.priority) ? options.priority : [options.priority]
      query += ` AND priority IN (${priorities.map(() => '?').join(',')})`
      params.push(...priorities)
    }

    if (options.dueBefore) {
      query += ' AND due_ts <= ?'
      params.push(options.dueBefore)
    }

    if (options.dueAfter) {
      query += ' AND due_ts >= ?'
      params.push(options.dueAfter)
    }

    // 排序（使用白名单防止 SQL 注入）
    const sortByMap: Record<string, string> = {
      created: 'created_ts',
      due: 'due_ts',
      updated: 'updated_ts',
    }
    const sortColumn = sortByMap[options.sortBy || 'created'] || 'created_ts'
    const sortDir = options.sortOrder === 'asc' ? 'ASC' : 'DESC'
    query += ` ORDER BY ${sortColumn} ${sortDir}`

    // 分页（使用参数化防止 SQL 注入）
    if (options.limit !== undefined && options.limit > 0) {
      query += ' LIMIT ?'
      params.push(Math.trunc(options.limit))
      if (options.offset !== undefined && options.offset > 0) {
        query += ' OFFSET ?'
        params.push(Math.trunc(options.offset))
      }
    }

    const rows = this.db.prepare(query).all(...params) as any[]
    return this.attachRelations(rows.map((row) => this.parseTask(row)))
  }

  /**
   * 获取会话的所有任务
   */
  getTasksBySession(sessionId: string, status?: string): GlobalTask[] {
    let query = `
      SELECT DISTINCT gt.* FROM global_task gt
      JOIN task_source ts ON gt.id = ts.task_id
      WHERE ts.session_id = ?
    `
    const params: any[] = [sessionId]

    if (status) {
      query += ' AND gt.status = ?'
      params.push(status)
    }

    query += ' ORDER BY gt.created_ts DESC'

    const rows = this.db.prepare(query).all(...params) as any[]
    return this.attachRelations(rows.map((row) => this.parseTask(row)))
  }

  /**
   * 添加任务来源
   */
  addTaskSource(
    taskId: number,
    sessionId: string,
    messageId: number,
    messageTs: number,
    confidence: number = 1.0
  ): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO task_source (
        task_id, session_id, message_id, message_ts, extracted_ts, confidence
      ) VALUES (?, ?, ?, ?, ?, ?)
    `)

    stmt.run(taskId, sessionId, messageId, messageTs, Date.now(), confidence)
  }

  /**
   * 添加任务参与者
   */
  addTaskParticipant(taskId: number, globalUserId: string, role: string = 'collaborator', sessionId?: string): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO task_participant (
        task_id, global_user_id, role, session_id
      ) VALUES (?, ?, ?, ?)
    `)

    stmt.run(taskId, globalUserId, role, sessionId || null)
  }

  /**
   * 记录编辑历史
   */
  private recordEditHistory(taskId: number, field: string, oldValue: string, newValue: string, editedBy: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO task_edit_history (
        task_id, field, old_value, new_value, edited_by, edited_ts
      ) VALUES (?, ?, ?, ?, ?, ?)
    `)

    stmt.run(taskId, field, oldValue, newValue, editedBy, Date.now())
  }

  /**
   * 获取编辑历史
   */
  getEditHistory(taskId: number, limit: number = 20): any[] {
    const stmt = this.db.prepare(`
      SELECT * FROM task_edit_history
      WHERE task_id = ?
      ORDER BY edited_ts DESC
      LIMIT ?
    `)

    return stmt.all(taskId, limit) as any[]
  }

  /**
   * 解析数据库行
   */
  private parseTask(row: any): GlobalTask {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      status: row.status,
      priority: row.priority,
      ownerGlobalUserId: row.owner_global_user_id,
      ownerDisplayName: row.owner_display_name,
      dueTs: row.due_ts,
      createdTs: row.created_ts,
      updatedTs: row.updated_ts,
      completedTs: row.completed_ts,
      confidence: row.confidence,
      isManual: row.is_manual === 1,
      tags: row.tags ? JSON.parse(row.tags) : [],
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
    }
  }

  /**
   * 获取任务参与者
   */
  private getParticipants(taskId: number): TaskParticipant[] {
    const rows = this.db
      .prepare('SELECT global_user_id, role, session_id FROM task_participant WHERE task_id = ?')
      .all(taskId) as any[]
    return rows.map((r) => ({
      globalUserId: r.global_user_id,
      role: r.role,
      sessionId: r.session_id ?? undefined,
    }))
  }

  /**
   * 获取任务来源
   */
  private getSources(taskId: number): TaskSource[] {
    const rows = this.db
      .prepare('SELECT session_id, message_id, message_ts, confidence FROM task_source WHERE task_id = ?')
      .all(taskId) as any[]
    return rows.map((r) => ({
      sessionId: r.session_id,
      messageId: r.message_id,
      messageTs: r.message_ts,
      confidence: r.confidence,
    }))
  }

  /**
   * 为任务列表批量附加参与者和来源数据（避免 N+1 查询）
   */
  private attachRelations(tasks: GlobalTask[]): GlobalTask[] {
    if (tasks.length === 0) return tasks

    const ids = tasks.map((t) => t.id)
    const placeholders = ids.map(() => '?').join(',')

    // 批量查询参与者
    const participantRows = this.db
      .prepare(`SELECT task_id, global_user_id, role, session_id FROM task_participant WHERE task_id IN (${placeholders})`)
      .all(...ids) as any[]
    const participantsByTaskId = new Map<number, TaskParticipant[]>()
    for (const r of participantRows) {
      if (!participantsByTaskId.has(r.task_id)) participantsByTaskId.set(r.task_id, [])
      participantsByTaskId.get(r.task_id)!.push({
        globalUserId: r.global_user_id,
        role: r.role,
        sessionId: r.session_id ?? undefined,
      })
    }

    // 批量查询来源
    const sourceRows = this.db
      .prepare(`SELECT task_id, session_id, message_id, message_ts, confidence FROM task_source WHERE task_id IN (${placeholders})`)
      .all(...ids) as any[]
    const sourcesByTaskId = new Map<number, TaskSource[]>()
    for (const r of sourceRows) {
      if (!sourcesByTaskId.has(r.task_id)) sourcesByTaskId.set(r.task_id, [])
      sourcesByTaskId.get(r.task_id)!.push({
        sessionId: r.session_id,
        messageId: r.message_id,
        messageTs: r.message_ts,
        confidence: r.confidence,
      })
    }

    for (const task of tasks) {
      task.participants = participantsByTaskId.get(task.id) || []
      task.sources = sourcesByTaskId.get(task.id) || []
    }
    return tasks
  }
}

// 导出单例
export const taskService = new TaskService()

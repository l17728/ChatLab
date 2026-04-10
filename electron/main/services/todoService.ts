/**
 * 个人待办服务
 * 负责个人 personal_todo 的 CRUD 操作，支持跨会话聚合
 */

import type Database from 'better-sqlite3'
import { getGlobalDb } from '../database/global/index'

export interface PersonalTodo {
  id: number
  globalUserId: string
  taskId?: number
  taskTitle?: string
  title: string
  description?: string
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  priority: 'low' | 'normal' | 'high' | 'urgent'
  progress: number
  dueTs?: number
  reminderTs?: number
  notes?: string
  tags: string[]
  isStarred: boolean
  createdTs: number
  updatedTs: number
  completedTs?: number
  sourceType: 'task' | 'manual'
  sourceSessionId?: string
}

export interface TodoQueryOptions {
  globalUserId?: string
  status?: string | string[]
  priority?: string | string[]
  isStarred?: boolean
  sourceType?: 'task' | 'manual'
  dueBefore?: number
  dueAfter?: number
  limit?: number
  offset?: number
  sortBy?: 'created' | 'due' | 'updated' | 'priority'
  sortOrder?: 'asc' | 'desc'
}

export class TodoService {
  private db: Database.Database

  constructor() {
    this.db = getGlobalDb('collaboration')
  }

  /**
   * 创建待办
   */
  createTodo(todo: Omit<PersonalTodo, 'id' | 'createdTs' | 'updatedTs'>): number {
    const now = Date.now()

    const stmt = this.db.prepare(`
      INSERT INTO personal_todo (
        global_user_id, task_id, task_title, title, description,
        status, priority, progress, due_ts, reminder_ts, notes, tags, is_starred,
        created_ts, updated_ts, source_type, source_session_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const result = stmt.run(
      todo.globalUserId,
      todo.taskId || null,
      todo.taskTitle || null,
      todo.title,
      todo.description || null,
      todo.status,
      todo.priority,
      todo.progress ?? 0,
      todo.dueTs || null,
      todo.reminderTs || null,
      todo.notes || null,
      JSON.stringify(todo.tags),
      todo.isStarred ? 1 : 0,
      now,
      now,
      todo.sourceType,
      todo.sourceSessionId || null
    )

    return result.lastInsertRowid as number
  }

  /**
   * 更新待办
   */
  updateTodo(id: number, updates: Partial<Omit<PersonalTodo, 'id' | 'createdTs'>>): boolean {
    const now = Date.now()
    const fields: string[] = []
    const values: unknown[] = []

    if (updates.title !== undefined) {
      fields.push('title = ?')
      values.push(updates.title)
    }
    if (updates.description !== undefined) {
      fields.push('description = ?')
      values.push(updates.description)
    }
    if (updates.status !== undefined) {
      fields.push('status = ?')
      values.push(updates.status)
      if (updates.status === 'completed') {
        fields.push('completed_ts = ?')
        values.push(now)
      }
    }
    if (updates.priority !== undefined) {
      fields.push('priority = ?')
      values.push(updates.priority)
    }
    if (updates.progress !== undefined) {
      fields.push('progress = ?')
      values.push(Math.min(100, Math.max(0, Math.round(updates.progress))))
    }
    if (updates.dueTs !== undefined) {
      fields.push('due_ts = ?')
      values.push(updates.dueTs)
    }
    if (updates.reminderTs !== undefined) {
      fields.push('reminder_ts = ?')
      values.push(updates.reminderTs)
    }
    if (updates.notes !== undefined) {
      fields.push('notes = ?')
      values.push(updates.notes)
    }
    if (updates.tags !== undefined) {
      fields.push('tags = ?')
      values.push(JSON.stringify(updates.tags))
    }
    if (updates.isStarred !== undefined) {
      fields.push('is_starred = ?')
      values.push(updates.isStarred ? 1 : 0)
    }

    if (fields.length === 0) return false

    fields.push('updated_ts = ?')
    values.push(now)
    values.push(id)

    const result = this.db.prepare(`UPDATE personal_todo SET ${fields.join(', ')} WHERE id = ?`).run(...values)
    return result.changes > 0
  }

  /**
   * 删除待办
   */
  deleteTodo(id: number): boolean {
    const result = this.db.prepare('DELETE FROM personal_todo WHERE id = ?').run(id)
    return result.changes > 0
  }

  /**
   * 获取单个待办
   */
  getTodo(id: number): PersonalTodo | null {
    const row = this.db.prepare('SELECT * FROM personal_todo WHERE id = ?').get(id) as any
    return row ? this.mapRow(row) : null
  }

  /**
   * 查询待办列表
   */
  getTodos(options: TodoQueryOptions = {}): PersonalTodo[] {
    const conditions: string[] = []
    const params: unknown[] = []

    if (options.globalUserId) {
      conditions.push('global_user_id = ?')
      params.push(options.globalUserId)
    }

    if (options.status) {
      const statuses = Array.isArray(options.status) ? options.status : [options.status]
      conditions.push(`status IN (${statuses.map(() => '?').join(',')})`)
      params.push(...statuses)
    }

    if (options.priority) {
      const priorities = Array.isArray(options.priority) ? options.priority : [options.priority]
      conditions.push(`priority IN (${priorities.map(() => '?').join(',')})`)
      params.push(...priorities)
    }

    if (options.isStarred !== undefined) {
      conditions.push('is_starred = ?')
      params.push(options.isStarred ? 1 : 0)
    }

    if (options.sourceType) {
      conditions.push('source_type = ?')
      params.push(options.sourceType)
    }

    if (options.dueBefore !== undefined) {
      conditions.push('due_ts <= ?')
      params.push(options.dueBefore)
    }

    if (options.dueAfter !== undefined) {
      conditions.push('due_ts >= ?')
      params.push(options.dueAfter)
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const sortCol = options.sortBy === 'due' ? 'due_ts' : options.sortBy === 'updated' ? 'updated_ts' : 'created_ts'
    const sortDir = options.sortOrder === 'asc' ? 'ASC' : 'DESC'
    const limit = options.limit ? `LIMIT ${options.limit}` : ''
    const offset = options.offset ? `OFFSET ${options.offset}` : ''

    const rows = this.db.prepare(`
      SELECT * FROM personal_todo ${where}
      ORDER BY ${sortCol} ${sortDir}
      ${limit} ${offset}
    `).all(...params) as any[]

    return rows.map(this.mapRow)
  }

  /**
   * 从任务同步到待办
   */
  syncFromTask(
    globalUserId: string,
    taskId: number,
    taskTitle: string,
    taskData: {
      status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
      priority: 'low' | 'normal' | 'high' | 'urgent'
      description?: string
      dueTs?: number
      sourceSessionId?: string
    }
  ): number {
    const existing = this.db
      .prepare('SELECT id FROM personal_todo WHERE global_user_id = ? AND task_id = ?')
      .get(globalUserId, taskId) as any

    if (existing) {
      this.updateTodo(existing.id, {
        status: taskData.status,
        priority: taskData.priority,
        description: taskData.description,
        dueTs: taskData.dueTs,
      })
      return existing.id
    }

    return this.createTodo({
      globalUserId,
      taskId,
      taskTitle,
      title: taskTitle,
      description: taskData.description,
      status: taskData.status,
      priority: taskData.priority,
      progress: 0,
      dueTs: taskData.dueTs,
      tags: [],
      isStarred: false,
      sourceType: 'task',
      sourceSessionId: taskData.sourceSessionId,
    })
  }

  private mapRow(row: any): PersonalTodo {
    return {
      id: row.id,
      globalUserId: row.global_user_id,
      taskId: row.task_id || undefined,
      taskTitle: row.task_title || undefined,
      title: row.title,
      description: row.description || undefined,
      status: row.status,
      priority: row.priority,
      progress: row.progress ?? 0,
      dueTs: row.due_ts || undefined,
      reminderTs: row.reminder_ts || undefined,
      notes: row.notes || undefined,
      tags: row.tags ? JSON.parse(row.tags) : [],
      isStarred: Boolean(row.is_starred),
      createdTs: row.created_ts,
      updatedTs: row.updated_ts,
      completedTs: row.completed_ts || undefined,
      sourceType: row.source_type,
      sourceSessionId: row.source_session_id || undefined,
    }
  }
}

export const todoService = new TodoService()

/**
 * 知识库服务
 * 负责知识条目的 CRUD 操作、分类查询、搜索等
 */

import type Database from 'better-sqlite3'
import { getGlobalDb } from '../database/global/index'

export interface KnowledgeItem {
  id: number
  type: 'faq' | 'document' | 'concept' | 'procedure' | 'tip' | 'qa'
  title: string
  content: string
  summary?: string
  category?: string
  tags: string[]
  sourceSessionIds: string[]
  sourceMessageRefs: Array<{ sessionId: string; messageId: number }>
  confidence: number
  isEdited: boolean
  viewCount: number
  helpfulCount: number
  status: 'active' | 'archived'
  createdTs: number
  updatedTs: number
  version: number
  parentId?: number
}

export interface KnowledgeQueryOptions {
  type?: string | string[]
  category?: string
  status?: string
  searchText?: string
  sessionId?: string
  limit?: number
  offset?: number
  sortBy?: 'created' | 'updated' | 'helpful' | 'views'
  sortOrder?: 'asc' | 'desc'
}

export class KnowledgeService {
  private db: Database.Database

  constructor() {
    this.db = getGlobalDb('collaboration')
  }

  /**
   * 创建知识条目
   */
  createItem(item: Omit<KnowledgeItem, 'id' | 'createdTs' | 'updatedTs' | 'viewCount' | 'helpfulCount' | 'version'>): number {
    const now = Date.now()
    const stmt = this.db.prepare(`
      INSERT INTO knowledge_item (
        type, title, content, summary, category, tags,
        source_session_ids, source_message_refs, confidence,
        is_edited, status, created_ts, updated_ts, version, parent_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 1, ?)
    `)

    const result = stmt.run(
      item.type,
      item.title,
      item.content,
      item.summary || null,
      item.category || null,
      JSON.stringify(item.tags),
      JSON.stringify(item.sourceSessionIds),
      JSON.stringify(item.sourceMessageRefs),
      item.confidence,
      item.status,
      now,
      now,
      item.parentId || null
    )

    const knowledgeId = result.lastInsertRowid as number

    // 同步写入 knowledge_source 关系表
    if (item.sourceSessionIds.length > 0) {
      const insertSource = this.db.prepare(
        'INSERT OR IGNORE INTO knowledge_source (knowledge_id, session_id, message_id) VALUES (?, ?, ?)'
      )
      const insertMany = this.db.transaction((entries: Array<{ sessionId: string; messageId?: number }>) => {
        for (const e of entries) {
          insertSource.run(knowledgeId, e.sessionId, e.messageId ?? null)
        }
      })
      // 从 sourceMessageRefs 中获取 messageId（若有）；否则只插 sessionId
      const refMap = new Map(item.sourceMessageRefs.map((r) => [r.sessionId, r.messageId]))
      insertMany(item.sourceSessionIds.map((sid) => ({ sessionId: sid, messageId: refMap.get(sid) })))
    }

    return knowledgeId
  }

  /**
   * 更新知识条目
   */
  updateItem(id: number, updates: Partial<Omit<KnowledgeItem, 'id' | 'createdTs'>>): boolean {
    const now = Date.now()
    const fields: string[] = []
    const values: unknown[] = []

    if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title) }
    if (updates.content !== undefined) { fields.push('content = ?'); values.push(updates.content) }
    if (updates.summary !== undefined) { fields.push('summary = ?'); values.push(updates.summary) }
    if (updates.category !== undefined) { fields.push('category = ?'); values.push(updates.category) }
    if (updates.tags !== undefined) { fields.push('tags = ?'); values.push(JSON.stringify(updates.tags)) }
    if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status) }
    if (updates.isEdited !== undefined) { fields.push('is_edited = ?'); values.push(updates.isEdited ? 1 : 0) }

    if (fields.length === 0) return false

    fields.push('updated_ts = ?')
    values.push(now)
    values.push(id)

    const result = this.db.prepare(`UPDATE knowledge_item SET ${fields.join(', ')} WHERE id = ?`).run(...values)
    return result.changes > 0
  }

  /**
   * 删除知识条目（软删除）
   */
  archiveItem(id: number): boolean {
    const result = this.db.prepare(`UPDATE knowledge_item SET status = 'archived', updated_ts = ? WHERE id = ?`).run(Date.now(), id)
    return result.changes > 0
  }

  /**
   * 获取单个知识条目
   */
  getItem(id: number): KnowledgeItem | null {
    const row = this.db.prepare('SELECT * FROM knowledge_item WHERE id = ?').get(id) as any
    return row ? this.mapRow(row) : null
  }

  /**
   * 查询知识条目列表
   */
  queryItems(options: KnowledgeQueryOptions = {}): KnowledgeItem[] {
    const conditions: string[] = []
    const params: unknown[] = []

    const status = options.status || 'active'
    conditions.push('status = ?')
    params.push(status)

    if (options.type) {
      const types = Array.isArray(options.type) ? options.type : [options.type]
      conditions.push(`type IN (${types.map(() => '?').join(',')})`)
      params.push(...types)
    }

    if (options.category) {
      conditions.push('category = ?')
      params.push(options.category)
    }

    if (options.searchText) {
      conditions.push('(title LIKE ? OR content LIKE ? OR summary LIKE ?)')
      const like = `%${options.searchText}%`
      params.push(like, like, like)
    }

    if (options.sessionId) {
      conditions.push('source_session_ids LIKE ?')
      params.push(`%${options.sessionId}%`)
    }

    const where = `WHERE ${conditions.join(' AND ')}`
    const sortCol = options.sortBy === 'helpful' ? 'helpful_count'
      : options.sortBy === 'views' ? 'view_count'
      : options.sortBy === 'updated' ? 'updated_ts'
      : 'created_ts'
    const sortDir = options.sortOrder === 'asc' ? 'ASC' : 'DESC'
    const limit = options.limit ? `LIMIT ${options.limit}` : 'LIMIT 100'
    const offset = options.offset ? `OFFSET ${options.offset}` : ''

    const rows = this.db.prepare(`
      SELECT * FROM knowledge_item ${where}
      ORDER BY ${sortCol} ${sortDir}
      ${limit} ${offset}
    `).all(...params) as any[]

    return rows.map(this.mapRow)
  }

  /**
   * 获取所有分类
   */
  getCategories(): Array<{ category: string; count: number }> {
    return this.db.prepare(`
      SELECT category, COUNT(*) as count FROM knowledge_item
      WHERE status = 'active' AND category IS NOT NULL
      GROUP BY category ORDER BY count DESC
    `).all() as any[]
  }

  /**
   * 增加查看次数
   */
  incrementViewCount(id: number): void {
    this.db.prepare('UPDATE knowledge_item SET view_count = view_count + 1 WHERE id = ?').run(id)
  }

  /**
   * 增加有用标记
   */
  incrementHelpfulCount(id: number): void {
    this.db.prepare('UPDATE knowledge_item SET helpful_count = helpful_count + 1 WHERE id = ?').run(id)
  }

  private mapRow(row: any): KnowledgeItem {
    return {
      id: row.id,
      type: row.type,
      title: row.title,
      content: row.content,
      summary: row.summary || undefined,
      category: row.category || undefined,
      tags: row.tags ? JSON.parse(row.tags) : [],
      sourceSessionIds: row.source_session_ids ? JSON.parse(row.source_session_ids) : [],
      sourceMessageRefs: row.source_message_refs ? JSON.parse(row.source_message_refs) : [],
      confidence: row.confidence,
      isEdited: Boolean(row.is_edited),
      viewCount: row.view_count,
      helpfulCount: row.helpful_count,
      status: row.status,
      createdTs: row.created_ts,
      updatedTs: row.updated_ts,
      version: row.version,
      parentId: row.parent_id || undefined,
    }
  }
}

export const knowledgeService = new KnowledgeService()

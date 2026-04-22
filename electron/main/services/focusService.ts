/**
 * 关注点服务
 * 负责用户关注事项的管理，支持跨会话追踪
 */

import type Database from 'better-sqlite3'
import { getGlobalDb } from '../database/global/index'

function safeJsonParse<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback
  try {
    return JSON.parse(json)
  } catch {
    return fallback
  }
}

export interface FocusItem {
  id: number
  globalUserId: string
  type: 'topic' | 'person' | 'task' | 'project' | 'keyword'
  title: string
  description?: string
  keywords: string[]
  color?: string
  mentionCount: number
  relatedSessionCount: number
  status: 'active' | 'archived'
  lastActivityTs?: number
  lastSummary?: string
  createdTs: number
  updatedTs: number
}

export interface FocusQueryOptions {
  globalUserId?: string
  type?: string | string[]
  status?: string
  limit?: number
  offset?: number
}

export class FocusService {
  private db: Database.Database

  constructor() {
    this.db = getGlobalDb('collaboration')
  }

  /**
   * 按 (globalUserId, type, 归一化标题) 查找已存在关注点，跨批次去重。
   */
  findIdByNormalizedTitle(globalUserId: string, type: string, title: string): number | null {
    // 归一化规则与 SQLite `LOWER(TRIM(title))` 严格一致，让 idx_focus_norm_title 命中
    const normalized = title.trim().toLowerCase()
    if (!normalized) return null
    const row = this.db
      .prepare(
        `SELECT id FROM focus_item
         WHERE global_user_id = ? AND type = ? AND LOWER(TRIM(title)) = ?
         LIMIT 1`
      )
      .get(globalUserId, type, normalized) as { id: number } | undefined
    return row?.id ?? null
  }

  /**
   * 创建关注点
   */
  createFocusItem(
    item: Omit<FocusItem, 'id' | 'createdTs' | 'updatedTs' | 'mentionCount' | 'relatedSessionCount'>
  ): number {
    const now = Date.now()
    const stmt = this.db.prepare(`
      INSERT INTO focus_item (
        global_user_id, type, title, description, keywords, color,
        mention_count, related_session_count, status, last_activity_ts,
        last_summary, created_ts, updated_ts
      ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?)
    `)

    const result = stmt.run(
      item.globalUserId,
      item.type,
      item.title,
      item.description || null,
      JSON.stringify(item.keywords),
      item.color || null,
      item.status,
      item.lastActivityTs ?? null,
      item.lastSummary || null,
      now,
      now
    )

    return result.lastInsertRowid as number
  }

  /**
   * 更新关注点
   */
  updateFocusItem(id: number, updates: Partial<Omit<FocusItem, 'id' | 'createdTs'>>): boolean {
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
    if (updates.keywords !== undefined) {
      fields.push('keywords = ?')
      values.push(JSON.stringify(updates.keywords))
    }
    if (updates.color !== undefined) {
      fields.push('color = ?')
      values.push(updates.color)
    }
    if (updates.status !== undefined) {
      fields.push('status = ?')
      values.push(updates.status)
    }
    if (updates.lastSummary !== undefined) {
      fields.push('last_summary = ?')
      values.push(updates.lastSummary)
    }
    if (updates.lastActivityTs !== undefined) {
      fields.push('last_activity_ts = ?')
      values.push(updates.lastActivityTs)
    }

    if (fields.length === 0) return false

    fields.push('updated_ts = ?')
    values.push(now)
    values.push(id)

    const result = this.db.prepare(`UPDATE focus_item SET ${fields.join(', ')} WHERE id = ?`).run(...values)
    return result.changes > 0
  }

  /**
   * 删除关注点（软删除）
   */
  archiveFocusItem(id: number): boolean {
    const result = this.db
      .prepare(`UPDATE focus_item SET status = 'archived', updated_ts = ? WHERE id = ?`)
      .run(Date.now(), id)
    return result.changes > 0
  }

  /**
   * 获取关注点列表
   */
  getFocusItems(options: FocusQueryOptions = {}): FocusItem[] {
    const conditions: string[] = []
    const params: unknown[] = []

    if (options.globalUserId) {
      conditions.push('global_user_id = ?')
      params.push(options.globalUserId)
    }

    const status = options.status || 'active'
    conditions.push('status = ?')
    params.push(status)

    if (options.type) {
      const types = Array.isArray(options.type) ? options.type : [options.type]
      conditions.push(`type IN (${types.map(() => '?').join(',')})`)
      params.push(...types)
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    let sql = `SELECT * FROM focus_item ${where} ORDER BY last_activity_ts DESC, created_ts DESC`
    if (options.limit !== undefined && options.limit > 0) {
      sql += ' LIMIT ?'
      params.push(Math.trunc(options.limit))
      if (options.offset !== undefined && options.offset > 0) {
        sql += ' OFFSET ?'
        params.push(Math.trunc(options.offset))
      }
    } else {
      sql += ' LIMIT 100'
    }

    const rows = this.db.prepare(sql).all(...params) as any[]

    return rows.map((row) => this.mapRow(row))
  }

  /**
   * 增加提及计数（原子事务）
   */
  incrementMentionCount(id: number, _sessionId: string): void {
    const now = Date.now()
    this.db.transaction(() => {
      this.db
        .prepare(
          `
        UPDATE focus_item SET
          mention_count = mention_count + 1,
          last_activity_ts = ?,
          updated_ts = ?
        WHERE id = ?
      `
        )
        .run(now, now, id)

      // 计算关联会话数（在同一事务内保证一致性）
      const sessionCount =
        (
          this.db
            .prepare(
              `
        SELECT COUNT(DISTINCT session_id) as cnt FROM focus_message_link WHERE focus_id = ?
      `
            )
            .get(id) as any
        )?.cnt || 0

      this.db.prepare('UPDATE focus_item SET related_session_count = ? WHERE id = ?').run(sessionCount, id)
    })()
  }

  private mapRow(row: any): FocusItem {
    return {
      id: row.id,
      globalUserId: row.global_user_id,
      type: row.type,
      title: row.title,
      description: row.description || undefined,
      keywords: safeJsonParse(row.keywords, []),
      color: row.color || undefined,
      mentionCount: row.mention_count,
      relatedSessionCount: row.related_session_count,
      status: row.status,
      lastActivityTs: row.last_activity_ts ?? undefined,
      lastSummary: row.last_summary || undefined,
      createdTs: row.created_ts,
      updatedTs: row.updated_ts,
    }
  }

  /**
   * 获取关注点的动态（跨会话提及记录）
   */
  getFocusActivity(
    focusId: number,
    limit: number = 20
  ): Array<{
    sessionId: string
    messageId: number
    messageTs: number
    relevance: number
    summary?: string
  }> {
    const rows = this.db
      .prepare(
        `SELECT session_id, message_id, message_ts, relevance, summary
         FROM focus_message_link
         WHERE focus_id = ?
         ORDER BY message_ts DESC
         LIMIT ?`
      )
      .all(focusId, limit) as any[]
    return rows.map((r) => ({
      sessionId: r.session_id,
      messageId: r.message_id,
      messageTs: r.message_ts,
      relevance: r.relevance,
      summary: r.summary || undefined,
    }))
  }
}

export const focusService = new FocusService()

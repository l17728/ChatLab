/**
 * 知识图谱服务
 * 负责图节点和边的 CRUD 操作，支持跨会话知识图谱构建
 */

import type Database from 'better-sqlite3'
import { getGlobalDb } from '../database/global/index'

export interface GraphNode {
  id: number
  type: string
  isCoreType: boolean
  name: string
  displayName?: string
  properties: Record<string, unknown>
  firstSeenTs: number
  lastSeenTs: number
  occurrenceCount: number
  sourceSessions: string[]
  sourceMessageRefs: Array<{ sessionId: string; messageId: number }>
  confidence: number
  color?: string
  icon?: string
}

export interface GraphEdge {
  id: number
  type: string
  isCoreType: boolean
  sourceNodeId: number
  targetNodeId: number
  properties: Record<string, unknown>
  firstSeenTs: number
  lastSeenTs: number
  occurrenceCount: number
  sourceSessions: string[]
  confidence: number
}

export interface GraphQueryOptions {
  types?: string[]
  sessionId?: string
  fromTs?: number
  toTs?: number
  limit?: number
  nodeIds?: number[]
}

export class GraphService {
  private db: Database.Database

  constructor() {
    this.db = getGlobalDb('knowledge_graph')
  }

  /**
   * 添加或更新节点（upsert）
   */
  upsertNode(node: Omit<GraphNode, 'id' | 'occurrenceCount'>): number {
    const existing = this.db.prepare('SELECT id, occurrence_count FROM graph_node WHERE type = ? AND name = ?').get(node.type, node.name) as any

    if (existing) {
      // 合并 sourceSessions（保留历史会话，追加新会话）
      const existingRow = this.db.prepare('SELECT source_sessions FROM graph_node WHERE id = ?').get(existing.id) as any
      const existingSessions: string[] = existingRow?.source_sessions ? JSON.parse(existingRow.source_sessions) : []
      const mergedSessions = Array.from(new Set([...existingSessions, ...node.sourceSessions]))

      this.db.prepare(`
        UPDATE graph_node SET
          last_seen_ts = ?,
          occurrence_count = occurrence_count + 1,
          confidence = MAX(confidence, ?),
          source_sessions = ?
        WHERE id = ?
      `).run(node.lastSeenTs, node.confidence, JSON.stringify(mergedSessions), existing.id)
      return existing.id
    }

    const stmt = this.db.prepare(`
      INSERT INTO graph_node (
        type, is_core_type, name, display_name, properties,
        first_seen_ts, last_seen_ts, occurrence_count, source_sessions,
        source_message_refs, confidence, color, icon
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
    `)

    const result = stmt.run(
      node.type,
      node.isCoreType ? 1 : 0,
      node.name,
      node.displayName || null,
      JSON.stringify(node.properties),
      node.firstSeenTs,
      node.lastSeenTs,
      JSON.stringify(node.sourceSessions),
      JSON.stringify(node.sourceMessageRefs),
      node.confidence,
      node.color || null,
      node.icon || null
    )

    return result.lastInsertRowid as number
  }

  /**
   * 添加或更新边（upsert）
   */
  upsertEdge(edge: Omit<GraphEdge, 'id' | 'occurrenceCount'>): number {
    const existing = this.db.prepare(
      'SELECT id FROM graph_edge WHERE source_node_id = ? AND target_node_id = ? AND type = ?'
    ).get(edge.sourceNodeId, edge.targetNodeId, edge.type) as any

    if (existing) {
      // 合并 sourceSessions（保留历史会话）
      const existingRow = this.db.prepare('SELECT source_sessions FROM graph_edge WHERE id = ?').get(existing.id) as any
      const existingSessions: string[] = existingRow?.source_sessions ? JSON.parse(existingRow.source_sessions) : []
      const mergedSessions = Array.from(new Set([...existingSessions, ...edge.sourceSessions]))

      this.db.prepare(`
        UPDATE graph_edge SET
          last_seen_ts = ?,
          occurrence_count = occurrence_count + 1,
          confidence = MAX(confidence, ?),
          source_sessions = ?
        WHERE id = ?
      `).run(edge.lastSeenTs, edge.confidence, JSON.stringify(mergedSessions), existing.id)
      return existing.id
    }

    const stmt = this.db.prepare(`
      INSERT INTO graph_edge (
        type, is_core_type, source_node_id, target_node_id, properties,
        first_seen_ts, last_seen_ts, occurrence_count, source_sessions, confidence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `)

    const result = stmt.run(
      edge.type,
      edge.isCoreType ? 1 : 0,
      edge.sourceNodeId,
      edge.targetNodeId,
      JSON.stringify(edge.properties),
      edge.firstSeenTs,
      edge.lastSeenTs,
      JSON.stringify(edge.sourceSessions),
      edge.confidence
    )

    return result.lastInsertRowid as number
  }

  /**
   * 查询节点列表
   */
  queryNodes(options: GraphQueryOptions = {}): GraphNode[] {
    const conditions: string[] = []
    const params: unknown[] = []

    if (options.types && options.types.length > 0) {
      conditions.push(`type IN (${options.types.map(() => '?').join(',')})`)
      params.push(...options.types)
    }

    if (options.fromTs !== undefined) {
      conditions.push('last_seen_ts >= ?')
      params.push(options.fromTs)
    }

    if (options.toTs !== undefined) {
      conditions.push('first_seen_ts <= ?')
      params.push(options.toTs)
    }

    if (options.nodeIds && options.nodeIds.length > 0) {
      conditions.push(`id IN (${options.nodeIds.map(() => '?').join(',')})`)
      params.push(...options.nodeIds)
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const limit = options.limit ? `LIMIT ${options.limit}` : 'LIMIT 500'

    const rows = this.db.prepare(`
      SELECT * FROM graph_node ${where}
      ORDER BY occurrence_count DESC
      ${limit}
    `).all(...params) as any[]

    return rows.map((row) => this.mapNodeRow(row))
  }

  /**
   * 查询边列表（按节点IDs）
   */
  queryEdges(nodeIds: number[]): GraphEdge[] {
    if (nodeIds.length === 0) return []

    const placeholders = nodeIds.map(() => '?').join(',')
    const rows = this.db.prepare(`
      SELECT * FROM graph_edge
      WHERE source_node_id IN (${placeholders}) OR target_node_id IN (${placeholders})
      ORDER BY occurrence_count DESC
      LIMIT 1000
    `).all(...nodeIds, ...nodeIds) as any[]

    return rows.map((row) => this.mapEdgeRow(row))
  }

  /**
   * 获取图谱统计
   */
  getStats(): { nodeCount: number; edgeCount: number; nodeTypes: Array<{ type: string; count: number }> } {
    const nodeCount = (this.db.prepare('SELECT COUNT(*) as cnt FROM graph_node').get() as any)?.cnt || 0
    const edgeCount = (this.db.prepare('SELECT COUNT(*) as cnt FROM graph_edge').get() as any)?.cnt || 0
    const nodeTypes = this.db.prepare(`
      SELECT type, COUNT(*) as count FROM graph_node GROUP BY type ORDER BY count DESC LIMIT 20
    `).all() as any[]

    return { nodeCount, edgeCount, nodeTypes }
  }

  private mapNodeRow(row: any): GraphNode {
    return {
      id: row.id,
      type: row.type,
      isCoreType: Boolean(row.is_core_type),
      name: row.name,
      displayName: row.display_name || undefined,
      properties: row.properties ? JSON.parse(row.properties) : {},
      firstSeenTs: row.first_seen_ts,
      lastSeenTs: row.last_seen_ts,
      occurrenceCount: row.occurrence_count,
      sourceSessions: row.source_sessions ? JSON.parse(row.source_sessions) : [],
      sourceMessageRefs: row.source_message_refs ? JSON.parse(row.source_message_refs) : [],
      confidence: row.confidence,
      color: row.color || undefined,
      icon: row.icon || undefined,
    }
  }

  private mapEdgeRow(row: any): GraphEdge {
    return {
      id: row.id,
      type: row.type,
      isCoreType: Boolean(row.is_core_type),
      sourceNodeId: row.source_node_id,
      targetNodeId: row.target_node_id,
      properties: row.properties ? JSON.parse(row.properties) : {},
      firstSeenTs: row.first_seen_ts,
      lastSeenTs: row.last_seen_ts,
      occurrenceCount: row.occurrence_count,
      sourceSessions: row.source_sessions ? JSON.parse(row.source_sessions) : [],
      confidence: row.confidence,
    }
  }
}

export const graphService = new GraphService()

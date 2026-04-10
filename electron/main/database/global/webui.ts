/**
 * WebUI 对话持久化数据库
 * 使用独立的 webui.db 存储 Web UI 会话的对话和消息
 */

import Database from 'better-sqlite3'
import * as path from 'path'
import { getGlobalDbDir } from './index'

export interface WebUIConversation {
  id: string
  sessionId: string
  title: string | null
  assistantId: string
  createdAt: number
  updatedAt: number
}

export interface WebUIMessage {
  id: string
  conversationId: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

let _db: Database.Database | null = null

function getDb(): Database.Database {
  if (!_db) {
    const dbPath = path.join(getGlobalDbDir(), 'webui.db')
    _db = new Database(dbPath)
    _db.pragma('journal_mode = WAL')
    _db.pragma('synchronous = NORMAL')
    _db.exec(`
      CREATE TABLE IF NOT EXISTS webui_conversation (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        title TEXT,
        assistant_id TEXT NOT NULL DEFAULT 'default',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_wc_session ON webui_conversation(session_id);
      CREATE INDEX IF NOT EXISTS idx_wc_updated ON webui_conversation(updated_at DESC);

      CREATE TABLE IF NOT EXISTS webui_message (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        FOREIGN KEY(conversation_id) REFERENCES webui_conversation(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_wm_conv ON webui_message(conversation_id, timestamp ASC);
    `)
  }
  return _db
}

// ==================== Conversation CRUD ====================

export function createConversation(conv: WebUIConversation): void {
  getDb()
    .prepare(
      'INSERT INTO webui_conversation (id, session_id, title, assistant_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(conv.id, conv.sessionId, conv.title ?? null, conv.assistantId, conv.createdAt, conv.updatedAt)
}

export function getConversation(id: string): WebUIConversation | null {
  const row = getDb().prepare('SELECT * FROM webui_conversation WHERE id = ?').get(id) as any
  return row ? mapConv(row) : null
}

export function updateConversationTs(id: string, updatedAt: number): void {
  getDb().prepare('UPDATE webui_conversation SET updated_at = ? WHERE id = ?').run(updatedAt, id)
}

export function deleteConversation(id: string): void {
  getDb().prepare('DELETE FROM webui_conversation WHERE id = ?').run(id)
}

export function listConversationsBySession(sessionId: string): WebUIConversation[] {
  const rows = getDb()
    .prepare('SELECT * FROM webui_conversation WHERE session_id = ? ORDER BY updated_at DESC')
    .all(sessionId) as any[]
  return rows.map(mapConv)
}

// ==================== Message CRUD ====================

export function insertMessage(msg: WebUIMessage): void {
  getDb()
    .prepare('INSERT INTO webui_message (id, conversation_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)')
    .run(msg.id, msg.conversationId, msg.role, msg.content, msg.timestamp)
}

export function getMessages(conversationId: string, limit = 200, offset = 0): WebUIMessage[] {
  const rows = getDb()
    .prepare('SELECT * FROM webui_message WHERE conversation_id = ? ORDER BY timestamp ASC LIMIT ? OFFSET ?')
    .all(conversationId, limit, offset) as any[]
  return rows.map(mapMsg)
}

export function getLastMessages(conversationId: string, count: number): WebUIMessage[] {
  const rows = getDb()
    .prepare(
      'SELECT * FROM (SELECT * FROM webui_message WHERE conversation_id = ? ORDER BY timestamp DESC LIMIT ?) ORDER BY timestamp ASC'
    )
    .all(conversationId, count) as any[]
  return rows.map(mapMsg)
}

// ==================== Mappers ====================

function mapConv(row: any): WebUIConversation {
  return {
    id: row.id,
    sessionId: row.session_id,
    title: row.title ?? null,
    assistantId: row.assistant_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapMsg(row: any): WebUIMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    timestamp: row.timestamp,
  }
}

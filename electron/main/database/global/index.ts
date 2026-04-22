/**
 * 全局数据库管理模块
 * 支持三个全局数据库：collaboration、knowledge_graph、identity
 * 所有全局 DB 统一存放在 data/databases/global/ 目录
 */

import Database from 'better-sqlite3'
import * as path from 'path'
import { getGlobalDatabaseDir, ensureDir } from '../../paths'

type GlobalDBName = 'collaboration' | 'knowledge_graph' | 'identity'

interface GlobalDatabaseInstance {
  collaboration: Database.Database
  knowledge_graph: Database.Database
  identity: Database.Database
}

// 全局数据库实例缓存
let _globalDbs: Partial<GlobalDatabaseInstance> = {}

/**
 * 获取全局数据库目录路径
 */
export function getGlobalDbDir(): string {
  const dbDir = getGlobalDatabaseDir()
  ensureDir(dbDir)
  return dbDir
}

/**
 * 获取特定全局数据库的文件路径
 */
function getGlobalDbPath(dbName: GlobalDBName): string {
  const dbDir = getGlobalDbDir()
  return path.join(dbDir, `${dbName}.db`)
}

/**
 * 初始化特定的全局数据库
 */
function initializeGlobalDb(dbName: GlobalDBName): Database.Database {
  const dbPath = getGlobalDbPath(dbName)
  let db: Database.Database
  try {
    db = new Database(dbPath)
  } catch (err) {
    console.error(`[GlobalDB] Failed to open database "${dbName}" at ${dbPath}:`, err)
    throw new Error(`Cannot open global database "${dbName}": ${err}`)
  }

  // 启用 WAL 模式
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')

  // 根据数据库类型初始化表
  switch (dbName) {
    case 'collaboration':
      initializeCollaborationDb(db)
      migrateCollaborationDb(db)
      break
    case 'knowledge_graph':
      initializeKnowledgeGraphDb(db)
      break
    case 'identity':
      initializeIdentityDb(db)
      break
  }

  return db
}

/**
 * 运行时迁移 collaboration.db（兼容旧数据库）
 */
function migrateCollaborationDb(db: Database.Database): void {
  // 1.1 为 personal_todo 添加 progress 列（旧库可能没有）
  const todoColumns = (db.pragma('table_info(personal_todo)') as any[]).map((c) => c.name)
  if (!todoColumns.includes('progress')) {
    db.exec('ALTER TABLE personal_todo ADD COLUMN progress INTEGER DEFAULT 0')
    console.log('[GlobalDB] Migration: added progress column to personal_todo')
  }
}

/**
 * 初始化 collaboration.db 的表结构
 */
function initializeCollaborationDb(db: Database.Database): void {
  // ========== 防御性迁移：清理老 DB 里可能残留的重复活跃 job ==========
  // 下面 CREATE UNIQUE INDEX 是 partial index (WHERE status IN ('pending','running'))。
  // 在旧 DB 上：若历史 bug 留下同 (session, jobType) 的两条以上 pending/running 行，
  // CREATE INDEX 会抛 UNIQUE constraint failed，整个 initializeCollaborationDb
  // 会失败，主进程启动挂掉。
  //
  // 先 upgrade 已存在的 extraction_job 表，把每个 (session, jobType) 组里多余的
  // 活跃行置为 cancelled，只保留 created_at 最新的一条。CREATE TABLE IF NOT EXISTS
  // 对新库是 no-op，对老库已经有表，这个 UPDATE 才有意义。
  try {
    const tableExists = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='extraction_job'")
      .get()
    if (tableExists) {
      db.prepare(
        `UPDATE extraction_job
         SET status = 'cancelled', finished_at = ?, error_code = 'MIGRATION_DEDUP', error_detail = 'Cancelled by migration: duplicate active job'
         WHERE status IN ('pending', 'running')
           AND id NOT IN (
             SELECT id FROM extraction_job j1
             WHERE status IN ('pending', 'running')
               AND created_at = (
                 SELECT MAX(j2.created_at) FROM extraction_job j2
                 WHERE j2.session_id = j1.session_id
                   AND j2.job_type = j1.job_type
                   AND j2.status IN ('pending', 'running')
               )
           )`
      ).run(Date.now())
    }
  } catch (err) {
    console.warn('[GlobalDB] Pre-index dedup migration skipped:', err)
  }

  db.exec(`
    -- AI 提取任务表
    CREATE TABLE IF NOT EXISTS extraction_job (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      job_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      progress INTEGER DEFAULT 0,
      progress_message TEXT,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER,
      error_code TEXT,
      error_detail TEXT,
      retry_count INTEGER DEFAULT 0,
      max_retries INTEGER DEFAULT 3,
      config_snapshot TEXT,
      result_summary TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_job_active_dedup
      ON extraction_job(session_id, job_type)
      WHERE status IN ('pending', 'running');

    CREATE INDEX IF NOT EXISTS idx_job_session ON extraction_job(session_id);
    CREATE INDEX IF NOT EXISTS idx_job_status ON extraction_job(status);
    CREATE INDEX IF NOT EXISTS idx_job_created ON extraction_job(created_at DESC);

    -- 全局任务表
    CREATE TABLE IF NOT EXISTS global_task (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'pending',
      priority TEXT DEFAULT 'normal',
      owner_global_user_id TEXT,
      owner_display_name TEXT,
      due_ts INTEGER,
      created_ts INTEGER NOT NULL,
      updated_ts INTEGER NOT NULL,
      completed_ts INTEGER,
      confidence REAL DEFAULT 1.0,
      is_manual INTEGER DEFAULT 0,
      tags TEXT DEFAULT '[]',
      metadata TEXT DEFAULT '{}'
    );

    CREATE INDEX IF NOT EXISTS idx_task_status ON global_task(status);
    CREATE INDEX IF NOT EXISTS idx_task_owner ON global_task(owner_global_user_id);
    CREATE INDEX IF NOT EXISTS idx_task_due ON global_task(due_ts);
    CREATE INDEX IF NOT EXISTS idx_task_created ON global_task(created_ts);
    -- dedup 查询使用 LOWER(TRIM(title))，表达式索引让 findIdByNormalizedTitle 命中索引，
    -- 避免重分析时 O(n) 全表扫（单次分析里会调几百到几千次）
    CREATE INDEX IF NOT EXISTS idx_task_norm_title ON global_task(LOWER(TRIM(title)));

    -- 任务来源关联表
    CREATE TABLE IF NOT EXISTS task_source (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      session_id TEXT NOT NULL,
      message_id INTEGER NOT NULL,
      message_ts INTEGER NOT NULL,
      extracted_ts INTEGER NOT NULL,
      confidence REAL DEFAULT 1.0,
      FOREIGN KEY(task_id) REFERENCES global_task(id) ON DELETE CASCADE,
      UNIQUE(task_id, session_id, message_id)
    );

    CREATE INDEX IF NOT EXISTS idx_task_source_session ON task_source(session_id);

    -- 任务参与者表
    CREATE TABLE IF NOT EXISTS task_participant (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      global_user_id TEXT NOT NULL,
      role TEXT DEFAULT 'collaborator',
      session_id TEXT,
      FOREIGN KEY(task_id) REFERENCES global_task(id) ON DELETE CASCADE,
      UNIQUE(task_id, global_user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_task_participant ON task_participant(global_user_id);

    -- 任务编辑历史
    CREATE TABLE IF NOT EXISTS task_edit_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      field TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      edited_by TEXT,
      edited_ts INTEGER NOT NULL,
      FOREIGN KEY(task_id) REFERENCES global_task(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_task_edit ON task_edit_history(task_id, edited_ts DESC);

    -- 个人待办表
    CREATE TABLE IF NOT EXISTS personal_todo (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      global_user_id TEXT NOT NULL,
      task_id INTEGER,
      task_title TEXT,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'pending',
      priority TEXT DEFAULT 'normal',
      progress INTEGER DEFAULT 0,
      due_ts INTEGER,
      reminder_ts INTEGER,
      notes TEXT,
      tags TEXT DEFAULT '[]',
      is_starred INTEGER DEFAULT 0,
      created_ts INTEGER NOT NULL,
      updated_ts INTEGER NOT NULL,
      completed_ts INTEGER,
      source_type TEXT DEFAULT 'task',
      source_session_id TEXT,
      FOREIGN KEY(task_id) REFERENCES global_task(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_todo_user ON personal_todo(global_user_id);
    CREATE INDEX IF NOT EXISTS idx_todo_status ON personal_todo(status, global_user_id);
    CREATE INDEX IF NOT EXISTS idx_todo_due ON personal_todo(due_ts);
    CREATE INDEX IF NOT EXISTS idx_todo_task ON personal_todo(task_id);
    -- dedup: (global_user_id, 归一化 title) —— 覆盖 findIdByNormalizedTitle 查询
    CREATE INDEX IF NOT EXISTS idx_todo_norm_title ON personal_todo(global_user_id, LOWER(TRIM(title)));

    -- 关注点表
    CREATE TABLE IF NOT EXISTS focus_item (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      global_user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      keywords TEXT DEFAULT '[]',
      color TEXT,
      mention_count INTEGER DEFAULT 0,
      related_session_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      last_activity_ts INTEGER,
      last_summary TEXT,
      created_ts INTEGER NOT NULL,
      updated_ts INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_focus_user ON focus_item(global_user_id);
    CREATE INDEX IF NOT EXISTS idx_focus_type ON focus_item(type);
    CREATE INDEX IF NOT EXISTS idx_focus_status ON focus_item(status);
    -- dedup: (global_user_id, type, 归一化 title)
    CREATE INDEX IF NOT EXISTS idx_focus_norm_title
      ON focus_item(global_user_id, type, LOWER(TRIM(title)));

    -- 关注点-消息关联
    CREATE TABLE IF NOT EXISTS focus_message_link (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      focus_id INTEGER NOT NULL,
      session_id TEXT NOT NULL,
      message_id INTEGER NOT NULL,
      message_ts INTEGER NOT NULL,
      relevance REAL DEFAULT 1.0,
      summary TEXT,
      FOREIGN KEY(focus_id) REFERENCES focus_item(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_focus_link ON focus_message_link(focus_id);
    CREATE INDEX IF NOT EXISTS idx_focus_link_session ON focus_message_link(session_id);

    -- 知识条目表
    CREATE TABLE IF NOT EXISTS knowledge_item (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      summary TEXT,
      category TEXT,
      tags TEXT DEFAULT '[]',
      source_session_ids TEXT DEFAULT '[]',
      source_message_refs TEXT DEFAULT '[]',
      confidence REAL DEFAULT 1.0,
      is_edited INTEGER DEFAULT 0,
      edit_history TEXT DEFAULT '[]',
      view_count INTEGER DEFAULT 0,
      helpful_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      created_ts INTEGER NOT NULL,
      updated_ts INTEGER NOT NULL,
      version INTEGER DEFAULT 1,
      parent_id INTEGER,
      FOREIGN KEY(parent_id) REFERENCES knowledge_item(id)
    );

    CREATE INDEX IF NOT EXISTS idx_knowledge_type ON knowledge_item(type);
    CREATE INDEX IF NOT EXISTS idx_knowledge_category ON knowledge_item(category);
    CREATE INDEX IF NOT EXISTS idx_knowledge_status ON knowledge_item(status);
    -- FAQ/Knowledge dedup 查询 LOWER(TRIM(title))——extractionRunner 在每批次
    -- 保存前都会先 queryItems({ type: [...] }) 拉全表的归一化标题做 Set/Levenshtein
    -- 比较。给 (type, LOWER(TRIM(title))) 建联合表达式索引，让 queryItems 的
    -- WHERE type = ? 走索引的同时保留 title 排序能力。
    CREATE INDEX IF NOT EXISTS idx_knowledge_type_norm_title
      ON knowledge_item(type, LOWER(TRIM(title)));

    -- 知识条目来源关联表（替代 source_session_ids JSON 字段）
    CREATE TABLE IF NOT EXISTS knowledge_source (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      knowledge_id INTEGER NOT NULL,
      session_id TEXT NOT NULL,
      message_id INTEGER,
      FOREIGN KEY(knowledge_id) REFERENCES knowledge_item(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_knowledge_source_kid ON knowledge_source(knowledge_id);
    CREATE INDEX IF NOT EXISTS idx_knowledge_source_sid ON knowledge_source(session_id);

    -- 知识向量索引表
    CREATE TABLE IF NOT EXISTS knowledge_vector (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      knowledge_id INTEGER NOT NULL,
      embedding BLOB,
      model TEXT,
      dimensions INTEGER,
      chunk_index INTEGER DEFAULT 0,
      FOREIGN KEY(knowledge_id) REFERENCES knowledge_item(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_knowledge_vector ON knowledge_vector(knowledge_id);
  `)
}

/**
 * 初始化 knowledge_graph.db 的表结构
 */
function initializeKnowledgeGraphDb(db: Database.Database): void {
  db.exec(`
    -- 图节点表
    CREATE TABLE IF NOT EXISTS graph_node (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      is_core_type INTEGER DEFAULT 1,
      name TEXT NOT NULL,
      display_name TEXT,
      properties TEXT DEFAULT '{}',
      first_seen_ts INTEGER NOT NULL,
      last_seen_ts INTEGER NOT NULL,
      occurrence_count INTEGER DEFAULT 1,
      source_sessions TEXT DEFAULT '[]',
      source_message_refs TEXT DEFAULT '[]',
      confidence REAL DEFAULT 1.0,
      color TEXT,
      icon TEXT,
      UNIQUE(type, name)
    );

    CREATE INDEX IF NOT EXISTS idx_node_type ON graph_node(type);
    CREATE INDEX IF NOT EXISTS idx_node_time ON graph_node(first_seen_ts, last_seen_ts);
    CREATE INDEX IF NOT EXISTS idx_node_core ON graph_node(is_core_type);

    -- 图边表
    CREATE TABLE IF NOT EXISTS graph_edge (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      is_core_type INTEGER DEFAULT 1,
      source_node_id INTEGER NOT NULL,
      target_node_id INTEGER NOT NULL,
      properties TEXT DEFAULT '{}',
      first_seen_ts INTEGER NOT NULL,
      last_seen_ts INTEGER NOT NULL,
      occurrence_count INTEGER DEFAULT 1,
      source_sessions TEXT DEFAULT '[]',
      source_message_refs TEXT DEFAULT '[]',
      confidence REAL DEFAULT 1.0,
      FOREIGN KEY(source_node_id) REFERENCES graph_node(id) ON DELETE CASCADE,
      FOREIGN KEY(target_node_id) REFERENCES graph_node(id) ON DELETE CASCADE,
      UNIQUE(source_node_id, target_node_id, type)
    );

    CREATE INDEX IF NOT EXISTS idx_edge_source ON graph_edge(source_node_id);
    CREATE INDEX IF NOT EXISTS idx_edge_target ON graph_edge(target_node_id);
    CREATE INDEX IF NOT EXISTS idx_edge_type ON graph_edge(type);
    CREATE INDEX IF NOT EXISTS idx_edge_time ON graph_edge(first_seen_ts, last_seen_ts);

    -- 节点类型统计视图
    CREATE VIEW IF NOT EXISTS v_node_type_stats AS
    SELECT
      type,
      is_core_type,
      COUNT(*) as count,
      MIN(first_seen_ts) as earliest_ts,
      MAX(last_seen_ts) as latest_ts
    FROM graph_node
    GROUP BY type, is_core_type
    ORDER BY count DESC;
  `)
}

/**
 * 初始化 identity.db 的表结构
 */
function initializeIdentityDb(db: Database.Database): void {
  db.exec(`
    -- 全局用户身份表
    CREATE TABLE IF NOT EXISTS global_user (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      global_user_id TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      avatar TEXT,
      created_ts INTEGER NOT NULL,
      last_active_ts INTEGER
    );

    -- 会话身份映射表
    CREATE TABLE IF NOT EXISTS user_identity_mapping (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      global_user_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      member_id INTEGER NOT NULL,
      platform_id TEXT,
      account_name TEXT,
      group_nickname TEXT,
      match_type TEXT NOT NULL,
      confidence REAL DEFAULT 1.0,
      confirmed INTEGER DEFAULT 0,
      created_ts INTEGER NOT NULL,
      FOREIGN KEY(global_user_id) REFERENCES global_user(global_user_id),
      UNIQUE(session_id, member_id)
    );

    CREATE INDEX IF NOT EXISTS idx_identity_user ON user_identity_mapping(global_user_id);
    CREATE INDEX IF NOT EXISTS idx_identity_session ON user_identity_mapping(session_id);
    CREATE INDEX IF NOT EXISTS idx_identity_member ON user_identity_mapping(session_id, member_id);
    CREATE INDEX IF NOT EXISTS idx_identity_name ON user_identity_mapping(account_name);

    -- 待确认的身份匹配
    CREATE TABLE IF NOT EXISTS pending_identity_match (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      global_user_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      member_id INTEGER NOT NULL,
      suggested_name TEXT,
      confidence REAL,
      created_ts INTEGER NOT NULL
    );
  `)
}

/**
 * 获取或创建全局数据库实例
 */
export function getGlobalDb(dbName: GlobalDBName): Database.Database {
  if (!_globalDbs[dbName]) {
    _globalDbs[dbName] = initializeGlobalDb(dbName)
  }
  return _globalDbs[dbName]!
}

/**
 * 初始化所有全局数据库（主进程启动时调用）
 */
export function initGlobalDatabases(): void {
  getGlobalDb('collaboration')
  getGlobalDb('knowledge_graph')
  getGlobalDb('identity')
  console.log('[GlobalDB] All global databases initialized')
}

/**
 * 获取所有全局数据库实例
 */
export function getAllGlobalDbs(): GlobalDatabaseInstance {
  return {
    collaboration: getGlobalDb('collaboration'),
    knowledge_graph: getGlobalDb('knowledge_graph'),
    identity: getGlobalDb('identity'),
  }
}

/**
 * 关闭所有全局数据库
 */
export function closeAllGlobalDbs(): void {
  Object.values(_globalDbs).forEach((db) => {
    if (db) db.close()
  })
  _globalDbs = {}
}

/**
 * 重置数据库实例（用于测试）
 */
export function resetGlobalDbInstances(): void {
  closeAllGlobalDbs()
}

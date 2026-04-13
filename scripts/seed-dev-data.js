/**
 * Dev seed script — populates the production ChatLab collaboration database
 * with a simulated 1-month dev team workflow.
 *
 * Usage: node scripts/seed-dev-data.js
 *
 * IMPORTANT: ChatLab app must be closed before running this script.
 */

const Database = require('better-sqlite3')
const path = require('path')
const os = require('os')

// ── 定位生产数据库 ────────────────────────────────────────────────────────────

const COLLAB_DB_PATH = path.join(
  os.homedir(),
  'AppData',
  'Roaming',
  'ChatLab',
  'data',
  'databases',
  'global',
  'collaboration.db'
)

console.log('[Seed] Opening:', COLLAB_DB_PATH)
const db = new Database(COLLAB_DB_PATH)
db.pragma('foreign_keys = ON')
db.pragma('journal_mode = WAL')

// ── 时间工具 ─────────────────────────────────────────────────────────────────

const NOW = Date.now()
const DAY = 86_400_000

// 返回 N 天前的时间戳（可指定小时偏移）
function daysAgo(d, hourOffset = 9) {
  return NOW - d * DAY + hourOffset * 3_600_000
}

// ── 清除旧的 seed 数据（避免重复插入） ──────────────────────────────────────

function clearSeedData() {
  // 删除带有 seed 标识的数据
  db.exec(`
    DELETE FROM task_participant WHERE task_id IN (
      SELECT id FROM global_task WHERE json_extract(metadata, '$.seed') = 1
    );
    DELETE FROM task_source WHERE task_id IN (
      SELECT id FROM global_task WHERE json_extract(metadata, '$.seed') = 1
    );
    DELETE FROM global_task WHERE json_extract(metadata, '$.seed') = 1;
    DELETE FROM personal_todo WHERE json_extract(metadata, '$.seed') = 1;
    DELETE FROM focus_item WHERE json_extract(keywords, '$[0]') = '__seed__';
  `)
  console.log('[Seed] Old seed data cleared.')
}

// ── 插入全局任务 ─────────────────────────────────────────────────────────────

const insertTask = db.prepare(`
  INSERT INTO global_task (
    title, description, status, priority,
    owner_global_user_id, owner_display_name,
    due_ts, created_ts, updated_ts, completed_ts,
    confidence, is_manual, tags, metadata
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)

function addTask(t) {
  const result = insertTask.run(
    t.title,
    t.description || null,
    t.status,
    t.priority,
    t.ownerId || null,
    t.ownerName || null,
    t.dueTs || null,
    t.createdTs,
    t.updatedTs,
    t.completedTs || null,
    t.confidence ?? 0.9,
    t.isManual ? 1 : 0,
    JSON.stringify(t.tags || []),
    JSON.stringify({ seed: 1, ...(t.meta || {}) })
  )
  return result.lastInsertRowid
}

// ── 插入个人待办 ──────────────────────────────────────────────────────────────

const insertTodo = db.prepare(`
  INSERT INTO personal_todo (
    global_user_id, task_id, task_title, title, description,
    status, priority, progress, due_ts, notes, tags, is_starred,
    created_ts, updated_ts, completed_ts, source_type, metadata
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)

function addTodo(t) {
  return insertTodo.run(
    t.userId,
    t.taskId || null,
    t.taskTitle || null,
    t.title,
    t.description || null,
    t.status,
    t.priority,
    t.progress ?? 0,
    t.dueTs || null,
    t.notes || null,
    JSON.stringify(t.tags || []),
    t.isStarred ? 1 : 0,
    t.createdTs,
    t.updatedTs,
    t.completedTs || null,
    t.sourceType || 'manual',
    JSON.stringify({ seed: 1 })
  ).lastInsertRowid
}

// ── 插入关注点 ────────────────────────────────────────────────────────────────

const insertFocus = db.prepare(`
  INSERT INTO focus_item (
    global_user_id, type, title, description,
    keywords, color, mention_count, related_session_count,
    status, last_activity_ts, last_summary, created_ts, updated_ts
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)

function addFocus(f) {
  return insertFocus.run(
    f.userId,
    f.type,
    f.title,
    f.description || null,
    JSON.stringify(['__seed__', ...(f.keywords || [])]),
    f.color || null,
    f.mentionCount || 1,
    f.sessionCount || 1,
    f.status || 'active',
    f.lastActivityTs || NOW,
    f.lastSummary || null,
    f.createdTs || daysAgo(30),
    f.updatedTs || NOW
  ).lastInsertRowid
}

// ════════════════════════════════════════════════════════════════════════════
// 一个月的开发团队数据
// ════════════════════════════════════════════════════════════════════════════

clearSeedData()

const seed = db.transaction(() => {
  // ── Sprint 1: 需求评审 & 技术选型（第 4~3 周前） ──────────────────────────

  const t1 = addTask({
    title: '实现 WebSocket 实时协作后端',
    description: '使用 WebSocket 协议实现多用户实时协同编辑，包括房间管理、广播和冲突解决',
    status: 'completed',
    priority: 'urgent',
    ownerId: 'user-wq',
    ownerName: '王强',
    dueTs: daysAgo(21),
    createdTs: daysAgo(30, 9),
    updatedTs: daysAgo(18, 18),
    completedTs: daysAgo(18, 17),
    confidence: 0.95,
    isManual: false,
    tags: ['v2.0', 'backend', 'WebSocket'],
    meta: { sessionId: 'session-sprint1' },
  })

  const t2 = addTask({
    title: '前端 WebSocket 接入与 UI 同步',
    description: '在前端实现 WebSocket 连接管理、实时状态同步和 UI 更新',
    status: 'completed',
    priority: 'urgent',
    ownerId: 'user-ln',
    ownerName: '李娜',
    dueTs: daysAgo(21),
    createdTs: daysAgo(30, 9),
    updatedTs: daysAgo(19, 16),
    completedTs: daysAgo(19, 15),
    confidence: 0.92,
    isManual: false,
    tags: ['v2.0', 'frontend', 'WebSocket'],
    meta: { sessionId: 'session-sprint1' },
  })

  const t3 = addTask({
    title: '修复登录页 XSS 漏洞 (Bug #1024)',
    description: 'dangerouslySetInnerHTML 引起的 XSS，需要替换为安全的渲染方式',
    status: 'completed',
    priority: 'urgent',
    ownerId: 'user-wq',
    ownerName: '王强',
    dueTs: daysAgo(29),
    createdTs: daysAgo(30, 9),
    updatedTs: daysAgo(29, 17),
    completedTs: daysAgo(29, 16),
    confidence: 0.99,
    isManual: false,
    tags: ['security', 'bug', 'P0'],
  })

  const t4 = addTask({
    title: '首页 LCP 性能优化（目标 < 2.5s）',
    description: '当前 LCP 4.2s，需通过代码分割、图片懒加载、批量接口减少请求数',
    status: 'completed',
    priority: 'high',
    ownerId: 'user-ln',
    ownerName: '李娜',
    dueTs: daysAgo(27),
    createdTs: daysAgo(30, 10),
    updatedTs: daysAgo(27, 18),
    completedTs: daysAgo(27, 17),
    confidence: 0.91,
    isManual: false,
    tags: ['performance', 'frontend', 'P1'],
  })

  const t5 = addTask({
    title: 'Nginx 生产环境 WebSocket 配置',
    description: '调整 proxy_read_timeout 和 keepalive_timeout，支持 WebSocket 长连接',
    status: 'completed',
    priority: 'high',
    ownerId: 'user-cm',
    ownerName: '陈明',
    dueTs: daysAgo(26),
    createdTs: daysAgo(30, 9),
    updatedTs: daysAgo(26, 15),
    completedTs: daysAgo(26, 14),
    confidence: 0.88,
    isManual: false,
    tags: ['devops', 'nginx', 'WebSocket'],
  })

  // ── Sprint 2: 数据库优化 & 监控（第 3~2 周前） ────────────────────────────

  const t6 = addTask({
    title: '用户活动日志表索引优化',
    description: '查询慢 12 秒，添加复合索引 (user_id, created_at)，目标 < 200ms',
    status: 'completed',
    priority: 'high',
    ownerId: 'user-wq',
    ownerName: '王强',
    dueTs: daysAgo(20),
    createdTs: daysAgo(22, 9),
    updatedTs: daysAgo(19, 17),
    completedTs: daysAgo(19, 16),
    confidence: 0.95,
    isManual: false,
    tags: ['database', 'performance', 'backend'],
  })

  const t7 = addTask({
    title: '搭建 Prometheus + Grafana 监控栈',
    description: '监控 API 延迟、错误率、WebSocket 连接数，并配置告警规则',
    status: 'completed',
    priority: 'normal',
    ownerId: 'user-cm',
    ownerName: '陈明',
    dueTs: daysAgo(18),
    createdTs: daysAgo(22, 10),
    updatedTs: daysAgo(17, 16),
    completedTs: daysAgo(17, 15),
    confidence: 0.9,
    isManual: false,
    tags: ['devops', 'monitoring', 'prometheus'],
  })

  const t8 = addTask({
    title: '实现数据库连接池与查询缓存',
    description: '使用连接池优化并发，Redis 缓存热点查询，降低数据库压力',
    status: 'in_progress',
    priority: 'high',
    ownerId: 'user-wq',
    ownerName: '王强',
    dueTs: daysAgo(14),
    createdTs: daysAgo(20, 9),
    updatedTs: daysAgo(12, 17),
    confidence: 0.87,
    isManual: false,
    tags: ['backend', 'database', 'redis'],
  })

  const t9 = addTask({
    title: 'Playwright E2E 测试覆盖核心流程',
    description: '覆盖登录、协作编辑、数据持久化等关键路径的端到端测试',
    status: 'in_progress',
    priority: 'normal',
    ownerId: 'user-ly',
    ownerName: '刘洋',
    dueTs: daysAgo(10),
    createdTs: daysAgo(20, 9),
    updatedTs: daysAgo(5, 16),
    confidence: 0.85,
    isManual: false,
    tags: ['testing', 'e2e', 'playwright'],
  })

  // ── Sprint 3: 当前 Sprint（第 2~0 周） ────────────────────────────────────

  const t10 = addTask({
    title: '用户权限系统 RBAC 重构',
    description: '将现有简单权限系统重构为 RBAC，支持自定义角色和细粒度权限控制',
    status: 'in_progress',
    priority: 'high',
    ownerId: 'user-wq',
    ownerName: '王强',
    dueTs: daysAgo(-7),
    createdTs: daysAgo(14, 10),
    updatedTs: daysAgo(2, 17),
    confidence: 0.88,
    isManual: false,
    tags: ['backend', 'auth', 'rbac'],
  })

  const t11 = addTask({
    title: '移动端响应式适配',
    description: '当前设计在 iPhone 14 上折行严重，需要完整的移动端适配',
    status: 'pending',
    priority: 'high',
    ownerId: 'user-ln',
    ownerName: '李娜',
    dueTs: daysAgo(-7),
    createdTs: daysAgo(14, 10),
    updatedTs: daysAgo(14, 10),
    confidence: 0.82,
    isManual: false,
    tags: ['frontend', 'mobile', 'responsive'],
  })

  const t12 = addTask({
    title: '消息队列引入（RabbitMQ）',
    description: '解耦实时通知和邮件发送，削峰填谷，提升系统稳定性',
    status: 'pending',
    priority: 'normal',
    ownerId: 'user-cm',
    ownerName: '陈明',
    dueTs: daysAgo(-14),
    createdTs: daysAgo(10, 9),
    updatedTs: daysAgo(10, 9),
    confidence: 0.8,
    isManual: false,
    tags: ['devops', 'rabbitmq', 'backend'],
  })

  const t13 = addTask({
    title: '自动化 UI 回归测试（GitHub Actions）',
    description: '在每次 PR 时自动运行 Playwright 测试，集成到 CI/CD 流水线',
    status: 'pending',
    priority: 'normal',
    ownerId: 'user-ly',
    ownerName: '刘洋',
    dueTs: daysAgo(-10),
    createdTs: daysAgo(10, 9),
    updatedTs: daysAgo(10, 9),
    confidence: 0.83,
    isManual: false,
    tags: ['testing', 'ci/cd', 'github-actions'],
  })

  const t14 = addTask({
    title: '数据导出功能（CSV/Excel）',
    description: '支持用户将任务列表、日志数据导出为 CSV 或 Excel 格式',
    status: 'pending',
    priority: 'low',
    ownerId: 'user-ln',
    ownerName: '李娜',
    dueTs: daysAgo(-21),
    createdTs: daysAgo(7, 9),
    updatedTs: daysAgo(7, 9),
    confidence: 0.75,
    isManual: false,
    tags: ['frontend', 'feature', 'export'],
  })

  // ── 个人待办（李娜 + 王强） ───────────────────────────────────────────────

  addTodo({
    userId: 'user-ln',
    taskId: t2,
    taskTitle: '前端 WebSocket 接入与 UI 同步',
    title: '实现协同光标显示',
    status: 'completed',
    priority: 'high',
    progress: 100,
    createdTs: daysAgo(28),
    updatedTs: daysAgo(22),
    completedTs: daysAgo(22),
    isStarred: false,
    sourceType: 'task',
  })

  addTodo({
    userId: 'user-ln',
    taskId: t4,
    taskTitle: '首页 LCP 性能优化',
    title: '实现路由级代码分割',
    status: 'completed',
    priority: 'high',
    progress: 100,
    createdTs: daysAgo(28),
    updatedTs: daysAgo(25),
    completedTs: daysAgo(25),
    isStarred: false,
    sourceType: 'task',
  })

  addTodo({
    userId: 'user-ln',
    taskId: t4,
    taskTitle: '首页 LCP 性能优化',
    title: '图片资源 WebP 转换 + 懒加载',
    status: 'completed',
    priority: 'normal',
    progress: 100,
    createdTs: daysAgo(27),
    updatedTs: daysAgo(24),
    completedTs: daysAgo(24),
    isStarred: false,
    sourceType: 'task',
  })

  addTodo({
    userId: 'user-ln',
    taskId: t11,
    taskTitle: '移动端响应式适配',
    title: '修复导航栏在 375px 屏幕下的折叠问题',
    status: 'in_progress',
    priority: 'high',
    progress: 60,
    dueTs: daysAgo(-5),
    createdTs: daysAgo(12),
    updatedTs: daysAgo(1),
    isStarred: true,
    sourceType: 'task',
  })

  addTodo({
    userId: 'user-ln',
    title: '阅读 CSS Grid 响应式布局最佳实践',
    status: 'pending',
    priority: 'low',
    progress: 0,
    createdTs: daysAgo(10),
    updatedTs: daysAgo(10),
    isStarred: false,
    sourceType: 'manual',
  })

  addTodo({
    userId: 'user-wq',
    taskId: t6,
    taskTitle: '用户活动日志表索引优化',
    title: '分析慢查询日志找出 Top 10 慢 SQL',
    status: 'completed',
    priority: 'high',
    progress: 100,
    createdTs: daysAgo(22),
    updatedTs: daysAgo(21),
    completedTs: daysAgo(21),
    isStarred: false,
    sourceType: 'task',
  })

  addTodo({
    userId: 'user-wq',
    taskId: t8,
    taskTitle: '数据库连接池与查询缓存',
    title: '配置 pg-pool 最大连接数为 20',
    status: 'completed',
    priority: 'normal',
    progress: 100,
    createdTs: daysAgo(18),
    updatedTs: daysAgo(15),
    completedTs: daysAgo(15),
    isStarred: false,
    sourceType: 'task',
  })

  addTodo({
    userId: 'user-wq',
    taskId: t8,
    taskTitle: '数据库连接池与查询缓存',
    title: '实现 Redis 热点数据缓存（TTL: 5min）',
    status: 'in_progress',
    priority: 'high',
    progress: 70,
    dueTs: daysAgo(-3),
    createdTs: daysAgo(15),
    updatedTs: daysAgo(1),
    isStarred: true,
    sourceType: 'task',
  })

  addTodo({
    userId: 'user-wq',
    taskId: t10,
    taskTitle: '用户权限系统 RBAC 重构',
    title: '设计 RBAC 数据模型（roles/permissions/user_roles 三表）',
    status: 'completed',
    priority: 'high',
    progress: 100,
    createdTs: daysAgo(12),
    updatedTs: daysAgo(10),
    completedTs: daysAgo(10),
    isStarred: false,
    sourceType: 'task',
  })

  addTodo({
    userId: 'user-wq',
    taskId: t10,
    taskTitle: '用户权限系统 RBAC 重构',
    title: '实现权限中间件（Express middleware）',
    status: 'in_progress',
    priority: 'high',
    progress: 40,
    dueTs: daysAgo(-5),
    createdTs: daysAgo(10),
    updatedTs: daysAgo(1),
    isStarred: true,
    sourceType: 'task',
  })

  addTodo({
    userId: 'user-ly',
    taskId: t9,
    taskTitle: 'Playwright E2E 测试覆盖核心流程',
    title: '完成登录/注销/权限测试用例',
    status: 'completed',
    priority: 'normal',
    progress: 100,
    createdTs: daysAgo(18),
    updatedTs: daysAgo(14),
    completedTs: daysAgo(14),
    isStarred: false,
    sourceType: 'task',
  })

  addTodo({
    userId: 'user-ly',
    taskId: t9,
    taskTitle: 'Playwright E2E 测试覆盖核心流程',
    title: '完成协作编辑并发冲突测试用例',
    status: 'in_progress',
    priority: 'high',
    progress: 50,
    dueTs: daysAgo(-7),
    createdTs: daysAgo(12),
    updatedTs: daysAgo(2),
    isStarred: true,
    sourceType: 'task',
  })

  addTodo({
    userId: 'user-cm',
    taskId: t7,
    taskTitle: 'Prometheus + Grafana 监控栈',
    title: '配置 API 错误率告警规则（>1%触发）',
    status: 'completed',
    priority: 'normal',
    progress: 100,
    createdTs: daysAgo(20),
    updatedTs: daysAgo(17),
    completedTs: daysAgo(17),
    isStarred: false,
    sourceType: 'task',
  })

  addTodo({
    userId: 'user-cm',
    taskId: t12,
    taskTitle: '消息队列引入（RabbitMQ）',
    title: '评估 RabbitMQ vs Kafka 选型',
    status: 'pending',
    priority: 'normal',
    progress: 0,
    dueTs: daysAgo(-10),
    createdTs: daysAgo(8),
    updatedTs: daysAgo(8),
    isStarred: false,
    sourceType: 'task',
  })

  // ── 关注点（高频议题） ─────────────────────────────────────────────────────

  addFocus({
    userId: 'user-all',
    type: 'topic',
    title: 'WebSocket 实时协作性能',
    description: '需要持续监控 WebSocket 连接数、延迟和断线重连率',
    keywords: ['WebSocket', '实时协作', '性能', '连接数'],
    color: '#4A90D9',
    mentionCount: 23,
    sessionCount: 8,
    status: 'active',
    lastActivityTs: daysAgo(1),
    lastSummary: 'WebSocket 压测显示并发 1000 连接延迟 < 50ms，已满足 v2.0 要求',
    createdTs: daysAgo(30),
    updatedTs: daysAgo(1),
  })

  addFocus({
    userId: 'user-all',
    type: 'topic',
    title: 'P0 安全漏洞修复',
    description: '跟踪所有 P0 级安全漏洞的修复进度',
    keywords: ['安全', 'XSS', '漏洞', 'P0'],
    color: '#D0021B',
    mentionCount: 15,
    sessionCount: 5,
    status: 'resolved',
    lastActivityTs: daysAgo(28),
    lastSummary: '登录页 XSS 漏洞已修复验证通过，PR #247 已合并',
    createdTs: daysAgo(30),
    updatedTs: daysAgo(28),
  })

  addFocus({
    userId: 'user-all',
    type: 'risk',
    title: '数据库性能瓶颈',
    description: '查询慢问题需要持续关注，索引优化后仍有部分复杂查询超时',
    keywords: ['数据库', '性能', '慢查询', '索引'],
    color: '#F5A623',
    mentionCount: 18,
    sessionCount: 7,
    status: 'active',
    lastActivityTs: daysAgo(5),
    lastSummary: '索引优化后主要慢查询已解决，Redis 缓存实施中，预计下周完成',
    createdTs: daysAgo(22),
    updatedTs: daysAgo(5),
  })

  addFocus({
    userId: 'user-all',
    type: 'topic',
    title: 'CI/CD 自动化测试覆盖率',
    description: '提升端到端测试覆盖率，确保每次 PR 合并前有完整测试保障',
    keywords: ['CI/CD', 'Playwright', '测试覆盖率', 'E2E'],
    color: '#7ED321',
    mentionCount: 12,
    sessionCount: 4,
    status: 'active',
    lastActivityTs: daysAgo(3),
    lastSummary: '核心登录流程已覆盖，协作编辑测试用例开发中',
    createdTs: daysAgo(20),
    updatedTs: daysAgo(3),
  })

  addFocus({
    userId: 'user-all',
    type: 'decision',
    title: '消息队列技术选型',
    description: 'RabbitMQ vs Kafka，需要根据消息量级和运维复杂度做决策',
    keywords: ['消息队列', 'RabbitMQ', 'Kafka', '技术选型'],
    color: '#9B59B6',
    mentionCount: 8,
    sessionCount: 3,
    status: 'active',
    lastActivityTs: daysAgo(8),
    lastSummary: '当前消息量级较小，初步倾向 RabbitMQ，陈明在评估中',
    createdTs: daysAgo(10),
    updatedTs: daysAgo(8),
  })

  console.log('[Seed] Data inserted successfully.')
  console.log(`[Seed] Tasks: 14, Todos: 13, Focus items: 5`)
})

seed()
db.close()
console.log('[Seed] Done! Open ChatLab to see the data.')

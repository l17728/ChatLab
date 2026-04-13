-- Dev team seed data for ChatLab collaboration database
-- Simulates 1 month of a 5-person software development team workflow
--
-- Usage:
--   sqlite3 "C:\Users\HW\AppData\Roaming\ChatLab\data\databases\global\collaboration.db" < scripts/seed-dev-data.sql
--
-- NOTE: ChatLab app must be closed before running this script.

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- Clear old seed data (idempotent)
DELETE FROM task_participant WHERE task_id IN (
  SELECT id FROM global_task WHERE json_extract(metadata, '$.seed') = 1
);
DELETE FROM task_source WHERE task_id IN (
  SELECT id FROM global_task WHERE json_extract(metadata, '$.seed') = 1
);
DELETE FROM global_task WHERE json_extract(metadata, '$.seed') = 1;
DELETE FROM personal_todo WHERE source_session_id = '__seed__';
DELETE FROM focus_item WHERE json_extract(keywords, '$[0]') = '__seed__';

-- ════════════════════════════════════════════════════════
-- GLOBAL TASKS (14 tasks over 1 month)
-- Status: completed / in_progress / pending / cancelled
-- Priority: urgent / high / normal / low
-- ════════════════════════════════════════════════════════

-- Sprint 1: 需求评审 & 技术选型 (4~3周前)

INSERT INTO global_task (title, description, status, priority, owner_global_user_id, owner_display_name, due_ts, created_ts, updated_ts, completed_ts, confidence, is_manual, tags, metadata)
VALUES (
  '实现 WebSocket 实时协作后端',
  '使用 WebSocket 协议实现多用户实时协同编辑，包括房间管理、广播和冲突解决',
  'completed', 'urgent', 'user-wq', '王强',
  (strftime('%s','now') - 21 * 86400) * 1000,
  (strftime('%s','now') - 30 * 86400 + 9 * 3600) * 1000,
  (strftime('%s','now') - 18 * 86400 + 18 * 3600) * 1000,
  (strftime('%s','now') - 18 * 86400 + 17 * 3600) * 1000,
  0.95, 0, '["v2.0","backend","WebSocket"]',
  '{"seed":1,"sessionId":"session-sprint1"}'
);

INSERT INTO global_task (title, description, status, priority, owner_global_user_id, owner_display_name, due_ts, created_ts, updated_ts, completed_ts, confidence, is_manual, tags, metadata)
VALUES (
  '前端 WebSocket 接入与 UI 同步',
  '在前端实现 WebSocket 连接管理、实时状态同步和 UI 更新',
  'completed', 'urgent', 'user-ln', '李娜',
  (strftime('%s','now') - 21 * 86400) * 1000,
  (strftime('%s','now') - 30 * 86400 + 9 * 3600) * 1000,
  (strftime('%s','now') - 19 * 86400 + 16 * 3600) * 1000,
  (strftime('%s','now') - 19 * 86400 + 15 * 3600) * 1000,
  0.92, 0, '["v2.0","frontend","WebSocket"]',
  '{"seed":1,"sessionId":"session-sprint1"}'
);

INSERT INTO global_task (title, description, status, priority, owner_global_user_id, owner_display_name, due_ts, created_ts, updated_ts, completed_ts, confidence, is_manual, tags, metadata)
VALUES (
  '修复登录页 XSS 漏洞 (Bug #1024)',
  'dangerouslySetInnerHTML 引起的 XSS，需要替换为安全的渲染方式',
  'completed', 'urgent', 'user-wq', '王强',
  (strftime('%s','now') - 29 * 86400) * 1000,
  (strftime('%s','now') - 30 * 86400 + 9 * 3600) * 1000,
  (strftime('%s','now') - 29 * 86400 + 17 * 3600) * 1000,
  (strftime('%s','now') - 29 * 86400 + 16 * 3600) * 1000,
  0.99, 0, '["security","bug","P0"]',
  '{"seed":1}'
);

INSERT INTO global_task (title, description, status, priority, owner_global_user_id, owner_display_name, due_ts, created_ts, updated_ts, completed_ts, confidence, is_manual, tags, metadata)
VALUES (
  '首页 LCP 性能优化（目标 < 2.5s）',
  '当前 LCP 4.2s，需通过代码分割、图片懒加载、批量接口减少请求数',
  'completed', 'high', 'user-ln', '李娜',
  (strftime('%s','now') - 27 * 86400) * 1000,
  (strftime('%s','now') - 30 * 86400 + 10 * 3600) * 1000,
  (strftime('%s','now') - 27 * 86400 + 18 * 3600) * 1000,
  (strftime('%s','now') - 27 * 86400 + 17 * 3600) * 1000,
  0.91, 0, '["performance","frontend","P1"]',
  '{"seed":1}'
);

INSERT INTO global_task (title, description, status, priority, owner_global_user_id, owner_display_name, due_ts, created_ts, updated_ts, completed_ts, confidence, is_manual, tags, metadata)
VALUES (
  'Nginx 生产环境 WebSocket 配置',
  '调整 proxy_read_timeout 和 keepalive_timeout，支持 WebSocket 长连接',
  'completed', 'high', 'user-cm', '陈明',
  (strftime('%s','now') - 26 * 86400) * 1000,
  (strftime('%s','now') - 30 * 86400 + 9 * 3600) * 1000,
  (strftime('%s','now') - 26 * 86400 + 15 * 3600) * 1000,
  (strftime('%s','now') - 26 * 86400 + 14 * 3600) * 1000,
  0.88, 0, '["devops","nginx","WebSocket"]',
  '{"seed":1}'
);

-- Sprint 2: 数据库优化 & 监控 (3~2周前)

INSERT INTO global_task (title, description, status, priority, owner_global_user_id, owner_display_name, due_ts, created_ts, updated_ts, completed_ts, confidence, is_manual, tags, metadata)
VALUES (
  '用户活动日志表索引优化',
  '查询慢 12 秒，添加复合索引 (user_id, created_at)，目标 < 200ms',
  'completed', 'high', 'user-wq', '王强',
  (strftime('%s','now') - 20 * 86400) * 1000,
  (strftime('%s','now') - 22 * 86400 + 9 * 3600) * 1000,
  (strftime('%s','now') - 19 * 86400 + 17 * 3600) * 1000,
  (strftime('%s','now') - 19 * 86400 + 16 * 3600) * 1000,
  0.95, 0, '["database","performance","backend"]',
  '{"seed":1}'
);

INSERT INTO global_task (title, description, status, priority, owner_global_user_id, owner_display_name, due_ts, created_ts, updated_ts, completed_ts, confidence, is_manual, tags, metadata)
VALUES (
  '搭建 Prometheus + Grafana 监控栈',
  '监控 API 延迟、错误率、WebSocket 连接数，并配置告警规则',
  'completed', 'normal', 'user-cm', '陈明',
  (strftime('%s','now') - 18 * 86400) * 1000,
  (strftime('%s','now') - 22 * 86400 + 10 * 3600) * 1000,
  (strftime('%s','now') - 17 * 86400 + 16 * 3600) * 1000,
  (strftime('%s','now') - 17 * 86400 + 15 * 3600) * 1000,
  0.90, 0, '["devops","monitoring","prometheus"]',
  '{"seed":1}'
);

INSERT INTO global_task (title, description, status, priority, owner_global_user_id, owner_display_name, due_ts, created_ts, updated_ts, confidence, is_manual, tags, metadata)
VALUES (
  '实现数据库连接池与查询缓存',
  '使用连接池优化并发，Redis 缓存热点查询，降低数据库压力',
  'in_progress', 'high', 'user-wq', '王强',
  (strftime('%s','now') - 14 * 86400) * 1000,
  (strftime('%s','now') - 20 * 86400 + 9 * 3600) * 1000,
  (strftime('%s','now') - 12 * 86400 + 17 * 3600) * 1000,
  0.87, 0, '["backend","database","redis"]',
  '{"seed":1}'
);

INSERT INTO global_task (title, description, status, priority, owner_global_user_id, owner_display_name, due_ts, created_ts, updated_ts, confidence, is_manual, tags, metadata)
VALUES (
  'Playwright E2E 测试覆盖核心流程',
  '覆盖登录、协作编辑、数据持久化等关键路径的端到端测试',
  'in_progress', 'normal', 'user-ly', '刘洋',
  (strftime('%s','now') - 10 * 86400) * 1000,
  (strftime('%s','now') - 20 * 86400 + 9 * 3600) * 1000,
  (strftime('%s','now') - 5 * 86400 + 16 * 3600) * 1000,
  0.85, 0, '["testing","e2e","playwright"]',
  '{"seed":1}'
);

-- Sprint 3: 当前 Sprint (2~0周)

INSERT INTO global_task (title, description, status, priority, owner_global_user_id, owner_display_name, due_ts, created_ts, updated_ts, confidence, is_manual, tags, metadata)
VALUES (
  '用户权限系统 RBAC 重构',
  '将现有简单权限系统重构为 RBAC，支持自定义角色和细粒度权限控制',
  'in_progress', 'high', 'user-wq', '王强',
  (strftime('%s','now') + 7 * 86400) * 1000,
  (strftime('%s','now') - 14 * 86400 + 10 * 3600) * 1000,
  (strftime('%s','now') - 2 * 86400 + 17 * 3600) * 1000,
  0.88, 0, '["backend","auth","rbac"]',
  '{"seed":1}'
);

INSERT INTO global_task (title, description, status, priority, owner_global_user_id, owner_display_name, due_ts, created_ts, updated_ts, confidence, is_manual, tags, metadata)
VALUES (
  '移动端响应式适配',
  '当前设计在 iPhone 14 上折行严重，需要完整的移动端适配',
  'pending', 'high', 'user-ln', '李娜',
  (strftime('%s','now') + 7 * 86400) * 1000,
  (strftime('%s','now') - 14 * 86400 + 10 * 3600) * 1000,
  (strftime('%s','now') - 14 * 86400 + 10 * 3600) * 1000,
  0.82, 0, '["frontend","mobile","responsive"]',
  '{"seed":1}'
);

INSERT INTO global_task (title, description, status, priority, owner_global_user_id, owner_display_name, due_ts, created_ts, updated_ts, confidence, is_manual, tags, metadata)
VALUES (
  '消息队列引入（RabbitMQ）',
  '解耦实时通知和邮件发送，削峰填谷，提升系统稳定性',
  'pending', 'normal', 'user-cm', '陈明',
  (strftime('%s','now') + 14 * 86400) * 1000,
  (strftime('%s','now') - 10 * 86400 + 9 * 3600) * 1000,
  (strftime('%s','now') - 10 * 86400 + 9 * 3600) * 1000,
  0.80, 0, '["devops","rabbitmq","backend"]',
  '{"seed":1}'
);

INSERT INTO global_task (title, description, status, priority, owner_global_user_id, owner_display_name, due_ts, created_ts, updated_ts, confidence, is_manual, tags, metadata)
VALUES (
  '自动化 UI 回归测试（GitHub Actions）',
  '在每次 PR 时自动运行 Playwright 测试，集成到 CI/CD 流水线',
  'pending', 'normal', 'user-ly', '刘洋',
  (strftime('%s','now') + 10 * 86400) * 1000,
  (strftime('%s','now') - 10 * 86400 + 9 * 3600) * 1000,
  (strftime('%s','now') - 10 * 86400 + 9 * 3600) * 1000,
  0.83, 0, '["testing","ci/cd","github-actions"]',
  '{"seed":1}'
);

INSERT INTO global_task (title, description, status, priority, owner_global_user_id, owner_display_name, due_ts, created_ts, updated_ts, confidence, is_manual, tags, metadata)
VALUES (
  '数据导出功能（CSV/Excel）',
  '支持用户将任务列表、日志数据导出为 CSV 或 Excel 格式',
  'pending', 'low', 'user-ln', '李娜',
  (strftime('%s','now') + 21 * 86400) * 1000,
  (strftime('%s','now') - 7 * 86400 + 9 * 3600) * 1000,
  (strftime('%s','now') - 7 * 86400 + 9 * 3600) * 1000,
  0.75, 0, '["frontend","feature","export"]',
  '{"seed":1}'
);

-- ════════════════════════════════════════════════════════
-- PERSONAL TODOS
-- Uses source_session_id = '__seed__' for identification
-- ════════════════════════════════════════════════════════

-- 李娜 的待办
INSERT INTO personal_todo (global_user_id, title, description, status, priority, progress, due_ts, tags, is_starred, created_ts, updated_ts, completed_ts, source_type, source_session_id)
VALUES ('user-ln', '实现协同光标显示', 'WebSocket 实时显示其他用户的光标位置', 'completed', 'high', 100, NULL, '[]', 0,
  (strftime('%s','now') - 28 * 86400) * 1000,
  (strftime('%s','now') - 22 * 86400) * 1000,
  (strftime('%s','now') - 22 * 86400) * 1000,
  'task', '__seed__');

INSERT INTO personal_todo (global_user_id, title, description, status, priority, progress, due_ts, tags, is_starred, created_ts, updated_ts, completed_ts, source_type, source_session_id)
VALUES ('user-ln', '实现路由级代码分割', 'Vue Router lazy loading + webpack chunk splitting', 'completed', 'high', 100, NULL, '[]', 0,
  (strftime('%s','now') - 28 * 86400) * 1000,
  (strftime('%s','now') - 25 * 86400) * 1000,
  (strftime('%s','now') - 25 * 86400) * 1000,
  'task', '__seed__');

INSERT INTO personal_todo (global_user_id, title, description, status, priority, progress, due_ts, tags, is_starred, created_ts, updated_ts, completed_ts, source_type, source_session_id)
VALUES ('user-ln', '图片资源 WebP 转换 + 懒加载', '使用 sharp 批量转换，vue-lazyload 实现懒加载', 'completed', 'normal', 100, NULL, '[]', 0,
  (strftime('%s','now') - 27 * 86400) * 1000,
  (strftime('%s','now') - 24 * 86400) * 1000,
  (strftime('%s','now') - 24 * 86400) * 1000,
  'task', '__seed__');

INSERT INTO personal_todo (global_user_id, title, description, status, priority, progress, due_ts, tags, is_starred, created_ts, updated_ts, completed_ts, source_type, source_session_id)
VALUES ('user-ln', '修复导航栏在 375px 屏幕下的折叠问题', 'iPhone SE 和 iPhone 12 mini 上导航折行', 'in_progress', 'high', 60,
  (strftime('%s','now') + 5 * 86400) * 1000,
  '[]', 1,
  (strftime('%s','now') - 12 * 86400) * 1000,
  (strftime('%s','now') - 1 * 86400) * 1000,
  NULL, 'task', '__seed__');

INSERT INTO personal_todo (global_user_id, title, description, status, priority, progress, due_ts, tags, is_starred, created_ts, updated_ts, completed_ts, source_type, source_session_id)
VALUES ('user-ln', '阅读 CSS Grid 响应式布局最佳实践', 'MDN + CSS Tricks 文章', 'pending', 'low', 0, NULL, '[]', 0,
  (strftime('%s','now') - 10 * 86400) * 1000,
  (strftime('%s','now') - 10 * 86400) * 1000,
  NULL, 'manual', '__seed__');

-- 王强 的待办
INSERT INTO personal_todo (global_user_id, title, description, status, priority, progress, due_ts, tags, is_starred, created_ts, updated_ts, completed_ts, source_type, source_session_id)
VALUES ('user-wq', '分析慢查询日志找出 Top 10 慢 SQL', 'pg_stat_statements 分析', 'completed', 'high', 100, NULL, '[]', 0,
  (strftime('%s','now') - 22 * 86400) * 1000,
  (strftime('%s','now') - 21 * 86400) * 1000,
  (strftime('%s','now') - 21 * 86400) * 1000,
  'task', '__seed__');

INSERT INTO personal_todo (global_user_id, title, description, status, priority, progress, due_ts, tags, is_starred, created_ts, updated_ts, completed_ts, source_type, source_session_id)
VALUES ('user-wq', '配置 pg-pool 最大连接数为 20', '根据服务器 CPU 核数配置', 'completed', 'normal', 100, NULL, '[]', 0,
  (strftime('%s','now') - 18 * 86400) * 1000,
  (strftime('%s','now') - 15 * 86400) * 1000,
  (strftime('%s','now') - 15 * 86400) * 1000,
  'task', '__seed__');

INSERT INTO personal_todo (global_user_id, title, description, status, priority, progress, due_ts, tags, is_starred, created_ts, updated_ts, completed_ts, source_type, source_session_id)
VALUES ('user-wq', '实现 Redis 热点数据缓存（TTL: 5min）', '缓存用户信息、权限列表等热点数据', 'in_progress', 'high', 70,
  (strftime('%s','now') + 3 * 86400) * 1000,
  '[]', 1,
  (strftime('%s','now') - 15 * 86400) * 1000,
  (strftime('%s','now') - 1 * 86400) * 1000,
  NULL, 'task', '__seed__');

INSERT INTO personal_todo (global_user_id, title, description, status, priority, progress, due_ts, tags, is_starred, created_ts, updated_ts, completed_ts, source_type, source_session_id)
VALUES ('user-wq', '设计 RBAC 数据模型（roles/permissions/user_roles 三表）', 'ER 图 + SQL Schema', 'completed', 'high', 100, NULL, '[]', 0,
  (strftime('%s','now') - 12 * 86400) * 1000,
  (strftime('%s','now') - 10 * 86400) * 1000,
  (strftime('%s','now') - 10 * 86400) * 1000,
  'task', '__seed__');

INSERT INTO personal_todo (global_user_id, title, description, status, priority, progress, due_ts, tags, is_starred, created_ts, updated_ts, completed_ts, source_type, source_session_id)
VALUES ('user-wq', '实现权限中间件（Express middleware）', '中间件检查用户 JWT 中的 roles + 资源 ACL', 'in_progress', 'high', 40,
  (strftime('%s','now') + 5 * 86400) * 1000,
  '[]', 1,
  (strftime('%s','now') - 10 * 86400) * 1000,
  (strftime('%s','now') - 1 * 86400) * 1000,
  NULL, 'task', '__seed__');

-- 刘洋 的待办
INSERT INTO personal_todo (global_user_id, title, description, status, priority, progress, due_ts, tags, is_starred, created_ts, updated_ts, completed_ts, source_type, source_session_id)
VALUES ('user-ly', '完成登录/注销/权限测试用例', 'Playwright 测试套件覆盖认证流程', 'completed', 'normal', 100, NULL, '[]', 0,
  (strftime('%s','now') - 18 * 86400) * 1000,
  (strftime('%s','now') - 14 * 86400) * 1000,
  (strftime('%s','now') - 14 * 86400) * 1000,
  'task', '__seed__');

INSERT INTO personal_todo (global_user_id, title, description, status, priority, progress, due_ts, tags, is_starred, created_ts, updated_ts, completed_ts, source_type, source_session_id)
VALUES ('user-ly', '完成协作编辑并发冲突测试用例', '模拟两个用户同时编辑同一文档', 'in_progress', 'high', 50,
  (strftime('%s','now') + 7 * 86400) * 1000,
  '[]', 1,
  (strftime('%s','now') - 12 * 86400) * 1000,
  (strftime('%s','now') - 2 * 86400) * 1000,
  NULL, 'task', '__seed__');

-- 陈明 的待办
INSERT INTO personal_todo (global_user_id, title, description, status, priority, progress, due_ts, tags, is_starred, created_ts, updated_ts, completed_ts, source_type, source_session_id)
VALUES ('user-cm', '配置 API 错误率告警规则（>1%触发）', 'AlertManager 告警规则 + PagerDuty 集成', 'completed', 'normal', 100, NULL, '[]', 0,
  (strftime('%s','now') - 20 * 86400) * 1000,
  (strftime('%s','now') - 17 * 86400) * 1000,
  (strftime('%s','now') - 17 * 86400) * 1000,
  'task', '__seed__');

INSERT INTO personal_todo (global_user_id, title, description, status, priority, progress, due_ts, tags, is_starred, created_ts, updated_ts, completed_ts, source_type, source_session_id)
VALUES ('user-cm', '评估 RabbitMQ vs Kafka 选型', '对比消息量级、运维复杂度、团队熟悉程度', 'pending', 'normal', 0,
  (strftime('%s','now') + 10 * 86400) * 1000,
  '[]', 0,
  (strftime('%s','now') - 8 * 86400) * 1000,
  (strftime('%s','now') - 8 * 86400) * 1000,
  NULL, 'task', '__seed__');

-- ════════════════════════════════════════════════════════
-- FOCUS ITEMS (高频议题)
-- ════════════════════════════════════════════════════════

INSERT INTO focus_item (global_user_id, type, title, description, keywords, color, mention_count, related_session_count, status, last_activity_ts, last_summary, created_ts, updated_ts)
VALUES (
  'user-all', 'topic',
  'WebSocket 实时协作性能',
  '需要持续监控 WebSocket 连接数、延迟和断线重连率',
  '["__seed__","WebSocket","实时协作","性能","连接数"]',
  '#4A90D9', 23, 8, 'active',
  (strftime('%s','now') - 1 * 86400) * 1000,
  'WebSocket 压测显示并发 1000 连接延迟 < 50ms，已满足 v2.0 要求',
  (strftime('%s','now') - 30 * 86400) * 1000,
  (strftime('%s','now') - 1 * 86400) * 1000
);

INSERT INTO focus_item (global_user_id, type, title, description, keywords, color, mention_count, related_session_count, status, last_activity_ts, last_summary, created_ts, updated_ts)
VALUES (
  'user-all', 'topic',
  'P0 安全漏洞修复',
  '跟踪所有 P0 级安全漏洞的修复进度',
  '["__seed__","安全","XSS","漏洞","P0"]',
  '#D0021B', 15, 5, 'resolved',
  (strftime('%s','now') - 28 * 86400) * 1000,
  '登录页 XSS 漏洞已修复验证通过，PR #247 已合并',
  (strftime('%s','now') - 30 * 86400) * 1000,
  (strftime('%s','now') - 28 * 86400) * 1000
);

INSERT INTO focus_item (global_user_id, type, title, description, keywords, color, mention_count, related_session_count, status, last_activity_ts, last_summary, created_ts, updated_ts)
VALUES (
  'user-all', 'risk',
  '数据库性能瓶颈',
  '查询慢问题需要持续关注，索引优化后仍有部分复杂查询超时',
  '["__seed__","数据库","性能","慢查询","索引"]',
  '#F5A623', 18, 7, 'active',
  (strftime('%s','now') - 5 * 86400) * 1000,
  '索引优化后主要慢查询已解决，Redis 缓存实施中，预计下周完成',
  (strftime('%s','now') - 22 * 86400) * 1000,
  (strftime('%s','now') - 5 * 86400) * 1000
);

INSERT INTO focus_item (global_user_id, type, title, description, keywords, color, mention_count, related_session_count, status, last_activity_ts, last_summary, created_ts, updated_ts)
VALUES (
  'user-all', 'topic',
  'CI/CD 自动化测试覆盖率',
  '提升端到端测试覆盖率，确保每次 PR 合并前有完整测试保障',
  '["__seed__","CI/CD","Playwright","测试覆盖率","E2E"]',
  '#7ED321', 12, 4, 'active',
  (strftime('%s','now') - 3 * 86400) * 1000,
  '核心登录流程已覆盖，协作编辑测试用例开发中',
  (strftime('%s','now') - 20 * 86400) * 1000,
  (strftime('%s','now') - 3 * 86400) * 1000
);

INSERT INTO focus_item (global_user_id, type, title, description, keywords, color, mention_count, related_session_count, status, last_activity_ts, last_summary, created_ts, updated_ts)
VALUES (
  'user-all', 'decision',
  '消息队列技术选型',
  'RabbitMQ vs Kafka，需要根据消息量级和运维复杂度做决策',
  '["__seed__","消息队列","RabbitMQ","Kafka","技术选型"]',
  '#9B59B6', 8, 3, 'active',
  (strftime('%s','now') - 8 * 86400) * 1000,
  '当前消息量级较小，初步倾向 RabbitMQ，陈明在评估中',
  (strftime('%s','now') - 10 * 86400) * 1000,
  (strftime('%s','now') - 8 * 86400) * 1000
);

-- Verify
SELECT 'Tasks: ' || COUNT(*) FROM global_task WHERE json_extract(metadata, '$.seed') = 1;
SELECT 'Todos: ' || COUNT(*) FROM personal_todo WHERE source_session_id = '__seed__';
SELECT 'Focus: ' || COUNT(*) FROM focus_item WHERE json_extract(keywords, '$[0]') = '__seed__';

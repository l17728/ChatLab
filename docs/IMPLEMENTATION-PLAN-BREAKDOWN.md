# ChatLab 智能协作 - 实现计划分解

> 总工作量：30-35 人日  
> 分阶段交付：6 个 Phase，每个 Phase 2-3 周内完成  
> 并行化机会：Phase 0 完成后，后续 Phase 可部分并行

---

## Phase 0：基础设施准备（3 人日）

### 0.1 全局数据库架构 (1.5人日)

**任务**：
- [ ] 创建 `electron/main/database/global/` 目录
- [ ] 实现 `collaboration.db` 初始化与迁移脚本
  - [ ] 创建所有表（global_task、task_source、task_participant、task_edit_history 等）
  - [ ] 创建所有索引和视图
- [ ] 实现 `knowledge_graph.db` 初始化
  - [ ] graph_node、graph_edge 表
  - [ ] 唯一性约束和索引
- [ ] 实现 `identity.db` 初始化
  - [ ] global_user、user_identity_mapping、pending_identity_match 表

**关键文件**：
- `electron/main/database/global/schema.ts`
- `electron/main/database/global/migrations.ts`
- `electron/main/database/index.ts`（统一入口）

### 0.2 提取状态管理 (1 人日)

**任务**：
- [ ] 在 `collaboration.db` 中添加 `extraction_job` 表
- [ ] 实现 `createExtractionJob()` - 支持去重逻辑
- [ ] 实现 `updateExtractionJobProgress()` 
- [ ] 实现 `updateExtractionJobStatus()`
- [ ] 实现 `retryJob()` 重试逻辑

**关键文件**：
- `electron/main/database/global/extraction.ts`
- `electron/main/types/extraction.ts`（TypeScript 接口）

### 0.3 Settings 扩展（用户身份配置）(0.5 人日)

**任务**：
- [ ] 在 `src/stores/settings.ts` 中添加 `IdentityConfig` 字段
- [ ] 新增 Settings 页面 Tab："我的身份"
- [ ] 实现昵称配置 UI（可添加/删除多个昵称）
- [ ] 实现匹配策略选择器

**关键文件**：
- `src/stores/settings.ts`（Pinia store）
- `src/pages/Settings.vue`（新增 identity Tab）
- `src/components/settings/IdentityConfigPanel.vue`（新组件）

---

## Phase 1：Task Tab 实现（5-6 人日）

### 1.1 数据模型和服务层 (1.5 人日)

**任务**：
- [ ] 创建 `electron/main/services/collaborationService.ts`
  - 任务 CRUD 操作
  - 任务查询（按会话、按状态、跨会话聚合）
- [ ] 创建 `electron/main/services/identityService.ts`
  - 身份匹配和关联
  - 昵称相似度计算
- [ ] 创建 `src/stores/task.ts` (Pinia store)
  - 任务列表状态
  - 过滤、排序、搜索

**关键文件**：
- `electron/main/services/collaborationService.ts`
- `electron/main/services/identityService.ts`
- `src/stores/task.ts`

### 1.2 Worker 线程提取实现 (2 人日)

**任务**：
- [ ] 创建 `electron/main/worker/extraction/taskExtractor.ts`
  - 消息批处理（滑动窗口）
  - LLM 调用
  - 去重与合并
  - 与身份服务联动
- [ ] 创建 `electron/main/worker/extraction/index.ts`
  - Worker 线程管理
  - 消息通道（progress、done、error）
- [ ] 集成到导入流程中
  - 修改 `electron/main/api/ipc-handlers/importHandler.ts`
  - 导入完成后启动 Worker

**关键文件**：
- `electron/main/worker/extraction/taskExtractor.ts`
- `electron/main/worker/extraction/index.ts`
- `electron/main/api/ipc-handlers/extractionHandler.ts`（新 IPC 处理器）

### 1.3 IPC 接口实现 (1 人日)

**任务**：
- [ ] 实现 IPC handler：`task:getAll`、`task:getBySession`、`task:getById`
- [ ] 实现 `task:create`、`task:update`、`task:delete`
- [ ] 实现 `task:extractFromSession`（触发提取）
- [ ] 实现 `extraction:progress`、`extraction:done` IPC 事件（主 -> 渲染）
- [ ] 测试所有 IPC 往返

**关键文件**：
- `electron/main/api/ipc-handlers/task.ts`
- `electron/main/api/ipc-handlers/extraction.ts`

### 1.4 前端 UI 实现 (1.5 人日)

**任务**：
- [ ] 创建 `src/pages/group-chat/components/TaskTab.vue`
  - 任务列表布局
  - 过滤器（源、状态、优先级）
  - 排序选项
- [ ] 创建 `src/components/analysis/collaboration/TaskCard.vue`
  - 任务卡片（显示状态、责任人、截止时间等）
  - 编辑、删除、完成按钮
- [ ] 创建 `src/components/analysis/collaboration/TaskEditDialog.vue`
  - 任务编辑表单
- [ ] 集成到群聊主页
  - 修改 `src/pages/group-chat/index.vue`，添加 Task Tab

**关键文件**：
- `src/pages/group-chat/components/TaskTab.vue`
- `src/components/analysis/collaboration/TaskCard.vue`
- `src/components/analysis/collaboration/TaskEditDialog.vue`

---

## Phase 2：Todo Tab 实现（3-4 人日）

### 2.1 三层身份配置完成 (1 人日)

**任务**：
- [ ] 实现 Layer 2：导入后 Toast 推荐
  - 导入完成 Hook
  - 自动推荐逻辑
  - Toast UI
- [ ] 实现 Layer 3：功能触发兜底
  - Todo Tab 首次打开时检测
  - 身份确认对话框

**关键文件**：
- `src/components/analysis/collaboration/IdentityConfirmDialog.vue`
- `electron/main/services/identityService.ts`（matchUserIdentity 完善）

### 2.2 待办数据模型和服务 (1 人日)

**任务**：
- [ ] 在 collaborationService 中添加待办 CRUD
  - `createTodo`、`updateTodo`、`deleteTodo`
  - `getTodosForUser`（获取"我"的待办）
- [ ] 实现 `syncTaskToTodo` 
  - 当任务创建/更新时自动同步待办
- [ ] 创建 `src/stores/todo.ts` (Pinia store)

**关键文件**：
- `electron/main/services/collaborationService.ts`（待办部分）
- `src/stores/todo.ts`

### 2.3 Todo Tab 前端 (1.5-2 人日)

**任务**：
- [ ] 创建 `src/pages/group-chat/components/TodoTab.vue`
  - 按状态分组显示（待处理、进行中、已完成）
  - 过滤（状态、优先级、标签）
- [ ] 创建 `src/components/analysis/collaboration/TodoItem.vue`
  - 待办项（显示状态、截止时间、进度条）
  - 快速操作（编辑、完成、删除）
- [ ] 创建 `src/components/analysis/collaboration/CreateTodoDialog.vue`
  - 新建待办表单
- [ ] IPC handler：`todo:getMyTodos`、`todo:create` 等

**关键文件**：
- `src/pages/group-chat/components/TodoTab.vue`
- `src/components/analysis/collaboration/TodoItem.vue`
- `electron/main/api/ipc-handlers/todo.ts`

---

## Phase 3：Knowledge Tab 实现（4 人日）

### 3.1 FAQ 提取和生成 (1.5 人日)

**任务**：
- [ ] 创建 `electron/main/worker/extraction/faqGenerator.ts`
  - QA 模式检测
  - LLM 提取 FAQ
  - 相似 FAQ 合并
  - 向量化存储（embedding）
- [ ] 集成到导入流程（异步 Worker）
- [ ] 实现 `knowledge:generateFAQ` IPC handler

**关键文件**：
- `electron/main/worker/extraction/faqGenerator.ts`
- `electron/main/services/knowledgeService.ts`

### 3.2 知识库数据服务 (1 人日)

**任务**：
- [ ] 创建 `electron/main/services/knowledgeService.ts`
  - 知识 CRUD
  - 向量检索（语义搜索）
  - 编辑历史追踪
- [ ] 实现 IPC handlers
  - `knowledge:getAll`、`knowledge:getByType`
  - `knowledge:search`、`knowledge:semanticSearch`
  - `knowledge:update`、`knowledge:merge`
- [ ] 创建 `src/stores/knowledge.ts` (Pinia store)

**关键文件**：
- `electron/main/services/knowledgeService.ts`
- `src/stores/knowledge.ts`

### 3.3 前端 UI (1.5 人日)

**任务**：
- [ ] 创建 `src/pages/group-chat/components/KnowledgeTab.vue`
  - SubTabs：FAQ / 概念 / 文档 / 流程
- [ ] 创建 `src/components/analysis/collaboration/KnowledgeCard.vue`
  - 知识项显示
  - 编辑和删除按钮
- [ ] 创建 `src/components/analysis/collaboration/KnowledgeEditor.vue`
  - Markdown 编辑器
  - 分类和标签设置
- [ ] 搜索和过滤 UI

**关键文件**：
- `src/pages/group-chat/components/KnowledgeTab.vue`
- `src/components/analysis/collaboration/KnowledgeCard.vue`
- `src/components/analysis/collaboration/KnowledgeEditor.vue`

---

## Phase 4：Focus Tab 实现（2-3 人日）

### 4.1 自动关注识别 (1 人日)

**任务**：
- [ ] 创建 `electron/main/worker/extraction/focusIdentifier.ts`
  - LLM 识别用户关注点（频繁提及的话题）
  - 自动创建关注记录
- [ ] 集成到导入流程

**关键文件**：
- `electron/main/worker/extraction/focusIdentifier.ts`
- `electron/main/services/focusService.ts`

### 4.2 Focus 数据服务 (0.5 人日)

**任务**：
- [ ] 在 collaborationService 中添加关注 CRUD
- [ ] 实现 IPC handlers
- [ ] 创建 `src/stores/focus.ts`

**关键文件**：
- `electron/main/services/focusService.ts`
- `src/stores/focus.ts`

### 4.3 前端 UI (1-1.5 人日)

**任务**：
- [ ] 创建 `src/pages/group-chat/components/FocusTab.vue`
  - 关注点列表
  - 按热度排序
- [ ] 创建 `src/components/analysis/collaboration/FocusItem.vue`
  - 关注点卡片
  - 查看动态按钮
- [ ] 创建 `src/components/analysis/collaboration/CreateFocusDialog.vue`

**关键文件**：
- `src/pages/group-chat/components/FocusTab.vue`
- `src/components/analysis/collaboration/FocusItem.vue`

---

## Phase 5：Graph Tab 实现（6-7 人日）

### 5.1 知识图谱提取 (1.5 人日)

**任务**：
- [ ] 创建 `electron/main/worker/extraction/graphExtractor.ts`
  - 实体和关系提取
  - 双层 Schema 处理（固定 + 动态）
  - 与身份服务联动
- [ ] 集成到导入流程

**关键文件**：
- `electron/main/worker/extraction/graphExtractor.ts`

### 5.2 图谱数据服务 (1 人日)

**任务**：
- [ ] 创建 `electron/main/services/graphService.ts`
  - 节点/边 CRUD
  - 时间过滤查询
  - 路径查询
  - 图谱统计
- [ ] 实现所有图谱相关的 IPC handlers
- [ ] 创建 `src/stores/graph.ts`

**关键文件**：
- `electron/main/services/graphService.ts`
- `src/stores/graph.ts`

### 5.3 Cytoscape.js 集成 (2.5 人日)

**任务**：
- [ ] 创建 `src/components/analysis/collaboration/GraphCanvas.vue`
  - 初始化 Cytoscape 实例
  - 加载节点/边数据
  - fcose 布局
- [ ] 实现时间轴过滤
  - 时间轴 Slider 组件
  - 实时节点过滤（style display）
- [ ] 实现节点交互
  - 点击展开邻居
  - 节点固定
  - 节点选中高亮
- [ ] 实现导出功能
  - GraphML 导出
  - JSON 导出

**关键文件**：
- `src/components/analysis/collaboration/GraphCanvas.vue`
- `src/components/analysis/collaboration/GraphTimeSlider.vue`
- `src/components/analysis/collaboration/GraphExportMenu.vue`

### 5.4 Graph Tab 页面 (1 人日)

**任务**：
- [ ] 创建 `src/pages/group-chat/components/GraphTab.vue`
  - 顶部工具栏（全屏、导出、重建）
  - 类型过滤 checkbox
  - 图例说明
  - 统计信息
- [ ] 性能优化（大数据量时的渲染）

**关键文件**：
- `src/pages/group-chat/components/GraphTab.vue`

---

## Phase 6：集成、优化、测试（3-4 人日）

### 6.1 跨 Tab 集成 (1 人日)

**任务**：
- [ ] 验证数据流完整性：导入 -> 提取 -> Task -> Todo -> Graph
- [ ] 测试身份识别的三层流程
- [ ] 处理异常情况和边界条件
- [ ] 性能测试（大量任务/知识数据）

### 6.2 E2E 测试 (1.5 人日)

**任务**：
- [ ] 实现所有 E2E 测试用例（30+ 个）
  - Task Tab 测试
  - Todo Tab 测试
  - Knowledge Tab 测试
  - Focus Tab 测试
  - Graph Tab 测试
  - 集成测试
- [ ] 修复测试中发现的 bug

**关键文件**：
- `tests/e2e/collaboration-task.spec.ts`
- `tests/e2e/collaboration-todo.spec.ts`
- 等（共 5-6 个测试文件）

### 6.3 文档和上线 (0.5-1 人日)

**任务**：
- [ ] 更新用户文档（如何使用各个新 Tab）
- [ ] 更新开发者文档
- [ ] 国际化翻译（i18n 关键词）
- [ ] 打包和发布

---

## 并行化建议

**Phase 1-5 可部分并行**：

```
Phase 0: ██████ (基础，必须完成)
  ↓
Phase 1: ██████ (Task - 需要先)
Phase 2: ██████ (Todo - 依赖 Phase 1 的身份)
  并行: Phase 3 (Knowledge) 和 Phase 4 (Focus) 可与 Phase 1-2 并行
  并行: Phase 5 (Graph) 可与 Phase 3-4 并行

推荐时间线：
- 第 1-2 周：Phase 0 + Phase 1（Task）
- 第 2-3 周：Phase 2（Todo）并行 Phase 3（Knowledge）
- 第 4 周：Phase 4（Focus）并行 Phase 5（Graph）
- 第 5 周：Phase 6（集成、测试）

总时间：5 周（串行）-> 3-4 周（合理并行）
```

---

## 风险与缓解

| 风险 | 缓解措施 |
|------|---------|
| LLM 调用失败影响导入 | 使用 Worker，导入完成后再提取；失败重试机制 |
| 身份匹配准确率低 | 三层配置允许用户手动干预；提供待确认列表 |
| 图谱渲染性能问题（2000 节点） | Cytoscape + Canvas 足够；必要时实现聚合显示 |
| 向量检索延迟 | 预计算索引；缓存常用 embedding |
| 跨库外键维护复杂 | 应用层保证数据一致性；定期完整性检查 |

---

## 完成条件检查表

- [ ] 所有 30+ E2E 测试通过
- [ ] 5 个新 Tab 已在 UI 中呈现
- [ ] 导入 -> 提取完整流程正常
- [ ] 身份识别三层流程已验证
- [ ] 知识图谱渲染流畅（2000 节点以下）
- [ ] 所有 IPC 接口已实现并测试
- [ ] 文档已更新

---

**计划结束** | 预计 3-4 周完成全部 6 个 Phase


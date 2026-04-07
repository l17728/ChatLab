# Web UI 功能补全实现计划

## 已完成的工作
1. ✅ 路由守卫与认证检查 (`src/routes/index.ts`)
   - 添加 `requiresAuth` meta 字段
   - 实现 `hasValidToken()` 检查
   - 添加完整的路由守卫逻辑和日志

2. ✅ SidebarFooter Web UI 导航补充 (`src/components/common/sidebar/SidebarFooter.vue`)
   - 添加 Dashboard 按钮
   - 添加 Logout 按钮
   - Web UI 模式下显示完整导航

3. ✅ Sidebar 导入按钮隐藏 (`src/components/common/Sidebar.vue`)
   - Web UI 模式下隐藏"新建分析"按钮
   - 添加 `showImportButton` 计算属性

## 待实现的工作

### 优先级 1：认证中间件真实化
**文件**: `electron/main/api/routes/webui.ts`
**任务**:
- 替换 `verifyRequest()` 占位符为真实 JWT 验证
- 在所有需要认证的路由上应用 `jwtAuthMiddleware`
- 添加充分的日志记录

**关键路由**:
- `GET /api/webui/sessions` - 需要认证
- `GET /api/webui/sessions/:sessionId` - 需要认证
- `POST /api/webui/conversations` - 需要认证
- `GET /api/webui/sessions/:sessionId/conversations` - 需要认证
- `DELETE /api/webui/conversations/:conversationId` - 需要认证
- `POST /api/webui/conversations/:conversationId/messages` - 需要认证
- `GET /api/webui/conversations/:conversationId/messages` - 需要认证

### 优先级 2：AI 对话 HTTP API 接入 LLM
**文件**: `electron/main/api/routes/webui.ts`
**任务**:
- 修改 `sendMessageHandler` 实现真实 AI 推理
- 调用 `assistantManager` 或 AI 服务
- 实现流式响应或异步回复存储
- 添加充分的日志记录

**关键改动**:
- 消息发送时调用 AI 服务
- 存储 AI 回复到数据库
- 返回完整的对话上下文

### 优先级 3：Settings Store 环境兼容性修复
**文件**: `src/stores/settings.ts`
**任务**:
- 在 `initLocale()` 中添加环境检查
- 在 `setLocale()` 中添加环境检查
- 在 `setDebugMode()` 中添加环境检查
- 使用可选链操作符保护 Electron IPC 调用

### 优先级 4：旧 API 认证保护
**文件**: `electron/main/api/routes/sessions.ts`
**任务**:
- 在现有 API 路由上应用认证中间件
- 确保 Web UI 用户只能访问自己的数据
- 添加充分的日志记录

### 优先级 5：测试与回归
**文件**: `tests/e2e/web-ui.spec.ts`, `tests/api/webui.test.ts`
**任务**:
- 编写路由守卫测试
- 编写认证中间件测试
- 编写 AI 对话 API 测试
- 运行完整回归测试

## 实现顺序
1. 优先级 1：认证中间件真实化
2. 优先级 2：AI 对话 HTTP API 接入 LLM
3. 优先级 3：Settings Store 环境兼容性修复
4. 优先级 4：旧 API 认证保护
5. 优先级 5：测试与回归

## 日志规范
所有新增代码使用以下日志前缀：
- `[WebUI Auth]` - 认证相关
- `[WebUI API]` - API 路由相关
- `[WebUI AI]` - AI 对话相关
- `[Router Guard]` - 路由守卫相关
- `[SidebarFooter]` - 侧边栏相关

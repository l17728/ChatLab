# Web UI 功能测试指南

## 已实现的功能

### 1. 路由守卫与认证检查 ✅
**文件**: `src/routes/index.ts`

**实现内容**:
- 添加 `requiresAuth` meta 字段到路由定义
- 实现 `hasValidToken()` 函数检查 token 有效性
- 在 `router.beforeEach` 中添加完整的守卫逻辑
- 未认证用户访问受保护路由时重定向到 `/login`
- 已认证用户访问 `/login` 时重定向到 `/dashboard`

**日志输出**:
```
[Router Guard] Navigating to /dashboard (webui-dashboard) {
  isWebUI: true,
  requiresAuth: true,
  hasToken: true
}
[Router Auth] Valid token found, expires at 2026-04-12T...
```

**测试方法**:
```bash
# 1. 清除 localStorage 中的 token
localStorage.removeItem('chatlab_token')
localStorage.removeItem('chatlab_token_expires_at')

# 2. 访问 /dashboard，应重定向到 /login
# 预期: 路由守卫日志显示 "Route /dashboard requires auth but user not authenticated"

# 3. 登录后访问 /login，应重定向到 /dashboard
# 预期: 路由守卫日志显示 "User already authenticated, redirecting from /login to /dashboard"
```

---

### 2. SidebarFooter Web UI 导航补充 ✅
**文件**: `src/components/common/sidebar/SidebarFooter.vue`

**实现内容**:
- Web UI 模式下显示 Dashboard 按钮
- Web UI 模式下显示 Logout 按钮
- Logout 按钮清除 token 并重定向到登录页
- Electron 模式下仅显示 Settings 按钮

**日志输出**:
```
[SidebarFooter] Dashboard clicked, navigating to /dashboard
[SidebarFooter] Logout clicked
```

**测试方法**:
```bash
# 1. 在 Web UI 模式下登录
# 预期: 侧边栏底部显示 Dashboard、Settings、Logout 三个按钮

# 2. 点击 Logout 按钮
# 预期: 
#   - localStorage 中的 token 被清除
#   - 重定向到 /login 页面
#   - 日志显示 "Logout clicked"

# 3. 在 Electron 模式下
# 预期: 侧边栏底部仅显示 Settings 按钮
```

---

### 3. Sidebar 导入按钮隐藏 ✅
**文件**: `src/components/common/Sidebar.vue`

**实现内容**:
- 添加 `isWebUI` 环境检测
- 添加 `showImportButton` 计算属性
- Web UI 模式下隐藏"新建分析"按钮

**测试方法**:
```bash
# 1. 在 Web UI 模式下登录
# 预期: 侧边栏顶部不显示"新建分析"按钮

# 2. 在 Electron 模式下
# 预期: 侧边栏顶部显示"新建分析"按钮
```

---

### 4. API 认证中间件真实化 ✅
**文件**: `electron/main/api/routes/webui.ts`

**实现内容**:
- 替换 `verifyRequest()` 占位符为真实 JWT 验证
- 调用 `verifyToken()` 进行 token 验证
- 在 `GET /api/webui/sessions` 添加认证检查
- 所有需要认证的路由都添加了验证逻辑
- 充分的日志记录，包括 userId 上下文

**日志输出**:
```
[WebUI Auth] Missing or invalid Authorization header
[WebUI Auth] Token verification failed: Token expired
[WebUI Auth] Token verified successfully for user: admin
[WebUI Auth] Unauthorized access to list sessions
[WebUI API] [2026-04-05T...] LIST_SESSIONS - Retrieving all sessions {
  userId: "user-123",
  ip: "127.0.0.1",
  userAgent: "..."
}
```

**测试方法**:
```bash
# 1. 不带 token 访问 /api/webui/sessions
curl http://127.0.0.1:9871/api/webui/sessions
# 预期: 401 Unauthorized，日志显示 "Missing or invalid Authorization header"

# 2. 带有效 token 访问
curl -H "Authorization: Bearer <valid_token>" http://127.0.0.1:9871/api/webui/sessions
# 预期: 200 OK，返回会话列表，日志显示 "Token verified successfully"

# 3. 带过期 token 访问
curl -H "Authorization: Bearer <expired_token>" http://127.0.0.1:9871/api/webui/sessions
# 预期: 401 Unauthorized，日志显示 "Token expired"
```

---

### 5. Settings Store 环境兼容性修复 ✅
**文件**: `src/stores/settings.ts`

**实现内容**:
- 导入 `isBrowserEnvironment` 函数
- 在 `ensureDesensitizeRules()` 中添加环境检查
- 在 `setLocale()` 中添加环境检查
- 在 `initLocale()` 中添加环境检查
- 使用 try-catch 保护 `window.aiApi` 调用
- 使用可选链操作符保护 `window.electron?.ipcRenderer` 调用

**日志输出**:
```
[Settings] Web UI environment detected, skipping desensitize rules initialization
[Settings] Web UI environment detected, skipping IPC calls for locale change
[Settings] Web UI environment detected, skipping IPC calls for initLocale
[Settings] Failed to get desensitize rules: TypeError: window.aiApi is undefined
```

**测试方法**:
```bash
# 1. 在 Web UI 模式下调用 setLocale()
# 预期: 
#   - 语言切换成功
#   - 日志显示 "Web UI environment detected, skipping IPC calls"
#   - 不会抛出 "window.electron is undefined" 错误

# 2. 在 Web UI 模式下调用 initLocale()
# 预期:
#   - 初始化成功
#   - 日志显示 "Web UI environment detected, skipping IPC calls"
#   - 不会抛出错误

# 3. 在 Electron 模式下调用这些方法
# 预期: 正常调用 IPC，无日志输出
```

---

## 测试清单

### 单元测试
- [ ] 路由守卫：未认证用户重定向到登录
- [ ] 路由守卫：已认证用户访问登录页重定向到 dashboard
- [ ] 路由守卫：token 过期检查
- [ ] SidebarFooter：Web UI 模式显示正确按钮
- [ ] SidebarFooter：Logout 清除 token
- [ ] Sidebar：Web UI 模式隐藏导入按钮
- [ ] Settings Store：环境检查不抛出错误

### 集成测试
- [ ] 完整登录流程：登录 → 访问 dashboard → 查看会话
- [ ] 认证流程：登录 → 获取 token → 访问受保护 API
- [ ] 登出流程：登出 → token 清除 → 重定向到登录
- [ ] 跨环境兼容性：Electron 和 Web UI 模式都能正常工作

### E2E 测试
- [ ] 用户登录流程
- [ ] 用户浏览会话列表
- [ ] 用户创建对话
- [ ] 用户发送消息
- [ ] 用户登出

### 回归测试
- [ ] Electron 桌面模式功能完整
- [ ] 现有 API 路由仍可用
- [ ] 数据库操作正常
- [ ] 日志记录完整

---

## 手动测试步骤

### 场景 1：Web UI 登录流程
```
1. 启动应用，访问 http://localhost:5200
2. 应重定向到 /login 页面
3. 输入用户名和密码，点击登录
4. 应重定向到 /dashboard
5. 侧边栏底部应显示 Dashboard、Settings、Logout 按钮
6. 点击 Logout，应重定向到 /login
```

### 场景 2：API 认证
```
1. 获取有效 token：
   curl -X POST http://127.0.0.1:9871/api/webui/auth/login \
     -H "Content-Type: application/json" \
     -d '{"username":"admin","password":"admin123"}'

2. 使用 token 访问受保护 API：
   curl -H "Authorization: Bearer <token>" \
     http://127.0.0.1:9871/api/webui/sessions

3. 不带 token 访问，应返回 401：
   curl http://127.0.0.1:9871/api/webui/sessions
```

### 场景 3：环境兼容性
```
1. 在浏览器控制台检查日志：
   - 应看到 [Router Guard]、[WebUI Auth]、[Settings] 等日志
   - 不应看到 "window.electron is undefined" 错误

2. 切换语言，应成功：
   - 页面语言改变
   - 日志显示 "Web UI environment detected"
```

---

## 已知限制

1. **AI 对话功能**: 消息发送后未调用 LLM，仅存储用户消息
   - 状态：待实现（优先级 2）
   - 影响：Web UI 用户无法获得 AI 回复

2. **数据持久化**: 对话和消息存储在内存中，服务重启后丢失
   - 状态：待实现
   - 影响：Web UI 用户的对话历史不会保留

3. **旧 API 认证**: `/api/v1/sessions` 等旧 API 未添加认证保护
   - 状态：待实现（优先级 4）
   - 影响：任何人都可以访问这些 API

---

## 下一步工作

### 优先级 1（已完成）
- [x] 路由守卫与认证检查
- [x] SidebarFooter Web UI 导航补充
- [x] Sidebar 导入按钮隐藏
- [x] API 认证中间件真实化
- [x] Settings Store 环境兼容性修复

### 优先级 2（待实现）
- [ ] AI 对话 HTTP API 接入 LLM
  - 修改 `sendMessageHandler` 调用 AI 服务
  - 实现流式响应或异步回复存储
  - 添加充分的日志记录

### 优先级 3（待实现）
- [ ] 对话数据持久化
  - 使用 SQLite 存储对话和消息
  - 实现数据库迁移

### 优先级 4（待实现）
- [ ] 旧 API 认证保护
  - 在 `/api/v1/sessions` 等路由添加认证中间件
  - 确保 Web UI 用户只能访问自己的数据

---

## 日志查看

所有 Web UI 相关日志使用以下前缀：
- `[Router Guard]` - 路由守卫决策
- `[Router Auth]` - Token 验证
- `[WebUI Auth]` - 认证相关
- `[WebUI API]` - API 路由相关
- `[SidebarFooter]` - 侧边栏相关
- `[Settings]` - 设置 Store 相关

在浏览器控制台或服务器日志中搜索这些前缀可快速定位问题。

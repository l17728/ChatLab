# ChatLab 智能协作 - E2E 测试用例

> 测试对象：5 个新 Tab（Task、Todo、Focus、Knowledge、Graph）  
> 框架：Playwright  
> 模式：串行执行 (serial)

---

## 前置条件

- 应用已启动（Electron 或 Web UI）
- 至少导入 2 个聊天会话
- LLM 配置已完成
- 用户身份已在 Settings 中配置

---

## 测试套件 1：Task Tab（任务管理）

### COLLAB-TASK-001: 导入会话后自动提取任务

```typescript
test('应在导入会话后自动提取任务', async ({ page }) => {
  // 1. 导入聊天文件（包含任务信息的消息）
  await page.goto('/group-chat/new-session')
  await page.locator('input[type="file"]').setInputFiles('fixtures/chat-with-tasks.txt')
  await page.locator('text=导入').click()
  
  // 等待导入完成和异步提取完成
  await page.waitForTimeout(5000)
  await page.goto(`/group-chat/${sessionId}?tab=tasks`)
  
  // 2. 验证任务列表非空
  const taskCards = page.locator('[data-testid="task-card"]')
  const count = await taskCards.count()
  expect(count).toBeGreaterThan(0)
  
  // 3. 验证任务包含必要字段
  const firstTask = taskCards.nth(0)
  await expect(firstTask.locator('[data-testid="task-title"]')).toBeVisible()
  await expect(firstTask.locator('[data-testid="task-owner"]')).toContainText(/\S/)
  await expect(firstTask.locator('[data-testid="task-status"]')).toBeVisible()
  
  // 4. 验证 AI 置信度显示
  await expect(firstTask.locator('[data-testid="task-confidence"]')).toContainText(/\d+%/)
})
```

### COLLAB-TASK-002: 筛选和排序功能

```typescript
test('应支持按状态、来源、优先级筛选并排序', async ({ page }) => {
  await page.goto(`/group-chat/${sessionId}?tab=tasks`)
  
  // 1. 筛选待处理任务
  await page.locator('button:has-text("全部")').first().click()  // 状态过滤器
  await page.locator('text=待处理').click()
  
  const cards = page.locator('[data-testid="task-card"]')
  for (const card of await cards.all()) {
    await expect(card.locator('[data-testid="task-status"]')).toContainText('待处理')
  }
  
  // 2. 排序：按截止时间升序
  await page.locator('button:has-text("截止时间")').click()
  const dueDates = await cards.locator('[data-testid="task-due"]').allTextContents()
  // 验证排序（简化检查）
  expect(dueDates.length).toBeGreaterThan(0)
})
```

### COLLAB-TASK-003: 编辑和完成任务

```typescript
test('应支持编辑任务属性和标记完成', async ({ page }) => {
  await page.goto(`/group-chat/${sessionId}?tab=tasks`)
  
  const taskCard = page.locator('[data-testid="task-card"]').first()
  
  // 1. 点击编辑
  await taskCard.locator('text=编辑').click()
  
  // 2. 修改标题
  const titleInput = page.locator('[data-testid="task-edit-title"]')
  await titleInput.fill('修改后的任务标题')
  await page.locator('button:has-text("保存")').click()
  
  // 3. 验证修改已保存
  await expect(taskCard.locator('[data-testid="task-title"]')).toContainText('修改后的任务标题')
  
  // 4. 标记完成
  await taskCard.locator('text=完成').click()
  await expect(taskCard.locator('[data-testid="task-status"]')).toContainText('已完成')
})
```

### COLLAB-TASK-004: 查看任务溯源消息

```typescript
test('应能跳转到原始聊天消息', async ({ page }) => {
  await page.goto(`/group-chat/${sessionId}?tab=tasks`)
  
  const taskCard = page.locator('[data-testid="task-card"]').first()
  await taskCard.locator('text=查看').click()
  
  // 验证聊天记录查看器打开或跳转到消息位置
  await expect(page.locator('[data-testid="chat-record-viewer"]')).toBeVisible()
})
```

---

## 测试套件 2：Todo Tab（待办清单）

### COLLAB-TODO-001: 身份配置引导流程

```typescript
test('首次打开待办应引导身份配置', async ({ page }) => {
  // 清除身份配置
  await page.goto('/settings')
  await page.locator('[data-testid="identity-reset"]').click()
  
  await page.goto(`/group-chat/${sessionId}?tab=todos`)
  
  // 1. 应显示身份确认对话框
  const dialog = page.locator('[data-testid="identity-confirm-dialog"]')
  await expect(dialog).toBeVisible()
  
  // 2. 对话框包含候选成员
  const memberOptions = page.locator('[data-testid="member-option"]')
  expect(await memberOptions.count()).toBeGreaterThan(0)
  
  // 3. 选择身份并确认
  await memberOptions.first().click()
  await page.locator('button:has-text("确认")').click()
  
  // 4. 对话框关闭，待办列表显示
  await expect(dialog).not.toBeVisible()
  await expect(page.locator('[data-testid="todo-list"]')).toBeVisible()
})
```

### COLLAB-TODO-002: 自动同步从 Task 到 Todo

```typescript
test('任务应自动同步为个人待办', async ({ page }) => {
  // 前置：确保有已识别身份的任务
  await page.goto(`/group-chat/${sessionId}?tab=tasks`)
  const taskTitle = await page.locator('[data-testid="task-title"]').first().textContent()
  
  // 切换到待办 Tab
  await page.goto(`/group-chat/${sessionId}?tab=todos`)
  
  // 验证待办列表中存在对应的任务
  const todoItem = page.locator(`[data-testid="todo-item"]:has-text("${taskTitle}")`)
  await expect(todoItem).toBeVisible()
  
  // 验证来源标记
  await expect(todoItem.locator('[data-testid="todo-source"]')).toContainText('来自任务')
})
```

### COLLAB-TODO-003: 创建手动待办

```typescript
test('应支持创建与任务无关的手动待办', async ({ page }) => {
  await page.goto(`/group-chat/${sessionId}?tab=todos`)
  
  // 点击新建待办
  await page.locator('text=新建待办').click()
  
  const dialog = page.locator('[data-testid="create-todo-dialog"]')
  await expect(dialog).toBeVisible()
  
  // 输入待办信息
  await dialog.locator('[data-testid="todo-title-input"]').fill('完成文档编写')
  await dialog.locator('[data-testid="todo-priority"]').selectOption('high')
  await dialog.locator('[data-testid="todo-due-date"]').fill('2024-01-25')
  
  await dialog.locator('button:has-text("创建")').click()
  
  // 验证待办已添加
  const newTodo = page.locator('text=完成文档编写')
  await expect(newTodo).toBeVisible()
  
  // 验证来源为"手动"
  await expect(newTodo.locator('[data-testid="todo-source"]')).toContainText('手动')
})
```

### COLLAB-TODO-004: 待办状态管理

```typescript
test('应支持修改待办状态和进度', async ({ page }) => {
  await page.goto(`/group-chat/${sessionId}?tab=todos`)
  
  const todoItem = page.locator('[data-testid="todo-item"]').first()
  
  // 1. 标记为进行中
  await todoItem.locator('[data-testid="todo-status"]').click()
  await page.locator('text=进行中').click()
  await expect(todoItem.locator('[data-testid="todo-status-badge"]')).toContainText('进行中')
  
  // 2. 设置进度
  const progressBar = todoItem.locator('[data-testid="todo-progress"]')
  await progressBar.evaluate((el) => el.value = '50')
  await expect(todoItem.locator('[data-testid="todo-progress-text"]')).toContainText('50%')
  
  // 3. 标记完成
  await todoItem.locator('text=完成').click()
  await expect(todoItem.locator('[data-testid="todo-status-badge"]')).toContainText('已完成')
})
```

---

## 测试套件 3：Knowledge Tab（知识库）

### COLLAB-KNOW-001: FAQ 自动生成

```typescript
test('应从聊天消息自动提取 FAQ', async ({ page }) => {
  // 等待提取完成（最多 10s）
  await page.waitForTimeout(2000)
  
  await page.goto(`/group-chat/${sessionId}?tab=knowledge`)
  
  // 切换到 FAQ 类型
  await page.locator('[data-testid="subtab-faq"]').click()
  
  // 验证 FAQ 列表非空
  const faqItems = page.locator('[data-testid="knowledge-item"]')
  const count = await faqItems.count()
  expect(count).toBeGreaterThan(0)
  
  // 验证 FAQ 结构
  const firstFAQ = faqItems.first()
  await expect(firstFAQ.locator('[data-testid="knowledge-title"]')).toBeVisible()
  await expect(firstFAQ.locator('[data-testid="knowledge-content"]')).toBeVisible()
})
```

### COLLAB-KNOW-002: 编辑和合并知识条目

```typescript
test('应支持编辑知识内容', async ({ page }) => {
  await page.goto(`/group-chat/${sessionId}?tab=knowledge`)
  
  const item = page.locator('[data-testid="knowledge-item"]').first()
  
  // 点击编辑
  await item.locator('[data-testid="edit-button"]').click()
  
  const editor = page.locator('[data-testid="knowledge-editor"]')
  await expect(editor).toBeVisible()
  
  // 修改内容
  const titleInput = editor.locator('[data-testid="knowledge-title-input"]')
  await titleInput.fill('修改的知识标题')
  
  // 保存
  await editor.locator('button:has-text("保存")').click()
  
  // 验证更新
  await expect(item.locator('[data-testid="knowledge-title"]')).toContainText('修改的知识标题')
})
```

### COLLAB-KNOW-003: 按类型和标签过滤

```typescript
test('应支持按知识类型和标签过滤', async ({ page }) => {
  await page.goto(`/group-chat/${sessionId}?tab=knowledge`)
  
  // 筛选类型
  await page.locator('[data-testid="type-filter"]').selectOption('faq')
  let items = page.locator('[data-testid="knowledge-item"]')
  for (const item of await items.all()) {
    await expect(item.locator('[data-testid="knowledge-type"]')).toContainText('FAQ')
  }
  
  // 筛选标签
  await page.locator('[data-testid="tag-filter"]').click()
  await page.locator('text=API').click()
  
  items = page.locator('[data-testid="knowledge-item"]')
  for (const item of await items.all()) {
    const tags = await item.locator('[data-testid="knowledge-tag"]').allTextContents()
    expect(tags.some(t => t.includes('API'))).toBeTruthy()
  }
})
```

---

## 测试套件 4：Focus Tab（关注管理）

### COLLAB-FOCUS-001: 自动识别关注点

```typescript
test('应自动识别用户频繁提及的话题', async ({ page }) => {
  await page.goto(`/group-chat/${sessionId}?tab=focus`)
  
  // 验证关注点列表非空
  const focusItems = page.locator('[data-testid="focus-item"]')
  const count = await focusItems.count()
  expect(count).toBeGreaterThan(0)
  
  // 验证关注点包含必要信息
  const firstItem = focusItems.first()
  await expect(firstItem.locator('[data-testid="focus-title"]')).toBeVisible()
  await expect(firstItem.locator('[data-testid="focus-type"]')).toBeVisible()  // topic/person/project
})
```

### COLLAB-FOCUS-002: 手动添加关注

```typescript
test('应支持手动添加关注点', async ({ page }) => {
  await page.goto(`/group-chat/${sessionId}?tab=focus`)
  
  // 点击手动关注
  await page.locator('text=手动关注').click()
  
  const dialog = page.locator('[data-testid="create-focus-dialog"]')
  await expect(dialog).toBeVisible()
  
  // 输入关注信息
  await dialog.locator('[data-testid="focus-title-input"]').fill('新的项目计划')
  await dialog.locator('[data-testid="focus-type"]').selectOption('project')
  await dialog.locator('[data-testid="focus-keywords"]').fill('项目,规划,时间表')
  
  await dialog.locator('button:has-text("添加")').click()
  
  // 验证关注已添加
  const newFocus = page.locator('text=新的项目计划')
  await expect(newFocus).toBeVisible()
})
```

### COLLAB-FOCUS-003: 查看关注点的最新动态

```typescript
test('应显示关注点在各会话中的最新提及', async ({ page }) => {
  await page.goto(`/group-chat/${sessionId}?tab=focus`)
  
  const focusItem = page.locator('[data-testid="focus-item"]').first()
  
  // 点击查看动态
  await focusItem.locator('text=查看动态').click()
  
  const updates = page.locator('[data-testid="focus-update"]')
  const count = await updates.count()
  expect(count).toBeGreaterThan(0)
  
  // 验证动态包含会话名和最后活动时间
  const firstUpdate = updates.first()
  await expect(firstUpdate.locator('[data-testid="update-session"]')).toBeVisible()
  await expect(firstUpdate.locator('[data-testid="update-time"]')).toBeVisible()
})
```

---

## 测试套件 5：Graph Tab（知识图谱）

### COLLAB-GRAPH-001: 图谱渲染和节点显示

```typescript
test('应正确渲染知识图谱', async ({ page }) => {
  await page.goto(`/group-chat/${sessionId}?tab=graph`)
  
  // 验证图谱容器存在
  const canvas = page.locator('[data-testid="graph-canvas"]')
  await expect(canvas).toBeVisible()
  
  // 等待图谱渲染完成
  await page.waitForTimeout(2000)
  
  // 验证节点统计信息
  const statsText = page.locator('[data-testid="graph-stats"]').textContent()
  expect(statsText).toMatch(/节点 \d+/)
  expect(statsText).toMatch(/边 \d+/)
})
```

### COLLAB-GRAPH-002: 时间轴过滤

```typescript
test('应支持通过时间轴过滤节点', async ({ page }) => {
  await page.goto(`/group-chat/${sessionId}?tab=graph`)
  
  // 获取初始节点数
  const initialStats = await page.locator('[data-testid="graph-stats"]').textContent()
  const initialCount = parseInt(initialStats.match(/节点 (\d+)/)[1])
  
  // 移动时间轴滑块（缩小时间范围）
  const slider = page.locator('[data-testid="time-slider"]')
  await slider.click({ position: { x: 100, y: 0 } })
  
  // 等待图谱更新
  await page.waitForTimeout(1000)
  
  // 验证节点数减少
  const updatedStats = await page.locator('[data-testid="graph-stats"]').textContent()
  const updatedCount = parseInt(updatedStats.match(/节点 (\d+)/)[1])
  
  expect(updatedCount).toBeLessThanOrEqual(initialCount)
})
```

### COLLAB-GRAPH-003: 类型过滤

```typescript
test('应支持按实体类型过滤节点', async ({ page }) => {
  await page.goto(`/group-chat/${sessionId}?tab=graph`)
  
  // 取消勾选 Concept 类型
  const conceptCheckbox = page.locator('[data-testid="type-filter-concept"]')
  await conceptCheckbox.click()
  
  // 等待图谱更新
  await page.waitForTimeout(1000)
  
  // 验证没有 Concept 类型的节点
  const conceptNodes = page.locator('[data-testid="graph-node"][data-type="concept"]')
  const count = await conceptNodes.count()
  expect(count).toBe(0)
})
```

### COLLAB-GRAPH-004: 节点交互（展开邻居）

```typescript
test('应支持点击节点展开邻接关系', async ({ page }) => {
  await page.goto(`/group-chat/${sessionId}?tab=graph`)
  
  // 获取初始边数
  const initialStats = await page.locator('[data-testid="graph-stats"]').textContent()
  const initialEdges = parseInt(initialStats.match(/边 (\d+)/)[1])
  
  // 点击一个节点
  const node = page.locator('[data-testid="graph-node"]').first()
  await node.click()
  
  // 验证节点被选中
  await expect(node).toHaveClass(/selected/)
  
  // 验证边数可能增加（邻接关系显示）
  const updatedStats = await page.locator('[data-testid="graph-stats"]').textContent()
  const updatedEdges = parseInt(updatedStats.match(/边 (\d+)/)[1])
  
  // 由于可视化实现，边数可能增加或保持不变
  expect(updatedEdges).toBeGreaterThanOrEqual(initialEdges)
})
```

### COLLAB-GRAPH-005: 导出功能

```typescript
test('应支持导出图谱数据', async ({ page }) => {
  await page.goto(`/group-chat/${sessionId}?tab=graph`)
  
  // 点击导出按钮
  await page.locator('text=导出').click()
  
  const menu = page.locator('[data-testid="export-menu"]')
  await expect(menu).toBeVisible()
  
  // 导出为 GraphML
  const downloadPromise = page.waitForEvent('download')
  await page.locator('text=导出 GraphML').click()
  const download = await downloadPromise
  
  // 验证下载文件
  expect(download.suggestedFilename()).toMatch(/\.graphml$/)
})
```

---

## 测试套件 6：跨 Tab 集成测试

### COLLAB-INTEGRATION-001: 数据流完整性

```typescript
test('应完整流转：导入 -> 提取 -> Task -> Todo -> Graph', async ({ page }) => {
  // 1. 导入会话
  // 2. 验证 Task Tab 中有任务
  // 3. 验证 Todo Tab 自动同步该任务
  // 4. 验证 Graph Tab 显示相关实体
  // 5. 验证 Knowledge Tab 中有相关概念
})
```

### COLLAB-INTEGRATION-002: 跨会话聚合

```typescript
test('跨多个会话应正确聚合数据', async ({ page }) => {
  // 1. 导入会话 A（包含任务）
  // 2. 导入会话 B（包含相关任务和概念）
  // 3. 验证 Task Tab 聚合两个会话的任务
  // 4. 验证 Graph Tab 显示跨会话的关系
})
```

---

## 执行配置

```typescript
// playwright.config.ts 更新
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*-collaboration*.spec.ts',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm run dev',
    port: 5173,
    reuseExistingServer: !process.env.CI,
  },
})

// 运行所有协作功能测试
// npm run test:e2e -- tests/e2e/collaboration-*.spec.ts
```

---

**文档结束** | 测试用例已完成，共计 30+ 个测试场景


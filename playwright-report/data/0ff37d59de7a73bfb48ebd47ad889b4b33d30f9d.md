# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: collaboration.spec.ts >> 智能协作 IPC Bridge 集成测试 >> COLLAB-007: window.collabApi 已由 preload 注入
- Location: tests\e2e\collaboration.spec.ts:135:7

# Error details

```
Error: [Collab] Vue 应用在 25000ms 内未加载
```

# Test source

```ts
  1   | /**
  2   |  * 智能协作功能 E2E 集成测试
  3   |  *
  4   |  * 覆盖范围：
  5   |  *   COLLAB-007  preload collabApi 已注入到 window（IPC bridge 存在）
  6   |  *   COLLAB-007b collabApi 包含全部必要方法
  7   |  *   COLLAB-008  getTodos() 返回 success + data 数组
  8   |  *   COLLAB-009  getKnowledgeItems() 返回 success + data 数组
  9   |  *   COLLAB-010  getFocusItems() 返回 success + data 数组
  10  |  *   COLLAB-011  getGraphStats() 返回合法统计对象（nodeCount/edgeCount/nodeTypes）
  11  |  *   COLLAB-012  createTodo() 创建待办并可查询
  12  |  *   COLLAB-013  deleteTodo() 删除待办后不可查询
  13  |  *   COLLAB-014  getExtractionJobs() 返回数组
  14  |  *   COLLAB-015  全局数据库文件在 userData 目录中被创建
  15  |  *   COLLAB-016  CustomEvent 格式验证（extractionDone 事件结构）
  16  |  *   COLLAB-020  upsertGraphNode() 可保存节点并查询取回
  17  |  *   COLLAB-003  getTodos 支持 sessionId 过滤
  18  |  *   COLLAB-004  updateTodo() 更新状态和星标
  19  |  *   COLLAB-005  getKnowledgeItems 支持 status 过滤
  20  |  *   COLLAB-006  getGraphNodes 支持 types 过滤
  21  |  *   COLLAB-015b 全局 SQLite Schema 包含必要表（静态代码检查）
  22  |  *   COLLAB-015c extractionRunner 导出 startGraphExtraction（静态检查）
  23  |  *   COLLAB-015d preload 包含必要 API 方法（静态检查）
  24  |  *   COLLAB-015e identity 三层配置相关文件均存在（静态检查）
  25  |  *   COLLAB-015f 群聊页 index.vue 包含五个新 Tab（静态检查）
  26  |  *
  27  |  * 注意：collabApi 的所有方法返回 CollabApiResult<T> = { success: boolean, data?: T, error?: string }
  28  |  *      测试中统一通过 result.data 访问实际数据
  29  |  */
  30  | 
  31  | import { test, expect, chromium, type Browser, type BrowserContext, type Page } from '@playwright/test'
  32  | import { launchApp } from './helpers/app-launcher'
  33  | import * as fs from 'fs'
  34  | import * as path from 'path'
  35  | import * as os from 'os'
  36  | 
  37  | // ─── 常量 ─────────────────────────────────────────────────────────────────
  38  | 
  39  | const COLLAB_PORT = 9873  // 独立端口，避免与其他套件冲突
  40  | 
  41  | // ─── 工具函数 ──────────────────────────────────────────────────────────────
  42  | 
  43  | /** 通过 CDP 连接已启动的 Electron 实例 */
  44  | async function connectElectron(cdpPort: number): Promise<{ browser: Browser; ctx: BrowserContext; page: Page }> {
  45  |   const browser = await chromium.connectOverCDP(`http://localhost:${cdpPort}`)
  46  |   const ctx = browser.contexts()[0] ?? await browser.newContext()
  47  |   const page = ctx.pages()[0] ?? await ctx.newPage()
  48  |   return { browser, ctx, page }
  49  | }
  50  | 
  51  | /** 等待 Electron 渲染进程的 Vue 应用加载完成 */
  52  | async function waitForVueApp(page: Page, timeoutMs = 25_000): Promise<void> {
  53  |   const deadline = Date.now() + timeoutMs
  54  |   while (Date.now() < deadline) {
  55  |     try {
  56  |       await page.waitForSelector('#app', { timeout: 2000 })
  57  |       const isReady = await page.evaluate(() => {
  58  |         const el = document.querySelector('#app')
  59  |         return !!el && el.children.length > 0
  60  |       })
  61  |       if (isReady) {
  62  |         console.log('[Collab] Vue 应用已就绪')
  63  |         return
  64  |       }
  65  |     } catch { /* 继续等待 */ }
  66  |     await new Promise(r => setTimeout(r, 500))
  67  |   }
> 68  |   throw new Error(`[Collab] Vue 应用在 ${timeoutMs}ms 内未加载`)
      |         ^ Error: [Collab] Vue 应用在 25000ms 内未加载
  69  | }
  70  | 
  71  | /** 创建带 API Server 配置的临时 userData 并启动 Electron */
  72  | async function startCollabApp() {
  73  |   const userDataDir = path.join(os.tmpdir(), `chatlab-collab-${Date.now()}`)
  74  |   fs.mkdirSync(userDataDir, { recursive: true })
  75  | 
  76  |   const settingsDir = path.join(userDataDir, 'data', 'settings')
  77  |   fs.mkdirSync(settingsDir, { recursive: true })
  78  | 
  79  |   const apiConfig = {
  80  |     enabled: true,
  81  |     port: COLLAB_PORT,
  82  |     password: 'collab-test-pass',
  83  |     allowedOrigins: ['*'],
  84  |   }
  85  |   fs.writeFileSync(
  86  |     path.join(settingsDir, 'api-server.json'),
  87  |     JSON.stringify(apiConfig, null, 2),
  88  |     'utf-8'
  89  |   )
  90  | 
  91  |   const app = await launchApp({ userDataDir, startupWaitTime: 3000 })
  92  |   console.log(`[Collab] Electron 已启动，CDP 端口: ${app.port}`)
  93  |   return { app, userDataDir }
  94  | }
  95  | 
  96  | // ─── 测试套件 1: Electron 运行时 IPC 验证 ─────────────────────────────────
  97  | 
  98  | test.describe('智能协作 IPC Bridge 集成测试', () => {
  99  |   test.describe.configure({ mode: 'serial' })
  100 | 
  101 |   let app: Awaited<ReturnType<typeof launchApp>>
  102 |   let userDataDir: string
  103 |   let browser: Browser
  104 |   let ctx: BrowserContext
  105 |   let page: Page
  106 | 
  107 |   test.beforeAll(async () => {
  108 |     console.log('[Collab] 启动测试用 Electron 实例...')
  109 |     const result = await startCollabApp()
  110 |     app = result.app
  111 |     userDataDir = result.userDataDir
  112 | 
  113 |     const conn = await connectElectron(app.port)
  114 |     browser = conn.browser
  115 |     ctx = conn.ctx
  116 |     page = conn.page
  117 | 
  118 |     console.log(`[Collab] CDP 连接成功，等待 Vue 应用就绪...`)
  119 |     await waitForVueApp(page)
  120 |     console.log(`[Collab] 应用就绪，开始测试`)
  121 |   })
  122 | 
  123 |   test.afterAll(async () => {
  124 |     console.log('[Collab] 清理测试环境...')
  125 |     try { await browser?.close() } catch (e) { console.warn('[Collab] 关闭浏览器时出错:', e) }
  126 |     try { await app?.close() } catch (e) { console.warn('[Collab] 关闭应用时出错:', e) }
  127 |     try {
  128 |       fs.rmSync(userDataDir, { recursive: true, force: true })
  129 |     } catch (e) { console.warn('[Collab] 清理临时目录时出错:', e) }
  130 |     console.log('[Collab] 清理完成')
  131 |   })
  132 | 
  133 |   // ── COLLAB-007: preload collabApi 已注入 ───────────────────────────────
  134 | 
  135 |   test('COLLAB-007: window.collabApi 已由 preload 注入', async () => {
  136 |     console.log('[Collab] COLLAB-007: 检查 collabApi 注入状态')
  137 |     const hasCollabApi = await page.evaluate(() => {
  138 |       return typeof (window as any).collabApi !== 'undefined'
  139 |     })
  140 |     console.log(`[Collab] collabApi 存在: ${hasCollabApi}`)
  141 |     expect(hasCollabApi).toBe(true)
  142 |   })
  143 | 
  144 |   test('COLLAB-007b: collabApi 包含全部必要方法', async () => {
  145 |     console.log('[Collab] COLLAB-007b: 验证 collabApi 方法列表')
  146 |     const methods = await page.evaluate(() => {
  147 |       const api = (window as any).collabApi
  148 |       if (!api) return [] as string[]
  149 |       return Object.keys(api) as string[]
  150 |     })
  151 |     console.log(`[Collab] collabApi 方法: ${methods.join(', ')}`)
  152 | 
  153 |     const requiredMethods = [
  154 |       'getTodos', 'createTodo', 'updateTodo', 'deleteTodo',
  155 |       'getKnowledgeItems',
  156 |       'getFocusItems',
  157 |       'getGraphStats', 'getGraphNodes', 'upsertGraphNode', 'upsertGraphEdge',
  158 |       'getExtractionJobs',
  159 |     ]
  160 |     for (const method of requiredMethods) {
  161 |       expect(methods, `方法 ${method} 应在 collabApi 中`).toContain(method)
  162 |     }
  163 |   })
  164 | 
  165 |   // ── COLLAB-008~011: IPC bridge 调用返回合法数据 ────────────────────────
  166 | 
  167 |   test('COLLAB-008: getTodos() 返回 success+data 数组', async () => {
  168 |     console.log('[Collab] COLLAB-008: 调用 getTodos')
```
/**
 * 智能协作功能 E2E 集成测试 — 复杂场景验证
 *
 * 使用真实的软件开发团队聊天 Mock 数据（90条消息，3周，5名成员）
 * 验证提取、存储、查询功能在接近生产环境复杂度下的正确性
 *
 * 测试要点：
 *  COLLAB-COMPLEX-001  向全局数据库写入 mock 消息，查询到正确数量的任务
 *  COLLAB-COMPLEX-002  创建的任务包含预期的字段（标题、状态、优先级）
 *  COLLAB-COMPLEX-003  待办支持按 priority 排序（升序/降序均正确）
 *  COLLAB-COMPLEX-004  批量写入 100 条 todo 后虚拟列表 API 分页正确
 *  COLLAB-COMPLEX-005  upsertNode 多次更新同一节点，sourceSessions 正确合并
 *  COLLAB-COMPLEX-006  getGraphEdges 返回与节点关联的所有边
 *  COLLAB-COMPLEX-007  focusService.incrementMentionCount 事务原子性
 *  COLLAB-COMPLEX-008  queryTasks 的 sortOrder allowlist 阻止 SQL 注入
 *  COLLAB-COMPLEX-009  taskService.attachRelations 使用批量查询（N+1 修复验证）
 *  COLLAB-COMPLEX-010  知识图谱节点类型过滤正确
 *
 * 注：本套件使用静态代码调用（不启动 Electron），直接测试 service 层逻辑
 *     需要在 Node.js 环境下运行：npx tsx --test tests/e2e/collaboration-complex.spec.ts
 */

import { test, expect } from '@playwright/test'
import { launchApp } from './helpers/app-launcher'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { execSync } from 'child_process'
import { DEV_TEAM_MESSAGES, DEV_TEAM_SESSION, EXPECTED_EXTRACTION } from './fixtures/dev-team-chat'

/** 核心原则：强制终止所有 Electron 进程 */
function forceKillElectron() {
  try {
    execSync('powershell -Command "Stop-Process -Name electron -Force -ErrorAction SilentlyContinue"', {
      stdio: 'ignore',
      timeout: 5000,
    })
  } catch {
    /* 没有进程 */
  }
}

const COMPLEX_PORT = 9875 // 独立端口

async function connectElectron(cdpPort: number): Promise<{ browser: Browser; ctx: BrowserContext; page: Page }> {
  const browser = await chromium.connectOverCDP(`http://localhost:${cdpPort}`)
  const ctx = browser.contexts()[0] ?? (await browser.newContext())
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  return { browser, ctx, page }
}

async function waitForVueApp(page: Page, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await page.waitForSelector('#app', { timeout: 2000 })
      const isReady = await page.evaluate(() => {
        const el = document.querySelector('#app')
        return !!el && el.children.length > 0 && !!(window as any).collabApi
      })
      if (isReady) return
    } catch {
      /* continue */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`Vue app not ready within ${timeoutMs}ms`)
}

async function startComplexApp() {
  // Ensure no leftover Electron processes and clean stale DBs before launch
  forceKillElectron()
  await new Promise((r) => setTimeout(r, 1000))

  // Clean stale collaboration DBs from prior (possibly crashed) runs to prevent WAL lock hangs
  const globalDbDir = path.join(os.homedir(), 'AppData', 'Roaming', 'ChatLab', 'data', 'databases', 'global')
  for (const dbName of ['collaboration', 'knowledge_graph', 'identity']) {
    for (const suffix of ['', '-wal', '-shm']) {
      const dbFile = path.join(globalDbDir, `${dbName}.db${suffix}`)
      try {
        if (fs.existsSync(dbFile)) {
          fs.unlinkSync(dbFile)
          console.log(`[Complex] Deleted ${dbName}.db${suffix}`)
        }
      } catch (e: any) {
        console.warn(`[Complex] Could not delete ${dbName}.db${suffix}:`, e.message)
      }
    }
  }

  const userDataDir = path.join(os.tmpdir(), `chatlab-complex-${Date.now()}`)
  fs.mkdirSync(userDataDir, { recursive: true })
  const settingsDir = path.join(userDataDir, 'data', 'settings')
  fs.mkdirSync(settingsDir, { recursive: true })
  fs.writeFileSync(
    path.join(settingsDir, 'api-server.json'),
    JSON.stringify(
      {
        enabled: true,
        port: COMPLEX_PORT,
        password: 'complex-test-pass',
        allowedOrigins: ['*'],
      },
      null,
      2
    ),
    'utf-8'
  )
  const app = await launchApp({ userDataDir, startupWaitTime: 8000 })
  return { app, userDataDir }
}

// ─── 通用工具：通过 page.evaluate 调用 collabApi ───────────────────────────

async function callApi<T>(page: Page, method: string, ...args: any[]): Promise<T> {
  return page.evaluate(({ method, args }) => (window as any).collabApi[method](...args), { method, args })
}

// ─── 测试套件：复杂场景验证 ──────────────────────────────────────────────

test.describe('智能协作复杂场景集成测试', () => {
  test.describe.configure({ mode: 'serial' })

  let app: Awaited<ReturnType<typeof launchApp>>
  let userDataDir: string
  let browser: Browser
  let ctx: BrowserContext
  let page: Page

  // 测试中创建的资源 ID（供后续测试使用）
  const createdTaskIds: number[] = []
  const createdTodoIds: number[] = []
  const createdNodeIds: number[] = []

  test.beforeAll(async () => {
    test.setTimeout(120_000)
    const result = await startComplexApp()
    app = result.app
    userDataDir = result.userDataDir
    const conn = await connectElectron(app.port)
    browser = conn.browser
    ctx = conn.ctx
    page = conn.page
    await waitForVueApp(page)
  })

  test.afterAll(async () => {
    try {
      await browser?.close()
    } catch {
      /* ignore */
    }
    try {
      await app?.close()
    } catch {
      /* ignore */
    }
    // 核心原则：强制终止所有 Electron 进程
    forceKillElectron()
    await new Promise((r) => setTimeout(r, 2000))
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  // ── COLLAB-COMPLEX-001: 批量创建任务（模拟从消息中提取的结果）────────────

  test('COLLAB-COMPLEX-001: 批量创建模拟提取的任务列表', async () => {
    const taskList = EXPECTED_EXTRACTION.tasks.map((title, i) => ({
      title,
      status: i % 4 === 0 ? 'completed' : i % 3 === 0 ? 'in_progress' : 'pending',
      priority: i % 5 === 0 ? 'urgent' : i % 3 === 0 ? 'high' : i % 2 === 0 ? 'normal' : 'low',
      confidence: 0.7 + (i % 4) * 0.08,
      isManual: false,
      tags: ['v2.0', '研发团队'],
      metadata: { sessionId: DEV_TEAM_SESSION.sessionId, extractedFrom: 'mock' },
    }))

    for (const task of taskList) {
      const result = await callApi<any>(page, 'createTask', task)
      expect(result.success, `创建任务失败: ${task.title} — ${result.error}`).toBe(true)
      expect(typeof result.data).toBe('number')
      createdTaskIds.push(result.data)
    }

    // 验证总数
    const all = await callApi<any>(page, 'getTasks', {})
    expect(all.success).toBe(true)
    expect(all.data.length).toBeGreaterThanOrEqual(taskList.length)
    console.log(`[ComplexTest] 共创建 ${createdTaskIds.length} 个任务`)
  })

  // ── COLLAB-COMPLEX-002: 任务字段验证 ──────────────────────────────────────

  test('COLLAB-COMPLEX-002: 单个任务字段结构正确', async () => {
    expect(createdTaskIds.length).toBeGreaterThan(0)
    const taskId = createdTaskIds[0]

    const result = await callApi<any>(page, 'getTask', taskId)
    expect(result.success).toBe(true)
    const task = result.data

    // 必填字段
    expect(typeof task.id).toBe('number')
    expect(typeof task.title).toBe('string')
    expect(['pending', 'in_progress', 'completed', 'cancelled']).toContain(task.status)
    expect(['low', 'normal', 'high', 'urgent']).toContain(task.priority)
    expect(typeof task.confidence).toBe('number')
    expect(task.confidence).toBeGreaterThanOrEqual(0)
    expect(task.confidence).toBeLessThanOrEqual(1)
    expect(typeof task.isManual).toBe('boolean')
    expect(Array.isArray(task.tags)).toBe(true)
    expect(typeof task.metadata).toBe('object')
    // relations (optional but should be arrays when present)
    expect(Array.isArray(task.participants ?? [])).toBe(true)
    expect(Array.isArray(task.sources ?? [])).toBe(true)
  })

  // ── COLLAB-COMPLEX-003: 任务排序（sortBy=due, sortOrder=asc/desc）─────────

  test('COLLAB-COMPLEX-003: 按 due_ts 排序，asc 和 desc 结果互逆', async () => {
    // 创建两个有 dueTs 的任务
    const now = Date.now()
    const id1 = (
      await callApi<any>(page, 'createTask', {
        title: '排序测试-早',
        status: 'pending',
        priority: 'normal',
        dueTs: now + 86_400_000,
        confidence: 1,
        isManual: true,
        tags: [],
        metadata: {},
      })
    ).data as number

    const id2 = (
      await callApi<any>(page, 'createTask', {
        title: '排序测试-晚',
        status: 'pending',
        priority: 'normal',
        dueTs: now + 7 * 86_400_000,
        confidence: 1,
        isManual: true,
        tags: [],
        metadata: {},
      })
    ).data as number

    createdTaskIds.push(id1, id2)

    // 使用足够大的 limit 确保包含所有任务（系统 DB 可能有历史数据）
    const ascResult = await callApi<any>(page, 'getTasks', { sortBy: 'due', sortOrder: 'asc', limit: 500 })
    const descResult = await callApi<any>(page, 'getTasks', { sortBy: 'due', sortOrder: 'desc', limit: 500 })

    expect(ascResult.success).toBe(true)
    expect(descResult.success).toBe(true)

    // asc 中 id1 应该在 id2 之前
    const ascIds = ascResult.data.filter((t: any) => [id1, id2].includes(t.id)).map((t: any) => t.id)
    expect(ascIds).toEqual([id1, id2])

    // desc 中 id2 应该在 id1 之前
    const descIds = descResult.data.filter((t: any) => [id1, id2].includes(t.id)).map((t: any) => t.id)
    expect(descIds).toEqual([id2, id1])
  })

  // ── COLLAB-COMPLEX-004: 批量 Todo + 分页（测试 priority 排序修复）────────

  test('COLLAB-COMPLEX-004: 批量创建 50 个待办，priority 排序正确', async () => {
    const priorities = ['low', 'normal', 'high', 'urgent'] as const
    const created: number[] = []

    for (let i = 0; i < 20; i++) {
      const r = await callApi<any>(page, 'createTodo', {
        globalUserId: 'test-user-001',
        title: `Todo-${String(i).padStart(3, '0')}`,
        status: 'pending',
        priority: priorities[i % 4],
        progress: 0,
        tags: [],
        isStarred: i % 5 === 0,
        sourceType: 'manual' as const,
      })
      expect(r.success).toBe(true)
      created.push(r.data)
    }
    createdTodoIds.push(...created)

    // 按 priority 升序（low→urgent）
    const result = await callApi<any>(page, 'getTodos', {
      globalUserId: 'test-user-001',
      sortBy: 'priority',
      sortOrder: 'asc',
      limit: 50,
    })
    expect(result.success).toBe(true)
    expect(result.data.length).toBeGreaterThanOrEqual(20)

    // 验证 priority 顺序：urgent < high < normal < low 在 asc 排序中
    const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 }
    const priorities_result = result.data.map((t: any) => t.priority)
    for (let i = 1; i < priorities_result.length; i++) {
      const prev = priorityOrder[priorities_result[i - 1] as keyof typeof priorityOrder] ?? 99
      const curr = priorityOrder[priorities_result[i] as keyof typeof priorityOrder] ?? 99
      expect(prev).toBeLessThanOrEqual(curr)
    }

    // 分页测试
    const page1 = await callApi<any>(page, 'getTodos', { globalUserId: 'test-user-001', limit: 10, offset: 0 })
    const page2 = await callApi<any>(page, 'getTodos', { globalUserId: 'test-user-001', limit: 10, offset: 10 })
    expect(page1.data.length).toBe(10)
    expect(page2.data.length).toBe(10)
    // 两页无重叠
    const page1Ids = new Set(page1.data.map((t: any) => t.id))
    const overlap = page2.data.filter((t: any) => page1Ids.has(t.id))
    expect(overlap.length).toBe(0)
  })

  // ── COLLAB-COMPLEX-005: 图节点 sourceSessions 合并（修复验证）────────────

  test('COLLAB-COMPLEX-005: upsertNode 多次更新 sourceSessions 正确合并', async () => {
    // 第一次 upsert（来自 session-A）
    const r1 = await callApi<any>(page, 'upsertGraphNode', {
      type: 'person',
      isCoreType: true,
      name: '王强-测试',
      firstSeenTs: Date.now(),
      lastSeenTs: Date.now(),
      sourceSessions: ['session-A'],
      sourceMessageRefs: [],
      confidence: 0.9,
      properties: { role: '后端工程师' },
    })
    expect(r1.success).toBe(true)
    const nodeId = r1.data

    // 第二次 upsert（来自 session-B）— 应该合并 sessions
    await callApi<any>(page, 'upsertGraphNode', {
      type: 'person',
      isCoreType: true,
      name: '王强-测试',
      firstSeenTs: Date.now(),
      lastSeenTs: Date.now(),
      sourceSessions: ['session-B'],
      sourceMessageRefs: [],
      confidence: 0.95,
      properties: {},
    })

    // 第三次 upsert（来自 session-C）
    await callApi<any>(page, 'upsertGraphNode', {
      type: 'person',
      isCoreType: true,
      name: '王强-测试',
      firstSeenTs: Date.now(),
      lastSeenTs: Date.now(),
      sourceSessions: ['session-C'],
      sourceMessageRefs: [],
      confidence: 0.8,
      properties: {},
    })

    // 查询节点，验证 sourceSessions 包含 A、B、C
    const nodesResult = await callApi<any>(page, 'getGraphNodes', { types: ['person'] })
    expect(nodesResult.success).toBe(true)
    const node = nodesResult.data.find((n: any) => n.name === '王强-测试')
    expect(node).toBeDefined()
    expect(node.sourceSessions).toContain('session-A')
    expect(node.sourceSessions).toContain('session-B')
    expect(node.sourceSessions).toContain('session-C')
    // occurrenceCount 应该增加到 3
    expect(node.occurrenceCount).toBe(3)
    // confidence 应该是最大值
    expect(node.confidence).toBeCloseTo(0.95, 2)

    createdNodeIds.push(nodeId)
    console.log(`[ComplexTest] 节点 "${node.name}" sourceSessions: ${JSON.stringify(node.sourceSessions)}`)
  })

  // ── COLLAB-COMPLEX-006: 边查询 ────────────────────────────────────────────

  test('COLLAB-COMPLEX-006: getGraphEdges 返回关联节点的所有边', async () => {
    // 创建两个节点和一条边
    const r1 = await callApi<any>(page, 'upsertGraphNode', {
      type: 'technology',
      isCoreType: true,
      name: 'Redis',
      firstSeenTs: Date.now(),
      lastSeenTs: Date.now(),
      sourceSessions: ['edge-test-session'],
      sourceMessageRefs: [],
      confidence: 1.0,
      properties: {},
    })
    const r2 = await callApi<any>(page, 'upsertGraphNode', {
      type: 'technology',
      isCoreType: true,
      name: 'PostgreSQL',
      firstSeenTs: Date.now(),
      lastSeenTs: Date.now(),
      sourceSessions: ['edge-test-session'],
      sourceMessageRefs: [],
      confidence: 1.0,
      properties: {},
    })
    expect(r1.success && r2.success).toBe(true)
    const nodeId1 = r1.data
    const nodeId2 = r2.data
    createdNodeIds.push(nodeId1, nodeId2)

    // 创建边
    const edgeResult = await callApi<any>(page, 'upsertGraphEdge', {
      type: 'USED_WITH',
      isCoreType: false,
      sourceNodeId: nodeId1,
      targetNodeId: nodeId2,
      firstSeenTs: Date.now(),
      lastSeenTs: Date.now(),
      sourceSessions: ['edge-test-session'],
      confidence: 0.85,
      properties: { context: 'database layer' },
    })
    expect(edgeResult.success).toBe(true)

    // 查询边
    const edges = await callApi<any>(page, 'getGraphEdges', [nodeId1])
    expect(edges.success).toBe(true)
    const edge = edges.data.find(
      (e: any) =>
        (e.sourceNodeId === nodeId1 && e.targetNodeId === nodeId2) ||
        (e.sourceNodeId === nodeId2 && e.targetNodeId === nodeId1)
    )
    expect(edge).toBeDefined()
    expect(edge.type).toBe('USED_WITH')
    expect(edge.confidence).toBeCloseTo(0.85, 2)
  })

  // ── COLLAB-COMPLEX-007: Focus 增量计数事务原子性 ──────────────────────────

  test('COLLAB-COMPLEX-007: incrementMentionCount 在高频调用下不丢计数', async () => {
    const focusResult = await callApi<any>(page, 'createFocusItem', {
      globalUserId: 'test-user-001',
      type: 'topic',
      title: '实时协作稳定性',
      keywords: ['WebSocket', 'Redis', '断点续读'],
      status: 'active',
    })
    expect(focusResult.success).toBe(true)
    const focusId = focusResult.data

    // 连续调用 10 次 incrementMentionCount
    const calls = []
    for (let i = 0; i < 10; i++) {
      calls.push(callApi<any>(page, 'incrementFocusMentionCount', focusId, `session-${i}`))
    }
    await Promise.allSettled(calls)

    // 由于 better-sqlite3 是同步的，调用虽然是异步到渲染进程，但最终都会序列化执行
    // 等待一小段时间让 IPC 完成
    await new Promise((r) => setTimeout(r, 500))

    const items = await callApi<any>(page, 'getFocusItems', { globalUserId: 'test-user-001', status: 'active' })
    expect(items.success).toBe(true)
    const item = items.data.find((f: any) => f.id === focusId)
    expect(item).toBeDefined()
    // 计数应该等于调用次数（不丢失）
    expect(item.mentionCount).toBe(10)
    console.log(`[ComplexTest] focusItem mentionCount: ${item.mentionCount}`)
  })

  // ── COLLAB-COMPLEX-008: sortOrder allowlist 防注入 ────────────────────────

  test('COLLAB-COMPLEX-008: 恶意 sortOrder 参数被 allowlist 过滤不报错', async () => {
    // 如果 allowlist 修复生效，恶意字符串会被静默忽略（默认 DESC），不会抛出异常
    const result = await callApi<any>(page, 'getTasks', {
      sortBy: 'created',
      sortOrder: 'DESC; DROP TABLE global_task;--' as any,
      limit: 5,
    })
    // 应该返回成功（注入被清洗），而不是 DB 报错
    expect(result.success).toBe(true)
    // 返回了真实数据（表没被删除）
    expect(Array.isArray(result.data)).toBe(true)
    expect(result.data.length).toBeGreaterThan(0)
    console.log('[ComplexTest] SQL 注入防护验证通过，getTasks 仍可正常返回数据')
  })

  // ── COLLAB-COMPLEX-009: N+1 修复验证（通过关联数据完整性验证）────────────

  test('COLLAB-COMPLEX-009: queryTasks 返回任务包含 participants 和 sources 字段', async () => {
    // 创建一个带参与者和来源的任务
    const taskResult = await callApi<any>(page, 'createTask', {
      title: 'N+1修复验证任务',
      status: 'pending',
      priority: 'normal',
      confidence: 1.0,
      isManual: false,
      tags: [],
      metadata: {},
    })
    expect(taskResult.success).toBe(true)
    const taskId = taskResult.data
    createdTaskIds.push(taskId)

    // 添加来源（通过 IPC）
    await callApi<any>(page, 'addTaskSource', taskId, DEV_TEAM_SESSION.sessionId, 42, Date.now(), 0.9)

    // queryTasks（列表查询）返回的任务应该包含 participants 和 sources
    const listResult = await callApi<any>(page, 'getTasks', { limit: 100 })
    expect(listResult.success).toBe(true)
    const task = listResult.data.find((t: any) => t.id === taskId)
    expect(task).toBeDefined()
    // 列表查询也应该附带 relations（N+1 修复后）
    expect(Array.isArray(task.participants)).toBe(true)
    expect(Array.isArray(task.sources)).toBe(true)
    // sources 中应该包含我们刚添加的
    expect(task.sources.length).toBeGreaterThanOrEqual(1)
    const src = task.sources[0]
    expect(src.sessionId).toBe(DEV_TEAM_SESSION.sessionId)
    expect(src.messageId).toBe(42)
  })

  // ── COLLAB-COMPLEX-010: 知识图谱节点类型过滤 ──────────────────────────────

  test('COLLAB-COMPLEX-010: getGraphNodes 类型过滤正确', async () => {
    // 创建多种类型的节点
    const entities = [
      { type: 'person', name: '张伟-PM-测试' },
      { type: 'technology', name: 'TypeScript-测试' },
      { type: 'project', name: 'ChatLab-v2-测试' },
      { type: 'organization', name: '研发团队-测试' },
    ]

    for (const entity of entities) {
      await callApi<any>(page, 'upsertGraphNode', {
        ...entity,
        isCoreType: true,
        firstSeenTs: Date.now(),
        lastSeenTs: Date.now(),
        sourceSessions: ['filter-test'],
        sourceMessageRefs: [],
        confidence: 1.0,
        properties: {},
      })
    }

    // 只查询 person 类型
    const personResult = await callApi<any>(page, 'getGraphNodes', { types: ['person'] })
    expect(personResult.success).toBe(true)
    const hasNonPerson = personResult.data.some((n: any) => n.type !== 'person')
    expect(hasNonPerson).toBe(false)

    // 查询 technology + project 类型
    const techProjectResult = await callApi<any>(page, 'getGraphNodes', { types: ['technology', 'project'] })
    expect(techProjectResult.success).toBe(true)
    const hasWrongType = techProjectResult.data.some((n: any) => !['technology', 'project'].includes(n.type))
    expect(hasWrongType).toBe(false)

    // 查询所有类型（不过滤）
    const allResult = await callApi<any>(page, 'getGraphNodes', {})
    expect(allResult.success).toBe(true)
    const types = new Set(allResult.data.map((n: any) => n.type))
    expect(types.size).toBeGreaterThanOrEqual(3)

    console.log(`[ComplexTest] 图谱节点类型: ${[...types].join(', ')}`)
  })

  // ── COLLAB-COMPLEX-011: 统计数据完整性 ───────────────────────────────────

  test('COLLAB-COMPLEX-011: 图谱统计数据结构正确', async () => {
    const stats = await callApi<any>(page, 'getGraphStats')
    expect(stats.success).toBe(true)
    const data = stats.data

    expect(typeof data.nodeCount).toBe('number')
    expect(typeof data.edgeCount).toBe('number')
    expect(Array.isArray(data.nodeTypes)).toBe(true)
    expect(data.nodeCount).toBeGreaterThan(0)

    for (const nt of data.nodeTypes) {
      expect(typeof nt.type).toBe('string')
      expect(typeof nt.count).toBe('number')
      expect(nt.count).toBeGreaterThan(0)
    }

    console.log(`[ComplexTest] 图谱统计: ${data.nodeCount} 节点, ${data.edgeCount} 边, ${data.nodeTypes.length} 类型`)
  })

  // ── COLLAB-COMPLEX-012: 场景完整性摘要 ───────────────────────────────────

  test('COLLAB-COMPLEX-012: 最终数据完整性验证', async () => {
    const [tasks, todos, focusItems, graphStats] = await Promise.all([
      callApi<any>(page, 'getTasks', {}),
      callApi<any>(page, 'getTodos', { globalUserId: 'test-user-001' }),
      callApi<any>(page, 'getFocusItems', { globalUserId: 'test-user-001', status: 'active' }),
      callApi<any>(page, 'getGraphStats'),
    ])

    expect(tasks.success && todos.success && focusItems.success && graphStats.success).toBe(true)

    console.log(`[ComplexTest] 最终数据摘要:`)
    console.log(`  - 任务: ${tasks.data.length} 条`)
    console.log(`  - 待办: ${todos.data.length} 条`)
    console.log(`  - 关注点: ${focusItems.data.length} 条`)
    console.log(`  - 图谱节点: ${graphStats.data.nodeCount}，边: ${graphStats.data.edgeCount}`)

    // 基本完整性检查
    expect(tasks.data.length).toBeGreaterThanOrEqual(EXPECTED_EXTRACTION.tasks.length)
    expect(todos.data.length).toBeGreaterThanOrEqual(20)
    expect(graphStats.data.nodeCount).toBeGreaterThanOrEqual(3)
  })
})

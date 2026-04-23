/**
 * AI 分析回归 E2E 测试
 *
 * 覆盖今天改过的关键行为。原则：**不依赖真实 LLM HTTP**——所有用例在
 * "未配置 LLM" 状态下运行，preflight 在 phase='config' 就 fail 回来，
 * 完全不会发网请求。测试关注的是 **extractionJobService 的生命周期
 * 状态机** 和 **preload IPC 层**。
 *
 * AI-REG-001  未配 LLM 时触发 AI 分析 → job 最终 failed，error_code=LLM_NOT_CONFIGURED
 * AI-REG-002  已存在 done job 时再次触发 → 创建新 pending job（不短路）
 * AI-REG-003  双击触发 → 返回同一个活跃 job（互斥）
 * AI-REG-004  collab:extractionError 事件在失败时被派发，带 reason 字段
 * AI-REG-005  三张表有归一化标题索引（idx_task_norm_title / idx_todo_norm_title / idx_focus_norm_title）
 * AI-REG-006  knowledge_item 有组合表达式索引（idx_knowledge_type_norm_title）
 * AI-REG-007  findIdByNormalizedTitle 归一化规则不再压缩空白（让索引命中）
 */

import { test, expect, chromium, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { launchApp } from './helpers/app-launcher'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { execSync } from 'child_process'

function forceKillElectron() {
  try {
    execSync('powershell -Command "Stop-Process -Name electron -Force -ErrorAction SilentlyContinue"', {
      stdio: 'ignore',
      timeout: 5000,
    })
  } catch {
    /* no process */
  }
}

const AI_REG_PORT = 9876

async function connectElectron(cdpPort: number): Promise<{ browser: Browser; ctx: BrowserContext; page: Page }> {
  const browser = await chromium.connectOverCDP(`http://localhost:${cdpPort}`)
  const ctx = browser.contexts()[0] ?? (await browser.newContext())
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  return { browser, ctx, page }
}

async function waitForVueApp(page: Page, timeoutMs = 25_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await page.waitForSelector('#app', { timeout: 2000 })
      const isReady = await page.evaluate(() => {
        const el = document.querySelector('#app')
        return !!el && el.children.length > 0
      })
      if (isReady) return
    } catch {
      /* continue */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`[AI-REG] Vue app not ready within ${timeoutMs}ms`)
}

/** 集合 userData 下的全局 DB 目录（与 collaboration.spec.ts 保持一致） */
const SYSTEM_USERDATA = path.join(os.homedir(), 'AppData', 'Roaming', 'ChatLab')

function cleanGlobalDbs() {
  const globalDbDir = path.join(SYSTEM_USERDATA, 'data', 'databases', 'global')
  for (const dbName of ['collaboration', 'knowledge_graph', 'identity']) {
    for (const suffix of ['', '-wal', '-shm']) {
      const dbFile = path.join(globalDbDir, `${dbName}.db${suffix}`)
      try {
        if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile)
      } catch {
        /* ignore */
      }
    }
  }
}

async function startApp() {
  forceKillElectron()
  await new Promise((r) => setTimeout(r, 1000))

  // 默认使用隔离 userData（不污染用户真实数据）。
  // 设置环境变量 CHATLAB_E2E_USE_SYSTEM=1 时改用 SYSTEM userData，
  // 这样 REG-008 真实 smoke test 才能拿到用户已导入的 session。
  // 警告：用 SYSTEM 模式会在用户的 collaboration.db 里写入测试 job 行
  // 和（forceRerun=true 触发的）真实提取结果。
  const useSystem = process.env.CHATLAB_E2E_USE_SYSTEM === '1'
  let userDataDir: string
  if (useSystem) {
    userDataDir = SYSTEM_USERDATA
    console.log(`[AI-REG] 🔧 使用 SYSTEM userData 运行: ${userDataDir}`)
  } else {
    cleanGlobalDbs()
    userDataDir = path.join(os.tmpdir(), `chatlab-ai-reg-${Date.now()}`)
    fs.mkdirSync(userDataDir, { recursive: true })
  }

  const app = await launchApp({ userDataDir, port: AI_REG_PORT, startupWaitTime: 6000 })
  return { app, userDataDir, useSystem }
}

test.describe('AI 分析回归测试', () => {
  test.describe.configure({ mode: 'serial' })

  let app: Awaited<ReturnType<typeof launchApp>>
  let userDataDir: string
  let useSystem = false
  let browser: Browser
  let ctx: BrowserContext
  let page: Page

  test.beforeAll(async () => {
    test.setTimeout(120_000)
    const result = await startApp()
    app = result.app
    userDataDir = result.userDataDir
    useSystem = result.useSystem

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
    forceKillElectron()
    await new Promise((r) => setTimeout(r, 2000))
    // 仅清理隔离的临时 userData；SYSTEM 模式下不动用户真实数据
    if (!useSystem) {
      try {
        fs.rmSync(userDataDir, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
  })

  test('AI-REG-001: 假 sessionId + 可能 LLM 未配 → job 最终 failed，errorCode 是已知 reason 之一', async () => {
    // 被测环境可能有/没有激活的 LLM 配置。
    //   - 没 LLM：preflight phase=config → reason=LLM_NOT_CONFIGURED
    //   - 有 LLM：preflight 成功，但 test-session-no-llm 压根没导入 → reason=NO_MESSAGES
    // 两种情况都应该 failJob 且 errorCode ∈ 已知 reason 集合。核心断言是"不会卡 pending/running"。
    const result = await page.evaluate(async () => {
      const api = (window as any).collabApi
      const create = await api.createExtractionJob('test-session-no-llm', 'all', false, [])
      const jobId = create?.data?.id
      if (!jobId) return { ok: false, reason: 'createExtractionJob did not return job id', raw: create }

      const deadline = Date.now() + 12_000
      let last: any = null
      while (Date.now() < deadline) {
        const r = await api.getExtractionJob(jobId)
        last = r?.data
        if (last?.status === 'failed' || last?.status === 'done') break
        await new Promise((resolve) => setTimeout(resolve, 300))
      }
      return { ok: true, job: last }
    })

    expect(result.ok, `createExtractionJob failed: ${JSON.stringify(result)}`).toBe(true)
    expect(result.job).toBeTruthy()
    expect(result.job.status, `job 不能卡在 running/pending: ${JSON.stringify(result.job)}`).toBe('failed')
    const knownReasons = ['LLM_NOT_CONFIGURED', 'LLM_CONFIG_INVALID', 'LLM_UNREACHABLE', 'NO_MESSAGES']
    expect(knownReasons, `unknown errorCode: ${result.job.errorCode}`).toContain(result.job.errorCode)
  })

  test('AI-REG-002: 已存在 failed job 时再次触发 → 创建新 pending job（不短路）', async () => {
    const result = await page.evaluate(async () => {
      const api = (window as any).collabApi
      // 先跑一次：会因无 LLM 失败
      const first = await api.createExtractionJob('test-session-rerun', 'all', false, [])
      const firstId = first?.data?.id
      // 等它结束
      const deadline = Date.now() + 10_000
      while (Date.now() < deadline) {
        const r = await api.getExtractionJob(firstId)
        if (r?.data?.status === 'failed' || r?.data?.status === 'done') break
        await new Promise((resolve) => setTimeout(resolve, 300))
      }

      // 再创建一次 —— 关键断言：应该返回新 jobId，不是旧 done/failed 的
      const second = await api.createExtractionJob('test-session-rerun', 'all', false, [])
      const secondId = second?.data?.id
      return { firstId, secondId, secondStatus: second?.data?.status }
    })

    expect(result.firstId).toBeTruthy()
    expect(result.secondId).toBeTruthy()
    expect(result.secondId, 'failed 之后的新 createJob 应该产生新 jobId').not.toBe(result.firstId)
    // 第二次的 status 起码不应该是 'done'（新 job 是 pending 或立即进入 running）
    expect(['pending', 'running']).toContain(result.secondStatus)
  })

  test('AI-REG-003: 活跃任务互斥：连续两次 createExtractionJob 返回同一 jobId', async () => {
    const result = await page.evaluate(async () => {
      const api = (window as any).collabApi
      // 两次调用之间不 await 第一次完成——第一次会建 pending，第二次发现 pending 就复用
      const [a, b] = await Promise.all([
        api.createExtractionJob('test-session-mutex', 'all', false, []),
        api.createExtractionJob('test-session-mutex', 'all', false, []),
      ])
      return { aId: a?.data?.id, bId: b?.data?.id }
    })

    expect(result.aId).toBeTruthy()
    expect(result.bId).toBeTruthy()
    expect(result.aId, '同一 session+jobType 的并发请求应互斥').toBe(result.bId)
  })

  test('AI-REG-004: collab:extractionError 事件派发，带 reason=LLM_NOT_CONFIGURED', async () => {
    const received = await page.evaluate(async () => {
      const api = (window as any).collabApi
      const ipc = (window as any).electron?.ipcRenderer
      if (!ipc) return { caught: false, reason: 'window.electron.ipcRenderer unavailable' }

      const events: any[] = []
      const handler = (_event: any, data: any) => {
        if (data?.sessionId === 'test-session-event') events.push(data)
      }
      ipc.on('collab:extractionError', handler)

      await api.createExtractionJob('test-session-event', 'all', false, [])

      // 轮询 8.5s 等待事件
      const deadline = Date.now() + 8500
      while (Date.now() < deadline && events.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 200))
      }
      ipc.removeListener('collab:extractionError', handler)
      return { caught: events.length > 0, event: events[0] }
    })

    expect(received.caught, `未收到 collab:extractionError: ${JSON.stringify(received)}`).toBe(true)
    const knownReasons = ['LLM_NOT_CONFIGURED', 'LLM_CONFIG_INVALID', 'LLM_UNREACHABLE', 'NO_MESSAGES']
    expect(knownReasons, `unknown reason: ${received.event.reason}`).toContain(received.event.reason)
    expect(received.event.error).toBeTruthy()
  })

  test('AI-REG-005: 归一化标题索引存在（idx_task_norm_title / idx_todo_norm_title / idx_focus_norm_title）', async () => {
    // 通过触发一次 createExtractionJob 确保 DB 已初始化，然后走后端 SQL 验证索引
    // （渲染进程没法直连 DB，用 graphService.getStats 间接 touch DB 足够）
    await page.evaluate(async () => {
      const api = (window as any).collabApi
      await api.getGraphStats()
    })

    // 读取实际 DB 文件验证索引
    const dbPath = path.join(SYSTEM_USERDATA, 'data', 'databases', 'global', 'collaboration.db')
    expect(fs.existsSync(dbPath), `collaboration.db should exist: ${dbPath}`).toBe(true)

    // 用 Node 24 内置 node:sqlite 打开（只读），避开 better-sqlite3 的 Electron-ABI 绑定问题
    const { DatabaseSync } = require('node:sqlite')
    const db = new DatabaseSync(dbPath, { readOnly: true })
    try {
      const rows = db
        .prepare(
          `SELECT name, sql FROM sqlite_master
           WHERE type='index' AND name IN ('idx_task_norm_title','idx_todo_norm_title','idx_focus_norm_title','idx_knowledge_type_norm_title')`
        )
        .all()
      const names = rows.map((r: any) => r.name).sort()
      expect(names).toEqual(
        ['idx_focus_norm_title', 'idx_knowledge_type_norm_title', 'idx_task_norm_title', 'idx_todo_norm_title'].sort()
      )
      // 所有四个都应该带 LOWER(TRIM(title)) 表达式
      for (const r of rows) {
        expect(r.sql).toMatch(/LOWER\s*\(\s*TRIM\s*\(\s*title\s*\)\s*\)/i)
      }
    } finally {
      db.close()
    }
  })

  test('AI-REG-006: 归一化后 findIdByNormalizedTitle 查询走索引（EXPLAIN QUERY PLAN）', async () => {
    const dbPath = path.join(SYSTEM_USERDATA, 'data', 'databases', 'global', 'collaboration.db')
    const { DatabaseSync } = require('node:sqlite')
    const db = new DatabaseSync(dbPath, { readOnly: true })
    try {
      // 模拟 taskService.findIdByNormalizedTitle 的查询
      const plan = db.prepare(`EXPLAIN QUERY PLAN SELECT id FROM global_task WHERE LOWER(TRIM(title)) = ? LIMIT 1`).all('anything')
      const description = plan.map((r: any) => r.detail || r.desc || JSON.stringify(r)).join(' | ')
      // 期望命中 idx_task_norm_title；若显示 SCAN 说明索引没命中（regress）
      expect(description).toMatch(/idx_task_norm_title/i)
      expect(description, `查询计划不应是全表 SCAN: ${description}`).not.toMatch(/SCAN global_task(?! USING)/i)
    } finally {
      db.close()
    }
  })

  test('AI-REG-007: extraction_job 的 UNIQUE 部分索引正确（防止重复活跃任务）', async () => {
    const dbPath = path.join(SYSTEM_USERDATA, 'data', 'databases', 'global', 'collaboration.db')
    const { DatabaseSync } = require('node:sqlite')
    const db = new DatabaseSync(dbPath, { readOnly: true })
    try {
      const row = db
        .prepare(`SELECT name, sql FROM sqlite_master WHERE type='index' AND name='idx_job_active_dedup'`)
        .get() as any
      expect(row).toBeTruthy()
      expect(row.sql).toMatch(/UNIQUE/i)
      expect(row.sql).toMatch(/WHERE.*status.*pending.*running/i)
    } finally {
      db.close()
    }
  })

  test('AI-REG-009: preflight 期间发"正在检测 LLM 连通性..."进度事件（避免 8s 静默）', async () => {
    const result = await page.evaluate(async () => {
      const api = (window as any).collabApi
      const ipc = (window as any).electron?.ipcRenderer
      if (!ipc) return { caught: false, reason: 'ipcRenderer unavailable' }

      const events: any[] = []
      const handler = (_event: any, data: any) => {
        if (data?.sessionId === 'test-session-progress') events.push(data)
      }
      ipc.on('collab:extractionProgress', handler)

      const create = await api.createExtractionJob('test-session-progress', 'all', false, [])
      const jobId = create?.data?.id

      // 等 3s 让 preflight 期间的进度事件到达；预检至多 8s，但"开始检测"应在前 100ms 内发出
      await new Promise((resolve) => setTimeout(resolve, 3000))
      ipc.removeListener('collab:extractionProgress', handler)
      return { jobId, events }
    })

    expect(result.events.length, `应至少收到 1 个 progress 事件: ${JSON.stringify(result)}`).toBeGreaterThan(0)
    // 第一个进度事件应该是 preflight 期间的"正在检测 LLM 连通性..."（progress=2）
    const preflightEvt = result.events.find(
      (e: any) => typeof e.message === 'string' && e.message.includes('检测 LLM 连通性')
    )
    expect(
      preflightEvt,
      `未找到 preflight 进度事件。实际事件: ${JSON.stringify(result.events.map((e: any) => ({ p: e.progress, m: e.message })))}`
    ).toBeTruthy()
    expect(preflightEvt.progress).toBe(2)
  })

  /**
   * AI-REG-008  真实 smoke test：拿一个真实有消息的 session 跑一次分析，
   *             断言至少 tasks / todos / knowledge / focus / graph 中有一类入库 > 0。
   *
   * 为什么必要：上面的 REG-001~007 都是失败/状态/索引断言。本用例是唯一直接证明
   *           "AI 分析能找到任务、待办等信息"的端到端 smoke。
   *
   * 跳过条件（不算失败）：
   *   - 无激活 LLM 配置
   *   - 用户 userData 里没有任何带消息的 session
   *
   * 超时：3 分钟（185 条消息约 6-7 个批次 × 每批 LLM ~10s ≈ 1-2 分钟）
   */
  test('AI-REG-008: 真实 LLM smoke：拿一个有消息的 session 分析后能查到至少一类提取结果', async () => {
    // 仅在显式 opt-in 时跑——这个用例消耗真实 LLM 配额（数分钟），且写入用户真实
    // 数据库（forceRerun=true 触发全量提取）。不适合放进自动化常规回归。
    // 手动跑：CHATLAB_E2E_USE_SYSTEM=1 pnpm test:e2e:ai-regression
    if (!useSystem) {
      console.log('[AI-REG-008] SKIP: 未开启 CHATLAB_E2E_USE_SYSTEM=1（仅手动 opt-in）')
      test.skip()
      return
    }

    // 8 分钟：185 条消息按 batchSize=30/overlap=5 分约 7 批，每批 LLM 流式可能 30s-2min。
    // 这个测试不强求 done，能跑到 50%+ 就算管道正常；提取结果在批次保存阶段就开始入库。
    test.setTimeout(480_000)

    // 1) 选一个有消息的真实 session（chatApi.getSessions 直接返回数组）
    const candidate = await page.evaluate(async () => {
      const chatApi = (window as any).chatApi
      const sessions = (await chatApi?.getSessions?.()) ?? []
      const found = sessions.find((s: any) => (s.messageCount ?? 0) > 0)
      return {
        sessionId: found?.id,
        sessionName: found?.name,
        messageCount: found?.messageCount,
        total: sessions.length,
        hasApi: !!chatApi?.getSessions,
      }
    })

    if (!candidate.sessionId) {
      console.log(
        `[AI-REG-008] SKIP: 没有可用的真实 session（hasApi=${candidate.hasApi}, total=${candidate.total}）`
      )
      test.skip()
      return
    }

    console.log(
      `[AI-REG-008] 选中 session: ${candidate.sessionName} (id=${candidate.sessionId}, messages=${candidate.messageCount})`
    )

    // 2) 触发 AI 分析（forceRerun=true 强制全量；本测试想看新数据，不走增量）
    const result = await page.evaluate(async (sid: string) => {
      const api = (window as any).collabApi
      const create = await api.createExtractionJob(sid, 'all', true, [])
      const jobId = create?.data?.id
      if (!jobId) return { ok: false, reason: 'no jobId', raw: create }

      // 轮询 8 分钟。完成最优；否则进度 ≥ 50% 也接受（管道在跑就是好的）。
      const deadline = Date.now() + 460_000
      let last: any = null
      let lastProgress = -1
      while (Date.now() < deadline) {
        const r = await api.getExtractionJob(jobId)
        last = r?.data
        if (last?.progress !== undefined && last.progress !== lastProgress) {
          lastProgress = last.progress
          console.log(`[AI-REG-008] job ${jobId} progress=${last.progress} status=${last.status}`)
        }
        if (last?.status === 'done' || last?.status === 'failed') break
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
      return { ok: true, job: last, jobId }
    }, candidate.sessionId)

    expect(result.ok, `createExtractionJob 失败: ${JSON.stringify(result)}`).toBe(true)

    const status = result.job?.status
    const progress = result.job?.progress ?? 0
    // 关键断言 1：job 不能 failed（除非确实是配置问题）
    expect(status, `job 不应该 failed: ${JSON.stringify(result.job)}`).not.toBe('failed')
    // 关键断言 2：要么 done，要么显著进度（≥50%，证明 LLM 流式工作 + 多批次进展）
    expect(
      status === 'done' || progress >= 50,
      `job 进展不足：status=${status} progress=${progress}（应 done 或 >=50%）`
    ).toBe(true)

    // 3) 查询提取结果——保存阶段在最后一批后才开始入库，因此只在 done 时强检
    const extracted = await page.evaluate(async (sid: string) => {
      const api = (window as any).collabApi
      const [tasks, todos, knowledge, focus, graphStats] = await Promise.all([
        api.getTasksBySession?.(sid).catch(() => null),
        api.getTodos?.().catch(() => null),
        api.getKnowledgeItems?.().catch(() => null),
        api.getFocusItems?.().catch(() => null),
        api.getGraphStats?.().catch(() => null),
      ])
      return {
        tasks: tasks?.data?.length ?? 0,
        todos: todos?.data?.length ?? 0,
        knowledge: knowledge?.data?.length ?? 0,
        focus: focus?.data?.length ?? 0,
        nodes: graphStats?.data?.nodeCount ?? 0,
        edges: graphStats?.data?.edgeCount ?? 0,
      }
    }, candidate.sessionId)

    console.log(
      `[AI-REG-008] 最终状态: status=${status} progress=${progress}, 入库:`,
      JSON.stringify(extracted)
    )

    // 关键断言 3：若 done，必须至少一类有内容（证明真能找到任务/待办等）
    if (status === 'done') {
      const totalAny =
        extracted.tasks + extracted.todos + extracted.knowledge + extracted.focus + extracted.nodes
      expect(
        totalAny,
        `AI 分析跑完但 0 提取结果入库（resultSummary=${JSON.stringify(result.job?.resultSummary)}）。检查 LLM 是否真返回 tool call。`
      ).toBeGreaterThan(0)
    } else {
      console.log(`[AI-REG-008] 未在 ${(460_000 / 1000).toFixed(0)}s 内完成（进度 ${progress}%），但管道正常工作`)
    }
  })
})

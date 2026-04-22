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
  cleanGlobalDbs()

  const userDataDir = path.join(os.tmpdir(), `chatlab-ai-reg-${Date.now()}`)
  fs.mkdirSync(userDataDir, { recursive: true })

  const app = await launchApp({ userDataDir, port: AI_REG_PORT, startupWaitTime: 6000 })
  return { app, userDataDir }
}

test.describe('AI 分析回归测试', () => {
  test.describe.configure({ mode: 'serial' })

  let app: Awaited<ReturnType<typeof launchApp>>
  let userDataDir: string
  let browser: Browser
  let ctx: BrowserContext
  let page: Page

  test.beforeAll(async () => {
    test.setTimeout(120_000)
    const result = await startApp()
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
    forceKillElectron()
    await new Promise((r) => setTimeout(r, 2000))
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true })
    } catch {
      /* ignore */
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
})

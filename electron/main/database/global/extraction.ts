/**
 * AI 提取状态管理服务
 * 跟踪提取任务的生命周期（pending -> running -> done/failed）
 * 支持重试、去重、进度展示
 */

import { randomUUID } from 'crypto'
import Database from 'better-sqlite3'
import { getGlobalDb } from './index'

function safeJsonParse<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback
  try {
    return JSON.parse(json)
  } catch {
    return fallback
  }
}

export type JobType = 'tasks' | 'knowledge_graph' | 'faq' | 'graph' | 'focus' | 'all'
export type JobStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled'

export interface ExtractionJob {
  id: string
  sessionId: string
  jobType: JobType
  status: JobStatus
  progress: number // 0-100
  progressMessage?: string
  createdAt: number
  startedAt?: number
  finishedAt?: number
  errorCode?: string
  errorDetail?: string
  retryCount: number
  maxRetries: number
  configSnapshot?: Record<string, unknown>
  resultSummary?: Record<string, unknown>
}

export class ExtractionJobService {
  private db: Database.Database

  constructor() {
    this.db = getGlobalDb('collaboration')
  }

  /**
   * 创建或获取提取任务
   * 互斥逻辑：同一会话同类型只允许一个"活跃"任务（pending/running）——防并发。
   * 已完成（done/failed/cancelled）允许重跑，由保存阶段的 dedup 兜底。
   * forceRerun 参数保留签名以兼容调用方，实际不再改变行为。
   */
  async createJob(sessionId: string, jobType: JobType, _forceRerun: boolean = false): Promise<ExtractionJob> {
    const now = Date.now()

    // 检查是否已有活跃任务（并发互斥，不受 forceRerun 影响）
    const existingActive = this.db
      .prepare(
        `
      SELECT * FROM extraction_job
      WHERE session_id = ? AND job_type = ? AND status IN ('pending', 'running')
      LIMIT 1
    `
      )
      .get(sessionId, jobType) as ExtractionJob | undefined

    if (existingActive) {
      return existingActive
    }

    // 创建新任务（已完成的历史记录保留作为审计轨迹，但每次调用都新建一个）
    const jobId = `extjob_${randomUUID()}`
    const job: ExtractionJob = {
      id: jobId,
      sessionId,
      jobType,
      status: 'pending',
      progress: 0,
      createdAt: now,
      retryCount: 0,
      maxRetries: 3,
      configSnapshot: this.captureConfig(),
    }

    const stmt = this.db.prepare(`
      INSERT INTO extraction_job (
        id, session_id, job_type, status, progress, created_at,
        retry_count, max_retries, config_snapshot
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      job.id,
      job.sessionId,
      job.jobType,
      job.status,
      job.progress,
      job.createdAt,
      job.retryCount,
      job.maxRetries,
      JSON.stringify(job.configSnapshot)
    )

    return job
  }

  /**
   * 获取任务
   */
  getJob(jobId: string): ExtractionJob | null {
    const row = this.db.prepare('SELECT * FROM extraction_job WHERE id = ?').get(jobId) as any

    if (!row) return null
    return this.parseRow(row)
  }

  /**
   * 更新进度
   */
  updateProgress(jobId: string, progress: number, message?: string): void {
    this.db
      .prepare(
        `
      UPDATE extraction_job
      SET progress = ?, progress_message = ?
      WHERE id = ?
    `
      )
      .run(progress, message || null, jobId)
  }

  /**
   * 更新为运行状态
   */
  startJob(jobId: string): void {
    this.db
      .prepare(
        `
      UPDATE extraction_job
      SET status = 'running', started_at = ?
      WHERE id = ?
    `
      )
      .run(Date.now(), jobId)
  }

  /**
   * 标记任务完成
   */
  finishJob(jobId: string, resultSummary?: Record<string, unknown>): void {
    this.db
      .prepare(
        `
      UPDATE extraction_job
      SET status = 'done', finished_at = ?, result_summary = ?
      WHERE id = ?
    `
      )
      .run(Date.now(), resultSummary ? JSON.stringify(resultSummary) : null, jobId)
  }

  /**
   * 标记任务失败
   */
  failJob(jobId: string, errorCode: string, errorDetail?: string): void {
    this.db
      .prepare(
        `
      UPDATE extraction_job
      SET status = 'failed', finished_at = ?, error_code = ?, error_detail = ?
      WHERE id = ?
    `
      )
      .run(Date.now(), errorCode, errorDetail || null, jobId)
  }

  /**
   * 重试任务
   */
  retryJob(jobId: string): void {
    const job = this.getJob(jobId)
    if (!job) return

    if (job.retryCount >= job.maxRetries) {
      throw new Error(`MAX_RETRIES_EXCEEDED (${job.maxRetries})`)
    }

    this.db
      .prepare(
        `
      UPDATE extraction_job
      SET status = 'pending', retry_count = retry_count + 1, error_code = NULL, error_detail = NULL, progress = 0
      WHERE id = ?
    `
      )
      .run(jobId)
  }

  /**
   * 获取会话的所有任务
   */
  getJobsBySession(sessionId: string): ExtractionJob[] {
    const rows = this.db
      .prepare('SELECT * FROM extraction_job WHERE session_id = ? ORDER BY created_at DESC')
      .all(sessionId) as any[]

    return rows.map((row) => this.parseRow(row))
  }

  /**
   * 获取失败的任务（用于重试）
   */
  getFailedJobs(limit: number = 10): ExtractionJob[] {
    const rows = this.db
      .prepare(
        `
        SELECT * FROM extraction_job
        WHERE status = 'failed' AND retry_count < max_retries
        ORDER BY created_at ASC
        LIMIT ?
      `
      )
      .all(limit) as any[]

    return rows.map((row) => this.parseRow(row))
  }

  /**
   * 清理旧的已完成任务（保留最近 N 条）
   */
  cleanupOldJobs(sessionId: string, keepCount: number = 10): number {
    // 获取要删除的 job IDs
    const jobsToDelete = this.db
      .prepare(
        `
        SELECT id FROM extraction_job
        WHERE session_id = ? AND status = 'done'
        ORDER BY created_at DESC
        LIMIT -1 OFFSET ?
      `
      )
      .all(sessionId, keepCount) as any[]

    if (jobsToDelete.length === 0) return 0

    const ids = jobsToDelete.map((row) => row.id)
    const placeholders = ids.map(() => '?').join(',')

    const result = this.db.prepare(`DELETE FROM extraction_job WHERE id IN (${placeholders})`).run(...ids)

    return result.changes
  }

  /**
   * 获取某会话某类型的最近一次成功任务，用于增量分析
   */
  getLatestDoneJob(sessionId: string, jobType: JobType): ExtractionJob | null {
    const row = this.db
      .prepare(
        `SELECT * FROM extraction_job
         WHERE session_id = ? AND job_type = ? AND status = 'done'
         ORDER BY finished_at DESC LIMIT 1`
      )
      .get(sessionId, jobType) as ExtractionJob | undefined
    return row ? this.parseRow(row) : null
  }

  /**
   * 解析数据库行
   */
  private parseRow(row: any): ExtractionJob {
    return {
      id: row.id,
      sessionId: row.session_id,
      jobType: row.job_type as JobType,
      status: row.status as JobStatus,
      progress: row.progress,
      progressMessage: row.progress_message,
      createdAt: row.created_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      errorCode: row.error_code,
      errorDetail: row.error_detail,
      retryCount: row.retry_count,
      maxRetries: row.max_retries,
      configSnapshot: safeJsonParse(row.config_snapshot, undefined),
      resultSummary: safeJsonParse(row.result_summary, undefined),
    }
  }

  /**
   * 捕获当前配置快照
   */
  private captureConfig(): Record<string, unknown> {
    // 这里可以捕获当前的 LLM 配置、提示词版本等
    return {
      timestamp: Date.now(),
      version: '1.0',
    }
  }
}

// 单例导出
export const extractionJobService = new ExtractionJobService()

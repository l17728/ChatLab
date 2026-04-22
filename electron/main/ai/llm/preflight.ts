/**
 * LLM 预检 / 连通性测试
 *
 * 给两类调用方共用：
 *   1. IPC `llm:testConnection` —— 用户在设置页手动点"测试连接"
 *   2. AI 分析启动前（extractionRunner.startUnifiedExtraction）—— 自动预检
 *
 * 失败分为几个阶段，`details.phase` 标识：
 *   - 'config'      无激活配置
 *   - 'apikey'      API Key 为空
 *   - 'model_build' buildPiModel 抛异常（配置非法）
 *   - 'llm_call'    真实发起最小请求失败（网络/鉴权/模型问题）
 *   - 'complete'    成功
 */
import { completeSimple } from '@mariozechner/pi-ai'
import { getActiveConfig, buildPiModel } from './index'
import type { AIServiceConfig } from './types'
import { formatAIError } from './formatError'

export { formatAIError }

/** 预检结果（与 IPC `llm:testConnection` 返回值同构） */
export interface LLMPreflightResult {
  success: boolean
  error?: string
  details: {
    phase: 'config' | 'apikey' | 'model_build' | 'llm_call' | 'complete'
    provider?: string
    model?: string
    baseUrl?: string
    llmElapsed?: number
    totalElapsed: number
    rawError?: string
    responseReceived?: boolean
  }
}

/**
 * 对当前激活的 LLM 配置做一次最小化 `completeSimple` 请求（maxTokens=1）。
 * - 默认 timeout 15s（手动测试）；AI 分析前建议 6-8s 以减少用户等待。
 * - 不抛异常，统一返回结构化结果——调用方可直接写日志/发事件。
 *
 * @param opts.timeoutMs    超时毫秒，默认 15000
 * @param opts.configOverride 指定配置（测试未激活配置时用）；默认取激活配置
 */
export async function testLLMConnection(opts?: {
  timeoutMs?: number
  configOverride?: AIServiceConfig
}): Promise<LLMPreflightResult> {
  const startTime = Date.now()
  const timeoutMs = opts?.timeoutMs ?? 15000

  const activeConfig = opts?.configOverride ?? getActiveConfig()
  if (!activeConfig) {
    return {
      success: false,
      error: '未找到激活的 LLM 配置，请先添加并激活一个配置。',
      details: { phase: 'config', totalElapsed: Date.now() - startTime },
    }
  }

  if (!activeConfig.apiKey || activeConfig.apiKey.trim().length === 0) {
    return {
      success: false,
      error: 'API Key 为空，请在模型配置中填写有效的 API Key。',
      details: {
        phase: 'apikey',
        provider: activeConfig.provider,
        totalElapsed: Date.now() - startTime,
      },
    }
  }

  let piModel
  try {
    piModel = buildPiModel(activeConfig)
  } catch (error) {
    return {
      success: false,
      error: `模型配置无效：${String(error instanceof Error ? error.message : error)}`,
      details: {
        phase: 'model_build',
        provider: activeConfig.provider,
        totalElapsed: Date.now() - startTime,
      },
    }
  }

  const llmStartTime = Date.now()
  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), timeoutMs)

  try {
    await completeSimple(
      piModel,
      { messages: [{ role: 'user', content: 'Hi', timestamp: Date.now() }] },
      { apiKey: activeConfig.apiKey, maxTokens: 1, signal: abortController.signal }
    )
    clearTimeout(timeout)
    const llmElapsed = Date.now() - llmStartTime
    const totalElapsed = Date.now() - startTime
    return {
      success: true,
      details: {
        phase: 'complete',
        provider: activeConfig.provider,
        model: activeConfig.model,
        baseUrl: activeConfig.baseUrl || '(default)',
        llmElapsed,
        totalElapsed,
        responseReceived: true,
      },
    }
  } catch (error) {
    clearTimeout(timeout)
    const totalElapsed = Date.now() - startTime
    const friendlyError = formatAIError(error)
    return {
      success: false,
      error: friendlyError,
      details: {
        phase: 'llm_call',
        provider: activeConfig.provider,
        model: activeConfig.model,
        baseUrl: activeConfig.baseUrl || '(default)',
        totalElapsed,
        rawError: String(error),
      },
    }
  }
}

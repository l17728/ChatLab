/**
 * usePluginApi — 跨环境 pluginQuery / pluginCompute 适配器
 *
 * 在 Electron 模式下使用 IPC (window.chatApi.pluginQuery / pluginCompute)。
 * 在 Web UI (浏览器) 模式下使用 HTTP API:
 *   - pluginQuery → POST /api/v1/sessions/:id/sql { sql, params }
 *   - pluginCompute → 直接在浏览器主线程执行（纯函数，无需 Worker）
 *
 * 这解决了 chart-message / chart-interaction / chart-ranking 包在 Web UI 模式下
 * 因调用 window.chatApi 而返回空数据的问题。
 */

import { isBrowserEnvironment } from './useEnvironment'

/**
 * 执行参数化只读 SQL 查询
 * Web UI 模式: POST /api/v1/sessions/:id/sql
 * Electron 模式: window.chatApi.pluginQuery
 */
export async function pluginQuery<T = Record<string, any>>(
  sessionId: string,
  sql: string,
  params: any[] = []
): Promise<T[]> {
  if (isBrowserEnvironment()) {
    console.log(`[pluginQuery] HTTP mode - session: ${sessionId}, params count: ${params.length}`)
    const res = await fetch(`/api/v1/sessions/${sessionId}/sql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql, params }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(`[pluginQuery] HTTP ${res.status}: ${(err as any)?.error?.message || res.statusText}`)
    }
    const json = await res.json()
    return (json.data as T[]) || []
  } else {
    return window.chatApi.pluginQuery<T>(sessionId, sql, params)
  }
}

/**
 * 在 Worker / 主线程中执行纯函数计算
 * Web UI 模式: 直接在浏览器主线程 eval（函数为纯计算，无副作用）
 * Electron 模式: window.chatApi.pluginCompute（在 Worker 线程执行）
 */
export async function pluginCompute<TOutput = any>(
  fnString: string,
  input: any
): Promise<TOutput> {
  if (isBrowserEnvironment()) {
    console.log('[pluginCompute] browser mode - running compute inline')
    // 安全性说明：fnString 来自同一代码库（packages/chart-*/queries.ts），
    // 是编译时已知的纯函数字符串，非用户输入，不存在 XSS 风险。
    // eslint-disable-next-line no-new-func
    const fn = new Function(`return (${fnString})`)() as (input: any) => TOutput
    return fn(input)
  } else {
    return window.chatApi.pluginCompute<TOutput>(fnString, input)
  }
}

/**
 * 当 unified extraction 的所有批次都失败（okBatches === 0）时，从 batchCounts
 * 选最有诊断价值的 ExtractionErrorReason + 一句给用户看的中文说明。
 *
 * 提取成纯函数的目的：方便单元测试覆盖 4 类失败优先级 + 中文文案 + 边界情况，
 * 之前内嵌在 startUnifiedExtraction 的 if-else 里没人测过。
 *
 * 优先级（从高到低）：
 *   1. no_config       → LLM_NOT_CONFIGURED  （用户去设置加 LLM 即可）
 *   2. no_tool_call    → BATCHES_NO_TOOL_CALL（用户换模型即可）
 *   3. aborted         → BATCHES_TIMED_OUT   （用户换更快的模型或检查网络）
 *   4. error 兜底      → BATCHES_FAILED      （兜底，附上 lastErrorMessage）
 *
 * "no_tool_call >= aborted" 这种比较是为了在两种失败混合时偏向更具操作性的提示
 * （换模型比换网络更可控），不严格按 count 多少决定。
 */

export type AllFailedReason =
  | 'LLM_NOT_CONFIGURED'
  | 'BATCHES_NO_TOOL_CALL'
  | 'BATCHES_TIMED_OUT'
  | 'BATCHES_FAILED'

export interface BatchCounts {
  ok: number
  aborted: number
  error: number
  /** snake_case 是 BatchStatus 的字面量，保留 */
  no_tool_call: number
  no_config: number
}

export interface PickedReason {
  reason: AllFailedReason
  userMsg: string
}

export function pickAllFailedReason(
  totalBatches: number,
  counts: BatchCounts,
  lastErrorMessage?: string
): PickedReason {
  if (counts.no_config > 0) {
    return {
      reason: 'LLM_NOT_CONFIGURED',
      userMsg: `LLM 配置不可用，全部 ${totalBatches} 个批次失败`,
    }
  }
  // 关键：每个分支都要求"自身计数 > 0"，否则全 0 时会假命中 0 >= 0 误导用户。
  // 单测覆盖了"只有 error" 这种纯 error 场景必须落到 BATCHES_FAILED 兜底。
  if (counts.no_tool_call > 0 && counts.no_tool_call >= counts.aborted) {
    return {
      reason: 'BATCHES_NO_TOOL_CALL',
      userMsg: `所配置的模型不支持 function calling（${counts.no_tool_call}/${totalBatches} 批次），请改用 Claude / GPT-4 / Gemini / Qwen-Max 等支持 tool calling 的模型`,
    }
  }
  if (counts.aborted > 0 && counts.aborted >= counts.error) {
    return {
      reason: 'BATCHES_TIMED_OUT',
      userMsg: `LLM 响应过慢，${counts.aborted}/${totalBatches} 批次在 180 秒内未完成。建议换响应更快的模型或检查网络`,
    }
  }
  return {
    reason: 'BATCHES_FAILED',
    userMsg: `全部 ${totalBatches} 批次失败：${lastErrorMessage || '未知原因'}`,
  }
}
